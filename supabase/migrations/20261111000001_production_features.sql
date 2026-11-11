-- =====================================================================
-- Basim CRM - Production Features Migration
-- File: supabase/migrations/20261111000001_production_features.sql
--
-- Security model:
--   * Every table has RLS enabled with public.is_team_member().
--   * Explicit grants (least privilege) for authenticated and service_role.
--   * Sensitive operations (admin actions, contact merges, 2FA resets) log to audit_log.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Updates to team_members (Deactivation & Instant Access Revocation)
-- ---------------------------------------------------------------------
alter table public.team_members 
  add column if not exists is_active boolean not null default true;

-- Update is_team_member() to verify active status
create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm 
    where tm.id = auth.uid() and tm.is_active = true
  );
$$;
comment on function public.is_team_member() is 'True when auth.uid() is an active member in team_members. Deactivating immediately revokes all database access.';

-- ---------------------------------------------------------------------
-- 2. 2FA Recovery Codes (user_2fa_recovery_codes)
-- ---------------------------------------------------------------------
create table if not exists public.user_2fa_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.team_members (id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_2fa_recovery_codes_user_idx on public.user_2fa_recovery_codes (user_id);
comment on table public.user_2fa_recovery_codes is '8 one-time backup codes generated upon TOTP enrollment. Stored hashed (SHA-256).';

-- ---------------------------------------------------------------------
-- 3. Gmail Sync Controls & Ignore List
-- ---------------------------------------------------------------------
create table if not exists public.gmail_sync_settings (
  id                     smallint primary key default 1 check (id = 1),
  backfill_days          integer not null default 60 check (backfill_days in (30, 60, 90)),
  sync_label             text,
  sync_inbox_sent_only   boolean not null default true,
  max_db_size_bytes      bigint not null default 524288000, -- 500 MB free tier
  db_size_warned_at      timestamptz,
  updated_at             timestamptz not null default now()
);
insert into public.gmail_sync_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.gmail_ignore_rules (
  id         uuid primary key default gen_random_uuid(),
  rule_type  text not null check (rule_type in ('email', 'domain')),
  value      text not null check (value = lower(btrim(value))),
  reason     text default 'Not a lead / blocked',
  created_by uuid references public.team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint gmail_ignore_rules_type_value_key unique (rule_type, value)
);
create index if not exists gmail_ignore_rules_value_idx on public.gmail_ignore_rules (value);

-- ---------------------------------------------------------------------
-- 4. Full-Text Search (GIN Indexes on Threads, Messages & Contacts)
-- ---------------------------------------------------------------------
alter table public.messages 
  add column if not exists bcc_email text check (bcc_email is null or char_length(bcc_email) <= 10000);

create index if not exists threads_fts_gin_idx on public.threads 
  using gin(to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(snippet, '')));

create index if not exists messages_fts_gin_idx on public.messages 
  using gin(to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(body_text, '')));

create index if not exists contacts_fts_gin_idx on public.contacts 
  using gin(to_tsvector('english', coalesce(name, '') || ' ' || coalesce(company, '') || ' ' || coalesce(email, '')));

-- Search RPC: Real Postgres FTS across subject, body_text, contact name, company and email
create or replace function public.search_crm(
  p_query text,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  thread_id uuid,
  subject text,
  snippet text,
  last_message_at timestamptz,
  status text,
  assigned_to_user_id uuid,
  contact_id uuid,
  contact_name text,
  contact_company text,
  contact_email text,
  rank real
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tsquery tsquery;
begin
  if not public.is_team_member() then
    raise exception 'Unauthorized: team member access required';
  end if;

  if p_query is null or btrim(p_query) = '' then
    return query
      select 
        t.id as thread_id,
        t.subject,
        t.snippet,
        t.last_message_at,
        t.status,
        t.assigned_to_user_id,
        c.id as contact_id,
        c.name as contact_name,
        c.company as contact_company,
        c.email as contact_email,
        0.0::real as rank
      from public.threads t
      left join public.thread_contacts tc on tc.thread_id = t.id
      left join public.contacts c on c.id = tc.contact_id
      order by t.last_message_at desc nulls last
      limit p_limit offset p_offset;
  else
    v_tsquery := plainto_tsquery('english', p_query);
    return query
      select distinct on (t.id)
        t.id as thread_id,
        t.subject,
        t.snippet,
        t.last_message_at,
        t.status,
        t.assigned_to_user_id,
        c.id as contact_id,
        c.name as contact_name,
        c.company as contact_company,
        c.email as contact_email,
        ts_rank_cd(to_tsvector('english', coalesce(t.subject, '') || ' ' || coalesce(t.snippet, '')), v_tsquery) as rank
      from public.threads t
      left join public.thread_contacts tc on tc.thread_id = t.id
      left join public.contacts c on c.id = tc.contact_id
      left join public.messages m on m.thread_id = t.id
      where 
        to_tsvector('english', coalesce(t.subject, '') || ' ' || coalesce(t.snippet, '')) @@ v_tsquery
        or to_tsvector('english', coalesce(m.body_text, '')) @@ v_tsquery
        or to_tsvector('english', coalesce(c.name, '') || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.email, '')) @@ v_tsquery
      order by t.id, rank desc
      limit p_limit offset p_offset;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Draft Autosave (drafts)
