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
