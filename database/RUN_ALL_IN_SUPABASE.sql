-- =====================================================================
-- Shared Inbox CRM - Stage 1: schema, RLS, helpers
-- File: supabase/migrations/20261111000000_init.sql
--
-- Run once in the Supabase SQL Editor (or with `supabase db push`).
--
-- Security model
--   * RLS is enabled on EVERY table. There is no anon access at all.
--   * Every policy requires public.is_team_member() (auth.uid() is in team_members).
--   * Data policies also require public.is_mfa_verified() (JWT aal = 'aal2'), so
--     the database refuses data to a session that has not passed TOTP 2FA, even
--     if the Next.js app had a bug. Exception: a member may read their OWN
--     team_members row before MFA (needed to drive the enroll/verify screens).
--   * gmail_account and sync_state have NO client policies and NO client grants:
--     only the service role (server-only key) can read/write them.
--   * messages, attachments, threads (insert), thread_contacts, audit_log are
--     written only by the server (service role) so HTML is always sanitized
--     server-side and audit entries cannot be forged.
--   * Column-level grants limit what authenticated users may change, even on
--     rows RLS allows them to touch.
--   * All timestamps are timestamptz (stored as UTC).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Privilege baseline: objects created by this role in `public` are NOT
--    automatically exposed to anon/authenticated. Grants below are explicit.
--    NOTE: future tables you create in `public` will need explicit grants.
-- ---------------------------------------------------------------------
alter default privileges in schema public revoke all     on tables    from anon, authenticated;
alter default privileges in schema public revoke all     on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Generic trigger helpers
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- clock_timestamp() so two updates in quick succession never share a value
  -- (updated_at is used for optimistic concurrency checks).
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. team_members (must exist before the RLS helper functions)
-- ---------------------------------------------------------------------
create table public.team_members (
  id           uuid primary key references auth.users (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 100),
  email        text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  role         text not null default 'member' check (role in ('admin', 'member')),
  avatar_color text not null default '#2563eb' check (avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint team_members_email_key unique (email)
);
comment on table public.team_members is 'The 3 humans allowed to use the app. Rows link 1:1 to auth.users. Managed by admins only.';

-- ---------------------------------------------------------------------
-- 3. RLS helper functions (SECURITY DEFINER, fixed empty search_path)
-- ---------------------------------------------------------------------
create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm where tm.id = auth.uid()
  );
$$;
comment on function public.is_team_member() is 'True when auth.uid() is a row in team_members. Required by every RLS policy.';

create or replace function public.is_mfa_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
comment on function public.is_mfa_verified() is 'True when the current JWT has passed TOTP MFA (aal2).';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.id = auth.uid() and tm.role = 'admin'
  );
$$;
comment on function public.is_admin() is 'True when auth.uid() is a team member with role = admin.';