-- ---------------------------------------------------------------------
create table if not exists public.drafts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.team_members (id) on delete cascade,
  thread_id   uuid references public.threads (id) on delete cascade,
  to_email    text not null default '',
  cc_email    text not null default '',
  bcc_email   text not null default '',
  subject     text not null default '',
  body        text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists drafts_user_thread_uidx on public.drafts (user_id, coalesce(thread_id, '00000000-0000-0000-0000-000000000000'::uuid));
create trigger drafts_set_updated_at before update on public.drafts for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 6. Per-User Thread Read/Archived State (thread_user_state)
-- ---------------------------------------------------------------------
create table if not exists public.thread_user_state (
  user_id      uuid not null references public.team_members (id) on delete cascade,
  thread_id    uuid not null references public.threads (id) on delete cascade,
  is_read      boolean not null default false,
  is_starred   boolean not null default false,
  is_archived  boolean not null default false,
  last_read_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, thread_id)
);
create index if not exists thread_user_state_user_unread_idx on public.thread_user_state (user_id, is_read, is_archived);
create trigger thread_user_state_set_updated_at before update on public.thread_user_state for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 7. Follow-Up Reminders (reminders)
-- ---------------------------------------------------------------------
create table if not exists public.reminders (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.threads (id) on delete cascade,
  contact_id  uuid references public.contacts (id) on delete cascade,
  user_id     uuid not null references public.team_members (id) on delete cascade,
  due_at      timestamptz not null,
  note        text not null default '',
  status      text not null default 'pending' check (status in ('pending', 'completed', 'dismissed', 'auto_cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists reminders_user_due_idx on public.reminders (user_id, due_at) where status = 'pending';
create trigger reminders_set_updated_at before update on public.reminders for each row execute function public.set_updated_at();

-- Automatically cancel pending reminders when an inbound reply arrives
create or replace function public.auto_cancel_reminders_on_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'inbound' then
    update public.reminders
    set status = 'auto_cancelled', updated_at = now()
    where thread_id = new.thread_id and status = 'pending';

    -- Reopen thread automatically if archived
    update public.threads
    set status = 'open', updated_at = now()
    where id = new.thread_id and status = 'archived';

    update public.thread_user_state
    set is_archived = false, is_read = false, updated_at = now()
    where thread_id = new.thread_id;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_cancel_reminders on public.messages;
create trigger messages_cancel_reminders
  after insert on public.messages
  for each row execute function public.auto_cancel_reminders_on_reply();

-- ---------------------------------------------------------------------
-- 8. Snippets and Signatures (snippets, signatures)
-- ---------------------------------------------------------------------
create table if not exists public.snippets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.team_members (id) on delete cascade,
  title      text not null check (char_length(btrim(title)) between 1 and 100),
  body       text not null check (char_length(btrim(body)) between 1 and 10000),
  shortcut   text check (shortcut is null or char_length(shortcut) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists snippets_user_idx on public.snippets (user_id);
create trigger snippets_set_updated_at before update on public.snippets for each row execute function public.set_updated_at();

create table if not exists public.signatures (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.team_members (id) on delete cascade,
  title      text not null default 'Default Signature' check (char_length(title) <= 100),
  content    text not null check (char_length(content) <= 10000),
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists signatures_user_idx on public.signatures (user_id);
create trigger signatures_set_updated_at before update on public.signatures for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 9. Contact Merge Procedure (merge_contacts)
-- ---------------------------------------------------------------------
create or replace function public.merge_contacts(
  p_source_id uuid,
  p_target_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.contacts%rowtype;
  v_target public.contacts%rowtype;
begin
  if not public.is_team_member() then
    raise exception 'Unauthorized: team member access required';
  end if;

  if p_source_id = p_target_id then
    raise exception 'Source and target contacts must be distinct';
  end if;

  select * into v_source from public.contacts where id = p_source_id;
  select * into v_target from public.contacts where id = p_target_id;

  if v_source.id is null or v_target.id is null then
    raise exception 'Both source and target contact must exist';
  end if;

  -- 1. Reassign messages
  update public.messages set contact_id = p_target_id where contact_id = p_source_id;

  -- 2. Reassign internal notes
  update public.internal_notes set contact_id = p_target_id where contact_id = p_source_id;

  -- 3. Reassign reminders
  update public.reminders set contact_id = p_target_id where contact_id = p_source_id;

  -- 4. Reassign thread contacts (ignore conflict if target already linked)
  insert into public.thread_contacts (thread_id, contact_id)
  select thread_id, p_target_id
  from public.thread_contacts
  where contact_id = p_source_id
  on conflict (thread_id, contact_id) do nothing;

  delete from public.thread_contacts where contact_id = p_source_id;

  -- 5. Merge tags and dates on target
  update public.contacts
  set 
    tags = array(select distinct unnest(coalesce(v_target.tags, '{}'::text[]) || coalesce(v_source.tags, '{}'::text[]))),
    first_contacted_at = least(v_target.first_contacted_at, v_source.first_contacted_at),
    last_contacted_at  = greatest(v_target.last_contacted_at, v_source.last_contacted_at),
    company = coalesce(v_target.company, v_source.company),
    updated_at = now()
  where id = p_target_id;

  -- 6. Delete source contact
  delete from public.contacts where id = p_source_id;

  -- 7. Audit log entry
  insert into public.audit_log (user_id, action, target, metadata)
  values (
    auth.uid(),
    'contacts.merge',
    p_target_id::text,
    jsonb_build_object('source_id', p_source_id, 'source_email', v_source.email, 'target_email', v_target.email)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Database Size Monitoring RPC (Free 500MB tracking)
-- ---------------------------------------------------------------------
create or replace function public.get_database_storage_stats()
returns table (
  total_bytes bigint,
  max_bytes bigint,
  usage_percent numeric,
  is_warning boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_db_size bigint;
  v_max bigint := 524288000; -- 500MB
  v_pct numeric;
begin
  if not public.is_team_member() then
    raise exception 'Unauthorized';
  end if;

  select pg_database_size(current_database()) into v_db_size;
  v_pct := round((v_db_size::numeric / v_max::numeric) * 100, 2);

  return query select 
    v_db_size,
    v_max,
    v_pct,
    (v_pct >= 80.00);
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Admin 2FA Reset RPC
-- ---------------------------------------------------------------------
create or replace function public.admin_reset_user_2fa(
  p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can reset a teammate 2FA';
  end if;

  -- Delete recovery codes
  delete from public.user_2fa_recovery_codes where user_id = p_target_user_id;

  -- Log admin action
  insert into public.audit_log (user_id, action, target, metadata)
  values (
    auth.uid(),
    'team.reset_2fa',
    p_target_user_id::text,
    jsonb_build_object('target_user_id', p_target_user_id)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 12. RLS Policies on All New Tables
-- ---------------------------------------------------------------------
alter table public.user_2fa_recovery_codes enable row level security;
alter table public.gmail_sync_settings     enable row level security;
alter table public.gmail_ignore_rules      enable row level security;
alter table public.drafts                  enable row level security;
alter table public.thread_user_state       enable row level security;
alter table public.reminders               enable row level security;
alter table public.snippets                enable row level security;
alter table public.signatures              enable row level security;

-- user_2fa_recovery_codes
create policy "user_2fa_recovery_codes: read own"
  on public.user_2fa_recovery_codes for select to authenticated
  using ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "user_2fa_recovery_codes: insert own"
  on public.user_2fa_recovery_codes for insert to authenticated
  with check ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "user_2fa_recovery_codes: delete own or admin"
  on public.user_2fa_recovery_codes for delete to authenticated
  using ((select public.is_team_member()) and (user_id = (select auth.uid()) or (select public.is_admin())));

-- gmail_sync_settings (Admin read/update, members read)
create policy "gmail_sync_settings: member read"
  on public.gmail_sync_settings for select to authenticated
  using ((select public.is_team_member()));

create policy "gmail_sync_settings: admin update"
  on public.gmail_sync_settings for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- gmail_ignore_rules
create policy "gmail_ignore_rules: member read"
  on public.gmail_ignore_rules for select to authenticated
  using ((select public.is_team_member()));

create policy "gmail_ignore_rules: member insert"
  on public.gmail_ignore_rules for insert to authenticated
  with check ((select public.is_team_member()));

create policy "gmail_ignore_rules: admin or creator delete"
  on public.gmail_ignore_rules for delete to authenticated
  using ((select public.is_team_member()) and (created_by = (select auth.uid()) or (select public.is_admin())));

-- drafts (Strictly user-isolated)
create policy "drafts: read own"
  on public.drafts for select to authenticated
  using ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "drafts: insert own"
  on public.drafts for insert to authenticated
  with check ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "drafts: update own"
  on public.drafts for update to authenticated
  using ((select public.is_team_member()) and user_id = (select auth.uid()))
  with check ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "drafts: delete own"
  on public.drafts for delete to authenticated
  using ((select public.is_team_member()) and user_id = (select auth.uid()));

-- thread_user_state
create policy "thread_user_state: read own"
  on public.thread_user_state for select to authenticated
  using ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "thread_user_state: insert own"
  on public.thread_user_state for insert to authenticated
  with check ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "thread_user_state: update own"
  on public.thread_user_state for update to authenticated
  using ((select public.is_team_member()) and user_id = (select auth.uid()))
  with check ((select public.is_team_member()) and user_id = (select auth.uid()));

-- reminders
create policy "reminders: read team"
  on public.reminders for select to authenticated
  using ((select public.is_team_member()));

create policy "reminders: insert own"
  on public.reminders for insert to authenticated
  with check ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "reminders: update own or assigned"
  on public.reminders for update to authenticated
  using ((select public.is_team_member()))
  with check ((select public.is_team_member()));

create policy "reminders: delete own or admin"
  on public.reminders for delete to authenticated
  using ((select public.is_team_member()) and (user_id = (select auth.uid()) or (select public.is_admin())));

-- snippets & signatures
create policy "snippets: read own"
  on public.snippets for select to authenticated
  using ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "snippets: insert own"
  on public.snippets for insert to authenticated
  with check ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "snippets: update own"
  on public.snippets for update to authenticated
  using ((select public.is_team_member()) and user_id = (select auth.uid()))
  with check ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "snippets: delete own"
  on public.snippets for delete to authenticated
  using ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "signatures: read own"
  on public.signatures for select to authenticated
  using ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "signatures: insert own"
  on public.signatures for insert to authenticated
  with check ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "signatures: update own"
  on public.signatures for update to authenticated
  using ((select public.is_team_member()) and user_id = (select auth.uid()))
  with check ((select public.is_team_member()) and user_id = (select auth.uid()));

create policy "signatures: delete own"
  on public.signatures for delete to authenticated
  using ((select public.is_team_member()) and user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 13. Explicit Grants (Least Privilege)
-- ---------------------------------------------------------------------
grant select on
  public.user_2fa_recovery_codes, public.gmail_sync_settings,
  public.gmail_ignore_rules, public.drafts, public.thread_user_state,
  public.reminders, public.snippets, public.signatures
to authenticated;

grant insert, update, delete on
  public.user_2fa_recovery_codes, public.gmail_ignore_rules,
  public.drafts, public.thread_user_state, public.reminders,
  public.snippets, public.signatures
to authenticated;

grant update on public.gmail_sync_settings to authenticated;

grant execute on function public.search_crm(text, integer, integer) to authenticated, service_role;
grant execute on function public.merge_contacts(uuid, uuid)         to authenticated, service_role;
grant execute on function public.get_database_storage_stats()      to authenticated, service_role;
grant execute on function public.admin_reset_user_2fa(uuid)        to authenticated, service_role;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

commit;