-- ---------------------------------------------------------------------
-- 4. Core CRM tables
-- ---------------------------------------------------------------------
create table public.contacts (
  id                        uuid primary key default gen_random_uuid(),
  email                     text not null check (
                              email = lower(btrim(email))
                              and char_length(email) between 3 and 320
                              and position('@' in email) > 1
                            ),
  name                      text check (name is null or char_length(name) <= 200),
  company                   text check (company is null or char_length(company) <= 200),
  status                    text not null default 'lead'
                              check (status in ('lead', 'contacted', 'in_discussion', 'meeting', 'client', 'cold')),
  tags                      text[] not null default '{}' check (cardinality(tags) <= 50),
  first_contacted_at        timestamptz,
  last_contacted_at         timestamptz,
  last_contacted_by_user_id uuid references public.team_members (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index contacts_email_lower_uidx on public.contacts (lower(email));
create index contacts_last_contacted_at_idx on public.contacts (last_contacted_at desc nulls last);
create index contacts_status_idx on public.contacts (status);
comment on table public.contacts is 'Everyone the shared mailbox has emailed or heard from. Emails are stored lowercase.';

create table public.threads (
  id                  uuid primary key default gen_random_uuid(),
  gmail_thread_id     text not null,
  subject             text not null default '' check (char_length(subject) <= 2000),
  snippet             text not null default '' check (char_length(snippet) <= 1000),
  status              text not null default 'open'
                        check (status in ('open', 'waiting', 'resolved', 'archived')),
  assigned_to_user_id uuid references public.team_members (id) on delete set null,
  last_message_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint threads_gmail_thread_id_key unique (gmail_thread_id)
);
create index threads_last_message_at_idx on public.threads (last_message_at desc nulls last);
create index threads_assigned_status_idx on public.threads (assigned_to_user_id, status);
comment on column public.threads.updated_at is 'Bumped by trigger on every update. Clients use it for optimistic concurrency.';

create table public.thread_contacts (
  thread_id  uuid not null references public.threads (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thread_id, contact_id)
);
create index thread_contacts_contact_id_idx on public.thread_contacts (contact_id);

create table public.messages (
  id                uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references public.threads (id) on delete cascade,
  contact_id        uuid references public.contacts (id) on delete set null,
  gmail_message_id  text not null,
  rfc822_message_id text check (rfc822_message_id is null or char_length(rfc822_message_id) <= 998),
  references_header text check (references_header is null or char_length(references_header) <= 20000),
  direction         text not null check (direction in ('inbound', 'outbound')),
  from_email        text not null default '' check (char_length(from_email) <= 320),
  from_name         text check (from_name is null or char_length(from_name) <= 300),
  to_email          text not null default '' check (char_length(to_email) <= 10000),
  cc_email          text check (cc_email is null or char_length(cc_email) <= 10000),
  subject           text not null default '' check (char_length(subject) <= 2000),
  body_html         text check (body_html is null or char_length(body_html) <= 1000000),
  body_text         text check (body_text is null or char_length(body_text) <= 1000000),
  label_ids         text[] not null default '{}',
  sent_at           timestamptz not null,
  sent_by_user_id   uuid references public.team_members (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint messages_gmail_message_id_key unique (gmail_message_id),
  constraint messages_sent_by_only_outbound check (sent_by_user_id is null or direction = 'outbound')
);
create index messages_thread_id_idx on public.messages (thread_id, sent_at);
create index messages_contact_id_idx on public.messages (contact_id, sent_at desc);
comment on column public.messages.body_html is 'ALWAYS sanitized server-side (DOMPurify) before insert. Raw HTML is never stored.';
comment on column public.messages.rfc822_message_id is 'RFC 5322 Message-ID header; used for In-Reply-To / References when replying.';

create table public.attachments (
  id                  uuid primary key default gen_random_uuid(),
  message_id          uuid not null references public.messages (id) on delete cascade,
  part_id             text not null check (char_length(part_id) <= 100),
  filename            text not null default '' check (char_length(filename) <= 500),
  mime_type           text not null default 'application/octet-stream' check (char_length(mime_type) <= 255),
  size                bigint not null default 0 check (size >= 0),
  gmail_attachment_id text not null check (char_length(gmail_attachment_id) <= 2000),
  created_at          timestamptz not null default now(),
  constraint attachments_message_part_key unique (message_id, part_id)
);
comment on table public.attachments is 'Metadata only. File bytes are never stored; they are fetched from Gmail on demand.';

create table public.internal_notes (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid references public.contacts (id) on delete cascade,
  thread_id    uuid references public.threads (id) on delete cascade,
  user_id      uuid default auth.uid() references public.team_members (id) on delete set null,
  note_content text not null check (char_length(btrim(note_content)) between 1 and 10000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint internal_notes_target_check check (contact_id is not null or thread_id is not null)
);
create index internal_notes_contact_idx on public.internal_notes (contact_id, created_at desc) where contact_id is not null;
create index internal_notes_thread_idx  on public.internal_notes (thread_id,  created_at desc) where thread_id  is not null;
comment on table public.internal_notes is 'Private team notes on a contact and/or a thread. Never emailed.';

-- ---------------------------------------------------------------------
-- 5. Server-only tables (service role only)
-- ---------------------------------------------------------------------
create table public.gmail_account (
  id                      uuid primary key default gen_random_uuid(),
  singleton               boolean not null default true,
  email                   text not null check (email = lower(btrim(email))),
  encrypted_refresh_token text not null,
  status                  text not null default 'connected'
                            check (status in ('connected', 'needs_reconnect', 'disconnected')),
  connected_by            uuid references public.team_members (id) on delete set null,
  connected_at            timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint gmail_account_singleton_key   unique (singleton),
  constraint gmail_account_singleton_check check (singleton)
);
comment on table public.gmail_account is 'Exactly one row. Refresh token is AES-256-GCM encrypted with ENCRYPTION_KEY (server env). Service role only.';

create table public.sync_state (
  id                 smallint primary key default 1 check (id = 1),
  history_id         text,
  mode               text not null default 'full' check (mode in ('incremental', 'full')),
  page_token         text,
  pending_history_id text,
  lock_token         uuid,
  locked_until       timestamptz,
  last_run_at        timestamptz,
  last_success_at    timestamptz,
  last_error         text check (last_error is null or char_length(last_error) <= 2000),
  updated_at         timestamptz not null default now()
);
comment on table public.sync_state is 'Singleton (id = 1). Gmail sync cursor, saved batch progress and the overlap lock. Service role only.';
insert into public.sync_state (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 6. Collaboration / operations tables
-- ---------------------------------------------------------------------
create table public.thread_locks (
  thread_id  uuid not null references public.threads (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.team_members (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create index thread_locks_expires_at_idx on public.thread_locks (expires_at);
comment on table public.thread_locks is 'Soft "I am replying" locks. Warn only. expires_at is clamped to now()+2min, so a closed tab cannot hold a lock.';

create table public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid,  -- intentionally no FK: history survives member removal
  action     text not null check (action ~ '^[a-z][a-z0-9_.]{1,63}$'),
  target     text check (target is null or char_length(target) <= 500),
  metadata   jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 8192),
  created_at timestamptz not null default now()
);
create index audit_log_created_at_idx on public.audit_log (created_at desc);
comment on table public.audit_log is 'Append-only. Never store email bodies or tokens in metadata.';

create table public.outbound_sends (
  idempotency_key  uuid primary key,
  user_id          uuid not null default auth.uid() references public.team_members (id) on delete cascade,
  thread_id        uuid references public.threads (id) on delete set null,
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  gmail_message_id text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.outbound_sends is 'Client-generated idempotency keys for sends; a key can only ever produce one Gmail send.';

-- ---------------------------------------------------------------------
-- 7. Triggers
-- ---------------------------------------------------------------------
create trigger team_members_set_updated_at   before update on public.team_members   for each row execute function public.set_updated_at();
create trigger contacts_set_updated_at       before update on public.contacts       for each row execute function public.set_updated_at();
create trigger threads_set_updated_at        before update on public.threads        for each row execute function public.set_updated_at();
create trigger internal_notes_set_updated_at before update on public.internal_notes for each row execute function public.set_updated_at();
create trigger gmail_account_set_updated_at  before update on public.gmail_account  for each row execute function public.set_updated_at();
create trigger sync_state_set_updated_at     before update on public.sync_state     for each row execute function public.set_updated_at();
create trigger outbound_sends_set_updated_at before update on public.outbound_sends for each row execute function public.set_updated_at();

-- Clamp soft-lock lifetime so a client can never set a long-lived lock.
create or replace function public.clamp_thread_lock_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.expires_at > now() + interval '2 minutes' then
    new.expires_at := now() + interval '2 minutes';
  end if;
  return new;
end;
$$;
create trigger thread_locks_clamp_expiry
  before insert or update on public.thread_locks
  for each row execute function public.clamp_thread_lock_expiry();

-- Never allow the last admin to be demoted or removed.
create or replace function public.ensure_admin_remains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    if not exists (
      select 1 from public.team_members where role = 'admin' and id <> old.id
    ) then
      raise exception 'At least one admin must remain in team_members';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger team_members_keep_admin
  before update or delete on public.team_members
  for each row execute function public.ensure_admin_remains();

-- audit_log is append-only.
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;
create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- Tamper-proof DB-level audit for deletes, assignment/status changes and
-- Gmail account changes (cannot be bypassed by calling the REST API directly).
-- App-level entries (logins, sends, reconnects) are added by the server.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log (user_id, action, target)
    values (auth.uid(), tg_table_name || '.delete', old.id::text);
    return old;
  end if;

  if tg_table_name = 'threads' and tg_op = 'UPDATE' then
    if new.assigned_to_user_id is distinct from old.assigned_to_user_id then
      insert into public.audit_log (user_id, action, target, metadata)
      values (auth.uid(), 'threads.assign', new.id::text,
              jsonb_build_object('from', old.assigned_to_user_id, 'to', new.assigned_to_user_id));
    end if;
    if new.status is distinct from old.status then
      insert into public.audit_log (user_id, action, target, metadata)
      values (auth.uid(), 'threads.status', new.id::text,
              jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    return new;
  end if;

  if tg_table_name = 'gmail_account' then
    if tg_op = 'INSERT' then
      insert into public.audit_log (user_id, action, target, metadata)
      values (auth.uid(), 'gmail_account.connect', new.id::text,
              jsonb_build_object('email', new.email, 'connected_by', new.connected_by));
    elsif new.status is distinct from old.status then
      insert into public.audit_log (user_id, action, target, metadata)
      values (auth.uid(), 'gmail_account.status', new.id::text,
              jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    return new;
  end if;

  return new;
end;
$$;

create trigger contacts_audit_delete       after delete on public.contacts       for each row execute function public.audit_row_change();
create trigger threads_audit_delete        after delete on public.threads        for each row execute function public.audit_row_change();
create trigger messages_audit_delete       after delete on public.messages       for each row execute function public.audit_row_change();
create trigger internal_notes_audit_delete after delete on public.internal_notes for each row execute function public.audit_row_change();
create trigger team_members_audit_delete   after delete on public.team_members   for each row execute function public.audit_row_change();
create trigger threads_audit_update        after update on public.threads        for each row execute function public.audit_row_change();
create trigger gmail_account_audit_change  after insert or update or delete on public.gmail_account for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------
-- 8. Server-side RPC helpers (service role only)
-- ---------------------------------------------------------------------

-- Atomic contact upsert used by sync + send. Keeps first/last contacted correct
-- regardless of the order in which messages are processed.
create or replace function public.upsert_contact_touch(
  p_email        text,
  p_name         text,
  p_company      text,
  p_direction    text,
  p_contacted_at timestamptz,
  p_user_id      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id    uuid;
begin
  if char_length(v_email) < 3 or char_length(v_email) > 320 or position('@' in v_email) < 2 then
    raise exception 'upsert_contact_touch: invalid email';
  end if;
  if p_direction not in ('inbound', 'outbound') then
    raise exception 'upsert_contact_touch: invalid direction';
  end if;

  insert into public.contacts as c
    (email, name, company, status, first_contacted_at, last_contacted_at, last_contacted_by_user_id)
  values (
    v_email,
    nullif(left(btrim(coalesce(p_name, '')), 200), ''),
    nullif(left(btrim(coalesce(p_company, '')), 200), ''),
    case when p_direction = 'outbound' then 'contacted' else 'lead' end,
    p_contacted_at,
    p_contacted_at,
    p_user_id
  )
  on conflict ((lower(email))) do update set
    name                      = coalesce(c.name, excluded.name),
    company                   = coalesce(c.company, excluded.company),
    first_contacted_at        = least(c.first_contacted_at, excluded.first_contacted_at),
    last_contacted_at         = greatest(c.last_contacted_at, excluded.last_contacted_at),
    last_contacted_by_user_id = case
                                  when excluded.last_contacted_by_user_id is not null
                                   and (c.last_contacted_by_user_id is null
                                        or excluded.last_contacted_at >= coalesce(c.last_contacted_at, '-infinity'::timestamptz))
                                  then excluded.last_contacted_by_user_id
                                  else c.last_contacted_by_user_id
                                end,
    status                    = case
                                  when c.status = 'lead' and p_direction = 'outbound' then 'contacted'
                                  else c.status
                                end
  returning c.id into v_id;

  return v_id;
end;
$$;

-- Sync overlap lock. Returns a token on success, NULL if another run holds it.
create or replace function public.acquire_sync_lock(p_ttl_seconds integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  if p_ttl_seconds is null or p_ttl_seconds < 10 or p_ttl_seconds > 900 then
    raise exception 'acquire_sync_lock: ttl must be between 10 and 900 seconds';
  end if;

  update public.sync_state
     set lock_token   = v_token,
         locked_until = now() + make_interval(secs => p_ttl_seconds),
         last_run_at  = now()
   where id = 1
     and (locked_until is null or locked_until < now());

  if not found then
    return null;
  end if;
  return v_token;
end;
$$;

-- Releases the lock only if the caller still owns it (a stale run can never
-- release a newer run's lock).
create or replace function public.release_sync_lock(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sync_state
     set lock_token = null, locked_until = null
   where id = 1 and lock_token = p_token;
  return found;
end;
$$;

-- Safe, token-free view of Gmail/sync status for the UI banner.
create or replace function public.get_gmail_status()
returns table (
  email           text,
  status          text,
  connected_at    timestamptz,
  last_success_at timestamptz,
  last_error      text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.email,
    coalesce(g.status, 'disconnected'),
    g.connected_at,
    s.last_success_at,
    case when public.is_admin() then s.last_error else null end
  from public.sync_state s
  left join public.gmail_account g on true
  where s.id = 1
    and public.is_team_member()
    and public.is_mfa_verified();
$$;

-- ---------------------------------------------------------------------
-- 9. Enable RLS on every table
-- ---------------------------------------------------------------------
alter table public.team_members    enable row level security;
alter table public.contacts        enable row level security;
alter table public.threads         enable row level security;
alter table public.thread_contacts enable row level security;
alter table public.messages        enable row level security;
alter table public.attachments     enable row level security;
alter table public.internal_notes  enable row level security;
alter table public.gmail_account   enable row level security;
alter table public.sync_state      enable row level security;
alter table public.thread_locks    enable row level security;
alter table public.audit_log       enable row level security;
alter table public.outbound_sends  enable row level security;

-- ---------------------------------------------------------------------
-- 10. Policies (all `to authenticated`; anon has no policies at all)
-- ---------------------------------------------------------------------

-- team_members
create policy "team_members: read own row (allowed before MFA)"
  on public.team_members for select to authenticated
  using ((select public.is_team_member()) and id = (select auth.uid()));

create policy "team_members: verified members read all"
  on public.team_members for select to authenticated
  using ((select public.is_team_member()) and (select public.is_mfa_verified()));

create policy "team_members: admin insert"
  on public.team_members for insert to authenticated
  with check ((select public.is_team_member()) and (select public.is_admin()) and (select public.is_mfa_verified()));

create policy "team_members: admin update"
  on public.team_members for update to authenticated
  using      ((select public.is_team_member()) and (select public.is_admin()) and (select public.is_mfa_verified()))
  with check ((select public.is_team_member()) and (select public.is_admin()) and (select public.is_mfa_verified()));

create policy "team_members: admin delete (not self)"
  on public.team_members for delete to authenticated
  using ((select public.is_team_member()) and (select public.is_admin()) and (select public.is_mfa_verified())
         and id <> (select auth.uid()));

-- contacts
create policy "contacts: members read"
  on public.contacts for select to authenticated
  using ((select public.is_team_member()) and (select public.is_mfa_verified()));

create policy "contacts: members insert"
  on public.contacts for insert to authenticated
  with check ((select public.is_team_member()) and (select public.is_mfa_verified()));

create policy "contacts: members update"
  on public.contacts for update to authenticated
  using      ((select public.is_team_member()) and (select public.is_mfa_verified()))
  with check ((select public.is_team_member()) and (select public.is_mfa_verified()));

create policy "contacts: admin delete"
  on public.contacts for delete to authenticated
  using ((select public.is_team_member()) and (select public.is_admin()) and (select public.is_mfa_verified()));

-- threads (inserted by the server; members may change status/assignee only)
create policy "threads: members read"
  on public.threads for select to authenticated
  using ((select public.is_team_member()) and (select public.is_mfa_verified()));

create policy "threads: members update"
  on public.threads for update to authenticated
  using      ((select public.is_team_member()) and (select public.is_mfa_verified()))
  with check ((select public.is_team_member()) and (select public.is_mfa_verified()));

-- thread_contacts / messages / attachments: read-only for members
create policy "thread_contacts: members read"
  on public.thread_contacts for select to authenticated
  using ((select public.is_team_member()) and (select public.is_mfa_verified()));

create policy "messages: members read"
  on public.messages for select to authenticated
  using ((select public.is_team_member()) and (select public.is_mfa_verified()));

create policy "attachments: members read"
  on public.attachments for select to authenticated
  using ((select public.is_team_member()) and (select public.is_mfa_verified()));

-- internal_notes
create policy "internal_notes: members read"
  on public.internal_notes for select to authenticated
  using ((select public.is_team_member()) and (select public.is_mfa_verified()));

create policy "internal_notes: members insert as self"
  on public.internal_notes for insert to authenticated
  with check ((select public.is_team_member()) and (select public.is_mfa_verified())
              and user_id = (select auth.uid()));

create policy "internal_notes: author updates own"
  on public.internal_notes for update to authenticated
  using      ((select public.is_team_member()) and (select public.is_mfa_verified()) and user_id = (select auth.uid()))
  with check ((select public.is_team_member()) and (select public.is_mfa_verified()) and user_id = (select auth.uid()));

create policy "internal_notes: author or admin deletes"
  on public.internal_notes for delete to authenticated
  using ((select public.is_team_member()) and (select public.is_mfa_verified())
         and (user_id = (select auth.uid()) or (select public.is_admin())));

-- gmail_account, sync_state: intentionally NO policies (service role only).

-- thread_locks
create policy "thread_locks: members read"
  on public.thread_locks for select to authenticated
  using ((select public.is_team_member()) and (select public.is_mfa_verified()));

create policy "thread_locks: members insert own"
  on public.thread_locks for insert to authenticated
  with check ((select public.is_team_member()) and (select public.is_mfa_verified()) and user_id = (select auth.uid()));

create policy "thread_locks: members update own"
  on public.thread_locks for update to authenticated
  using      ((select public.is_team_member()) and (select public.is_mfa_verified()) and user_id = (select auth.uid()))
  with check ((select public.is_team_member()) and (select public.is_mfa_verified()) and user_id = (select auth.uid()));

create policy "thread_locks: members delete own"
  on public.thread_locks for delete to authenticated
  using ((select public.is_team_member()) and (select public.is_mfa_verified()) and user_id = (select auth.uid()));

-- audit_log: admins read; writes only via server / triggers
create policy "audit_log: admin read"
  on public.audit_log for select to authenticated
  using ((select public.is_team_member()) and (select public.is_admin()) and (select public.is_mfa_verified()));

-- outbound_sends: a member sees/creates only their own keys
create policy "outbound_sends: read own"
  on public.outbound_sends for select to authenticated
  using ((select public.is_team_member()) and (select public.is_mfa_verified()) and user_id = (select auth.uid()));

create policy "outbound_sends: insert own"
  on public.outbound_sends for insert to authenticated
  with check ((select public.is_team_member()) and (select public.is_mfa_verified()) and user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 11. Explicit grants (least privilege). RLS still applies on top.
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated, service_role;

grant select on
  public.team_members, public.contacts, public.threads, public.thread_contacts,
  public.messages, public.attachments, public.internal_notes, public.thread_locks,
  public.audit_log, public.outbound_sends
to authenticated;

grant insert (id, name, email, role, avatar_color), update (name, email, role, avatar_color), delete
  on public.team_members to authenticated;

grant insert (email, name, company, status, tags), update (name, company, status, tags), delete
  on public.contacts to authenticated;

grant update (status, assigned_to_user_id) on public.threads to authenticated;

grant insert (contact_id, thread_id, note_content), update (note_content), delete
  on public.internal_notes to authenticated;

grant insert (thread_id, expires_at), update (expires_at), delete
  on public.thread_locks to authenticated;

grant insert (idempotency_key, thread_id) on public.outbound_sends to authenticated;

-- RLS helpers must be callable by the querying role.
grant execute on function public.is_team_member()   to authenticated, service_role;
grant execute on function public.is_mfa_verified()  to authenticated, service_role;
grant execute on function public.is_admin()         to authenticated, service_role;
grant execute on function public.get_gmail_status() to authenticated, service_role;

-- Server-only RPCs.
grant execute on function public.upsert_contact_touch(text, text, text, text, timestamptz, uuid) to service_role;
grant execute on function public.acquire_sync_lock(integer) to service_role;
grant execute on function public.release_sync_lock(uuid)    to service_role;

-- Service role (server-only key) gets full table access; it bypasses RLS.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------
-- 12. Realtime (postgres_changes respects RLS; presence uses channels)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime
      add table public.threads, public.messages, public.internal_notes, public.thread_locks;
  end if;
end;
$$;

commit;
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
-- ==============================================================================
-- Migration: 20261111000002_multi_mailbox.sql
-- Description: Transition from single shared Gmail to THREE personal Gmail mailboxes
--              (Basim, Ali Shah, Moiz Ali) with combined team inbox, safe sending,
--              deliverability protection, contact collision prevention, DNC,
--              and per-account health monitoring.
-- ==============================================================================

-- 1. Create gmail_accounts Table (Replacing singleton gmail_account)
CREATE TABLE IF NOT EXISTS public.gmail_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  encrypted_refresh_token TEXT, -- AES-256-GCM encrypted, accessible ONLY by service role
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reconnect', 'paused')),
  connected_at TIMESTAMPTZ DEFAULT now(),
  history_id TEXT,
  last_sync_at TIMESTAMPTZ,
  sync_locked_until TIMESTAMPTZ,
  daily_cap INT NOT NULL DEFAULT 5 CHECK (daily_cap >= 1 AND daily_cap <= 30),
  warmup_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  warmup_override BOOLEAN NOT NULL DEFAULT false,
  pause_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast owner and status lookups
CREATE INDEX IF NOT EXISTS idx_gmail_accounts_owner ON public.gmail_accounts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_gmail_accounts_status ON public.gmail_accounts(status);

-- 2. Add account_id to threads and messages
ALTER TABLE public.threads 
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.gmail_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.messages 
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.gmail_accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_auto_reply BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_bounce BOOLEAN NOT NULL DEFAULT false;

-- Add uniqueness per account to prevent duplicate syncs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_threads_account_gmail_thread'
  ) THEN
    ALTER TABLE public.threads 
      ADD CONSTRAINT uq_threads_account_gmail_thread UNIQUE (account_id, gmail_thread_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_messages_account_gmail_msg'
  ) THEN
    ALTER TABLE public.messages 
      ADD CONSTRAINT uq_messages_account_gmail_msg UNIQUE (account_id, gmail_message_id);
  END IF;
END $$;

-- 3. Enhance contacts with ownership & deliverability flags
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bounce_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_bad_email BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bounce_reason TEXT,
  ADD COLUMN IF NOT EXISTS reminder_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_contacts_owner ON public.contacts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email_lower ON public.contacts(lower(email));

-- 4. Do Not Contact (DNC) Table
CREATE TABLE IF NOT EXISTS public.do_not_contact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('email', 'domain')),
  value TEXT NOT NULL UNIQUE, -- lowercase email or domain (e.g. competitor.com)
  reason TEXT NOT NULL DEFAULT 'User Opt-out',
  source TEXT NOT NULL CHECK (source IN ('auto_opt_out', 'manual', 'not_interested_action')),
  created_by_user_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dnc_value ON public.do_not_contact(value);

-- 5. Outbound Queue for Cold Outreach (spacing 45-120s, business hours window)
CREATE TABLE IF NOT EXISTS public.outbound_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.gmail_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  cc_email TEXT,
  bcc_email TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  idempotency_key UUID NOT NULL UNIQUE,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_queue_scheduled ON public.outbound_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_queue_account ON public.outbound_queue(account_id);

-- 6. Account Send & Health Logs (Tracks daily send volume in PKT & bounce rate)
CREATE TABLE IF NOT EXISTS public.account_send_logs (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.gmail_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  contact_email TEXT NOT NULL,
  is_reply BOOLEAN NOT NULL DEFAULT false, -- replies do NOT count against outreach cap
  is_bounce BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Computed PKT date string (UTC+5) for instant grouping:
  pkt_date DATE NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date
);

CREATE INDEX IF NOT EXISTS idx_send_logs_account_date ON public.account_send_logs(account_id, pkt_date);
CREATE INDEX IF NOT EXISTS idx_send_logs_account_recent ON public.account_send_logs(account_id, id DESC);

-- ==============================================================================
-- Row Level Security (RLS) Policies
-- ==============================================================================

ALTER TABLE public.gmail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.do_not_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_send_logs ENABLE ROW LEVEL SECURITY;

-- gmail_accounts: Teammates can view account metadata (email, status, daily_cap, warmup).
-- Tokens are protected: column-level or only service role writes.
DROP POLICY IF EXISTS "Team members can view gmail accounts" ON public.gmail_accounts;
CREATE POLICY "Team members can view gmail accounts"
  ON public.gmail_accounts
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

CREATE OR REPLACE FUNCTION public.is_team_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.is_admin();
$$;

GRANT EXECUTE ON FUNCTION public.is_team_admin() TO authenticated, service_role;

-- Only the owner or an admin can update account settings (e.g. daily cap, pause/resume)
DROP POLICY IF EXISTS "Account owners and admins can update accounts" ON public.gmail_accounts;
CREATE POLICY "Account owners and admins can update accounts"
  ON public.gmail_accounts
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin() OR 
    owner_user_id = auth.uid()
  );

-- Service role full access
DROP POLICY IF EXISTS "Service role manages gmail accounts" ON public.gmail_accounts;
CREATE POLICY "Service role manages gmail accounts"
  ON public.gmail_accounts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- do_not_contact: All team members can view and insert DNC entries
DROP POLICY IF EXISTS "Team members view DNC" ON public.do_not_contact;
CREATE POLICY "Team members view DNC"
  ON public.do_not_contact
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

DROP POLICY IF EXISTS "Team members insert DNC" ON public.do_not_contact;
CREATE POLICY "Team members insert DNC"
  ON public.do_not_contact
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_team_member());

DROP POLICY IF EXISTS "Admins can delete DNC" ON public.do_not_contact;
CREATE POLICY "Admins can delete DNC"
  ON public.do_not_contact
  FOR DELETE
  TO authenticated
  USING (public.is_team_admin());

-- outbound_queue: Team members view queue; owners/service role manage
DROP POLICY IF EXISTS "Team members view queue" ON public.outbound_queue;
CREATE POLICY "Team members view queue"
  ON public.outbound_queue
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

DROP POLICY IF EXISTS "Team members insert own queue" ON public.outbound_queue;
CREATE POLICY "Team members insert own queue"
  ON public.outbound_queue
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Service role manages outbound queue" ON public.outbound_queue;
CREATE POLICY "Service role manages outbound queue"
  ON public.outbound_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- account_send_logs: Read-only for team members, inserted on send
DROP POLICY IF EXISTS "Team members view send logs" ON public.account_send_logs;
CREATE POLICY "Team members view send logs"
  ON public.account_send_logs
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

DROP POLICY IF EXISTS "Service role manages send logs" ON public.account_send_logs;
CREATE POLICY "Service role manages send logs"
  ON public.account_send_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ==============================================================================
-- Stored Procedures & Helper RPCs
-- ==============================================================================

-- 1. Calculate Warm-up Limit per Account
-- Week 1: 5/day, Week 2: 10/day, Week 3: 15/day, Week 4+: 20/day
-- Hard max: 30/day. Overridden if warmup_override is true.
CREATE OR REPLACE FUNCTION public.get_account_warmup_limit(p_account_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started_at TIMESTAMPTZ;
  v_daily_cap INT;
  v_override BOOLEAN;
  v_days_active INT;
  v_warmup_limit INT;
BEGIN
  SELECT warmup_started_at, daily_cap, warmup_override
  INTO v_started_at, v_daily_cap, v_override
  FROM public.gmail_accounts
  WHERE id = p_account_id;

  IF NOT FOUND THEN
    RETURN 5;
  END IF;

  v_days_active := GREATEST(0, EXTRACT(DAY FROM (now() - v_started_at))::INT);

  IF v_days_active < 7 THEN
    v_warmup_limit := 5;
  ELSIF v_days_active < 14 THEN
    v_warmup_limit := 10;
  ELSIF v_days_active < 21 THEN
    v_warmup_limit := 15;
  ELSE
    v_warmup_limit := 20;
  END IF;

  IF v_override THEN
    RETURN LEAST(30, v_daily_cap);
  ELSE
    RETURN LEAST(v_warmup_limit, LEAST(30, v_daily_cap));
  END IF;
END;
$$;

-- 2. Contact Collision Checker
-- Checks if another teammate already contacted this email.
CREATE OR REPLACE FUNCTION public.check_contact_collision(
  p_contact_email TEXT,
  p_user_id UUID
)
RETURNS TABLE (
  has_collision BOOLEAN,
  owner_user_id UUID,
  owner_name TEXT,
  owner_email TEXT,
  first_contacted_at TIMESTAMPTZ,
  last_contacted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_email TEXT := lower(trim(p_contact_email));
  v_contact RECORD;
BEGIN
  SELECT c.id, c.owner_user_id, c.last_contacted_by_user_id, c.first_contacted_at, c.last_contacted_at,
         tm.name as member_name, tm.email as member_email
  INTO v_contact
  FROM public.contacts c
  LEFT JOIN public.team_members tm ON tm.id = COALESCE(c.owner_user_id, c.last_contacted_by_user_id)
  WHERE lower(c.email) = v_clean_email;

  IF FOUND AND v_contact.owner_user_id IS NOT NULL AND v_contact.owner_user_id <> p_user_id THEN
    RETURN QUERY SELECT 
      true, 
      v_contact.owner_user_id, 
      COALESCE(v_contact.member_name, 'Another teammate'),
      COALESCE(v_contact.member_email, ''),
      v_contact.first_contacted_at,
      v_contact.last_contacted_at;
  ELSE
    RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
  END IF;
END;
$$;

-- 3. Check DNC List
CREATE OR REPLACE FUNCTION public.is_do_not_contact(p_email TEXT)
RETURNS TABLE (
  is_blocked BOOLEAN,
  reason TEXT,
  source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_email TEXT := lower(trim(p_email));
  v_domain TEXT := split_part(v_clean_email, '@', 2);
  v_match RECORD;
BEGIN
  SELECT dnc.reason, dnc.source
  INTO v_match
  FROM public.do_not_contact dnc
  WHERE (dnc.type = 'email' AND dnc.value = v_clean_email)
     OR (dnc.type = 'domain' AND dnc.value = v_domain)
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_match.reason, v_match.source;
  ELSE
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT;
  END IF;
END;
$$;

-- 4. Record Account Send and Validate Cap
CREATE OR REPLACE FUNCTION public.record_account_send(
  p_account_id UUID,
  p_user_id UUID,
  p_contact_email TEXT,
  p_is_reply BOOLEAN
)
RETURNS TABLE (
  allowed BOOLEAN,
  sent_today INT,
  effective_cap INT,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account RECORD;
  v_current_pkt_date DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date;
  v_outreach_sent_today INT;
  v_effective_cap INT;
BEGIN
  SELECT id, owner_user_id, status
  INTO v_account
  FROM public.gmail_accounts
  WHERE id = p_account_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 0, 'Mailbox account not found'::TEXT;
    RETURN;
  END IF;

  IF v_account.owner_user_id <> p_user_id THEN
    RETURN QUERY SELECT false, 0, 0, 'Forbidden: You cannot send emails from another teammate''s mailbox.'::TEXT;
    RETURN;
  END IF;

  IF v_account.status = 'paused' THEN
    RETURN QUERY SELECT false, 0, 0, 'This mailbox outreach is paused due to health/bounce limits.'::TEXT;
    RETURN;
  ELSIF v_account.status = 'needs_reconnect' THEN
    RETURN QUERY SELECT false, 0, 0, 'This mailbox needs to be reconnected with Google.'::TEXT;
    RETURN;
  END IF;

  -- Calculate effective cap
  v_effective_cap := public.get_account_warmup_limit(p_account_id);

  -- Count outreach sent today (replies do not count against outreach cap)
  SELECT COUNT(*)::INT
  INTO v_outreach_sent_today
  FROM public.account_send_logs
  WHERE account_id = p_account_id
    AND pkt_date = v_current_pkt_date
    AND is_reply = false;

  IF NOT p_is_reply AND v_outreach_sent_today >= v_effective_cap THEN
    RETURN QUERY SELECT false, v_outreach_sent_today, v_effective_cap, 
      format('Daily outreach cap reached (%s/%s). Resets at midnight Pakistan Time (PKT).', v_outreach_sent_today, v_effective_cap);
    RETURN;
  END IF;

  -- Log the send
  INSERT INTO public.account_send_logs (
    account_id, user_id, contact_email, is_reply, sent_at, pkt_date
  ) VALUES (
    p_account_id, p_user_id, lower(trim(p_contact_email)), p_is_reply, now(), v_current_pkt_date
  );

  -- Update contact last contacted and ownership
  UPDATE public.contacts
  SET owner_user_id = COALESCE(owner_user_id, p_user_id),
      last_contacted_by_user_id = p_user_id,
      last_contacted_at = now()
  WHERE lower(email) = lower(trim(p_contact_email));

  RETURN QUERY SELECT true, (v_outreach_sent_today + CASE WHEN p_is_reply THEN 0 ELSE 1 END), v_effective_cap, NULL::TEXT;
END;
$$;

-- 5. Record Bounce and Health Monitor
-- Pauses account if bounce rate > 5% in the last 20 sends
CREATE OR REPLACE FUNCTION public.record_account_bounce(
  p_account_id UUID,
  p_contact_email TEXT
)
RETURNS TABLE (
  was_paused BOOLEAN,
  bounce_count_last_20 INT,
  total_sends_last_20 INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent RECORD;
  v_bounces INT := 0;
  v_total INT := 0;
  v_paused BOOLEAN := false;
BEGIN
  -- Mark contact as bad email
  UPDATE public.contacts
  SET is_bad_email = true,
      bounce_count = bounce_count + 1,
      bounce_reason = 'Delivery status notification failure',
      status = 'Cold'
  WHERE lower(email) = lower(trim(p_contact_email));

  -- Record bounce in send logs
  INSERT INTO public.account_send_logs (
    account_id, user_id, contact_email, is_reply, is_bounce, sent_at
  ) 
  SELECT p_account_id, owner_user_id, lower(trim(p_contact_email)), false, true, now()
  FROM public.gmail_accounts
  WHERE id = p_account_id;

  -- Analyze last 20 sends for this account
  SELECT 
    COUNT(*)::INT as total,
    COUNT(CASE WHEN is_bounce THEN 1 END)::INT as bounces
  INTO v_recent
  FROM (
    SELECT is_bounce
    FROM public.account_send_logs
    WHERE account_id = p_account_id
    ORDER BY id DESC
    LIMIT 20
  ) sub;

  v_total := COALESCE(v_recent.total, 0);
  v_bounces := COALESCE(v_recent.bounces, 0);

  -- If bounces exceed 5% of last 20 sends (e.g. >= 2 bounces out of up to 20, or >= 1 out of 10)
  IF (v_total >= 10 AND (v_bounces::FLOAT / v_total::FLOAT) > 0.05) OR (v_bounces >= 2) THEN
    UPDATE public.gmail_accounts
    SET status = 'paused',
        pause_reason = format('Bounce rate exceeds threshold (%s bounces in last %s sends)', v_bounces, v_total),
        updated_at = now()
    WHERE id = p_account_id;

    v_paused := true;

    INSERT INTO public.audit_log (action, metadata)
    VALUES ('mailbox.auto_paused_bounces', jsonb_build_object(
      'accountId', p_account_id,
      'bounces', v_bounces,
      'total', v_total
    ));
  END IF;

  RETURN QUERY SELECT v_paused, v_bounces, v_total;
END;
$$;

-- 6. "Today" Dashboard Stats Aggregator
CREATE OR REPLACE FUNCTION public.get_today_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_pkt_date DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date;
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'teamTotals', jsonb_build_object(
      'sentToday', (
        SELECT COUNT(*)::INT 
        FROM public.account_send_logs 
        WHERE pkt_date = v_current_pkt_date AND is_bounce = false
      ),
      'repliesToday', (
        SELECT COUNT(*)::INT 
        FROM public.messages 
        WHERE direction = 'inbound' 
          AND is_auto_reply = false 
          AND is_bounce = false 
          AND (sent_at AT TIME ZONE 'Asia/Karachi')::date = v_current_pkt_date
      ),
      'bouncesToday', (
        SELECT COUNT(*)::INT 
        FROM public.account_send_logs 
        WHERE pkt_date = v_current_pkt_date AND is_bounce = true
      ),
      'dueReminders', (
        SELECT COUNT(*)::INT 
        FROM public.reminders 
        WHERE status = 'pending' AND due_at <= now()
      )
    ),
    'accounts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ga.id,
          'ownerUserId', ga.owner_user_id,
          'ownerName', tm.name,
          'ownerInitials', tm.initials,
          'ownerColor', tm.color,
          'email', ga.email,
          'status', ga.status,
          'pauseReason', ga.pause_reason,
          'dailyCap', ga.daily_cap,
          'warmupLimit', public.get_account_warmup_limit(ga.id),
          'warmupStartedAt', ga.warmup_started_at,
          'warmupOverride', ga.warmup_override,
          'sentToday', COALESCE((
            SELECT COUNT(*)::INT 
            FROM public.account_send_logs asl 
            WHERE asl.account_id = ga.id 
              AND asl.pkt_date = v_current_pkt_date 
              AND asl.is_reply = false 
              AND asl.is_bounce = false
          ), 0),
          'repliesToday', COALESCE((
            SELECT COUNT(*)::INT 
            FROM public.messages m 
            WHERE m.account_id = ga.id 
              AND m.direction = 'inbound' 
              AND m.is_auto_reply = false 
              AND m.is_bounce = false 
              AND (m.sent_at AT TIME ZONE 'Asia/Karachi')::date = v_current_pkt_date
          ), 0),
          'bouncesToday', COALESCE((
            SELECT COUNT(*)::INT 
            FROM public.account_send_logs asl 
            WHERE asl.account_id = ga.id 
              AND asl.pkt_date = v_current_pkt_date 
              AND asl.is_bounce = true
          ), 0),
          'dueReminders', COALESCE((
            SELECT COUNT(*)::INT 
            FROM public.reminders r 
            WHERE r.user_id = ga.owner_user_id 
              AND r.status = 'pending' 
              AND r.due_at <= now()
          ), 0)
        )
      )
      FROM public.gmail_accounts ga
      JOIN public.team_members tm ON tm.id = ga.owner_user_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Grant permissions to authenticated and service_role
GRANT SELECT, INSERT, UPDATE ON public.gmail_accounts TO authenticated;
GRANT ALL ON public.gmail_accounts TO service_role;
GRANT SELECT, INSERT, DELETE ON public.do_not_contact TO authenticated;
GRANT ALL ON public.do_not_contact TO service_role;
GRANT SELECT, INSERT ON public.outbound_queue TO authenticated;
GRANT ALL ON public.outbound_queue TO service_role;
GRANT SELECT ON public.account_send_logs TO authenticated;
GRANT ALL ON public.account_send_logs TO service_role;

GRANT EXECUTE ON FUNCTION public.get_account_warmup_limit(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_contact_collision(TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_do_not_contact(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_account_send(UUID, UUID, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_account_bounce(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_today_dashboard_stats() TO authenticated, service_role;
-- ==============================================================================
-- Basim CRM: Initial Team & Mailbox Setup Script
-- File: supabase/seed/setup_initial_team.sql
-- Run this in the Supabase SQL Editor AFTER applying the 3 migrations:
--   1. 20261111000000_init.sql
--   2. 20261111000001_production_features.sql
--   3. 20261111000002_multi_mailbox.sql
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_basim_id UUID;
  v_ali_id   UUID;
  v_moiz_id  UUID;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. Create or Find Basim (Admin)
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_basim_id FROM auth.users WHERE email = 'basim@ourteam.io';
  
  IF v_basim_id IS NULL THEN
    v_basim_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_basim_id,
      'authenticated',
      'authenticated',
      'basim@ourteam.io',
      crypt('AdminPassword123!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"name":"Basim"}',
      now(),
      now()
    );
  END IF;

  INSERT INTO public.team_members (id, name, email, role, avatar_color, is_active)
  VALUES (v_basim_id, 'Basim', 'basim@ourteam.io', 'admin', '#0A84FF', true)
  ON CONFLICT (id) DO UPDATE 
    SET name = 'Basim', role = 'admin', avatar_color = '#0A84FF', is_active = true;

  -- ---------------------------------------------------------------------------
  -- 2. Create or Find Ali Shah (Member)
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_ali_id FROM auth.users WHERE email = 'alishah@ourteam.io';
  
  IF v_ali_id IS NULL THEN
    v_ali_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_ali_id,
      'authenticated',
      'authenticated',
      'alishah@ourteam.io',
      crypt('TeammatePassword123!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"name":"Ali Shah"}',
      now(),
      now()
    );
  END IF;

  INSERT INTO public.team_members (id, name, email, role, avatar_color, is_active)
  VALUES (v_ali_id, 'Ali Shah', 'alishah@ourteam.io', 'member', '#5E5CE6', true)
  ON CONFLICT (id) DO UPDATE 
    SET name = 'Ali Shah', role = 'member', avatar_color = '#5E5CE6', is_active = true;

  -- ---------------------------------------------------------------------------
  -- 3. Create or Find Moiz Ali (Member)
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_moiz_id FROM auth.users WHERE email = 'moiz@ourteam.io';
  
  IF v_moiz_id IS NULL THEN
    v_moiz_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_moiz_id,
      'authenticated',
      'authenticated',
      'moiz@ourteam.io',
      crypt('TeammatePassword123!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"name":"Moiz Ali"}',
      now(),
      now()
    );
  END IF;

  INSERT INTO public.team_members (id, name, email, role, avatar_color, is_active)
  VALUES (v_moiz_id, 'Moiz Ali', 'moiz@ourteam.io', 'member', '#30D158', true)
  ON CONFLICT (id) DO UPDATE 
    SET name = 'Moiz Ali', role = 'member', avatar_color = '#30D158', is_active = true;

  -- ---------------------------------------------------------------------------
  -- 4. Initial Personal Mailbox Rows (gmail_accounts)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.gmail_accounts (
    owner_user_id,
    email,
    status,
    daily_cap,
    warmup_started_at,
    warmup_override
  ) VALUES 
    (v_basim_id, 'basim@gmail.com', 'active', 5, now(), false),
    (v_ali_id, 'alishah@gmail.com', 'active', 5, now(), false),
    (v_moiz_id, 'moiz@gmail.com', 'active', 5, now(), false)
  ON CONFLICT (email) DO NOTHING;

END $$;
