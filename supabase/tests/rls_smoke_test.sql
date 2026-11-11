-- =====================================================================
-- RLS smoke test. Run in the Supabase SQL Editor AFTER the migration and
-- the team_members seed. Everything runs inside a transaction that is
-- ROLLED BACK at the end: no data is left behind.
--
-- Expected: a list of NOTICE lines starting with "PASS". Any failure stops
-- the script with an error starting with "FAIL".
-- =====================================================================
begin;

-- Pick one admin and one member (no hardcoded ids/emails).
select set_config('test.admin_id',  (select id::text from public.team_members where role = 'admin'  order by created_at limit 1), true);
select set_config('test.member_id', (select id::text from public.team_members where role = 'member' order by created_at limit 1), true);

do $$
begin
  if coalesce(current_setting('test.admin_id', true), '') = '' or coalesce(current_setting('test.member_id', true), '') = '' then
    raise exception 'FAIL: need at least 1 admin and 1 member in team_members (run the seed first)';
  end if;
end $$;

-- Fixture data (as the SQL editor owner, bypassing RLS).
insert into public.contacts (id, email, name) values ('00000000-0000-0000-0000-0000000000c1', 'rls-test@example.com', 'RLS Test');
insert into public.threads  (id, gmail_thread_id, subject) values ('00000000-0000-0000-0000-0000000000a1', 'rls-test-thread', 'RLS test');

-- ---------------------------------------------------------------- anon
set local role anon;
do $$
begin
  begin
    perform 1 from public.contacts limit 1;
    raise exception 'FAIL: anon can read contacts';
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot read contacts';
  end;
  begin
    perform 1 from public.team_members limit 1;
    raise exception 'FAIL: anon can read team_members';
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot read team_members';
  end;
end $$;
reset role;

-- ---------------------------------------- authenticated, NOT a team member
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-2222-3333-4444-555555555555', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.contacts) <> 0 then raise exception 'FAIL: non-member sees contacts'; end if;
  if (select count(*) from public.team_members) <> 0 then raise exception 'FAIL: non-member sees team_members'; end if;
  raise notice 'PASS: authenticated non-member sees nothing';
end $$;
reset role;

-- ------------------------------------------------- member, before MFA (aal1)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.member_id'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.team_members) <> 1 then
    raise exception 'FAIL: aal1 member should see exactly their own team_members row';
  end if;
  if (select count(*) from public.contacts) <> 0 then
    raise exception 'FAIL: aal1 member can read contacts before MFA';
  end if;
  raise notice 'PASS: member before MFA sees only own profile, no data';
end $$;
reset role;

-- ------------------------------------------------- member, after MFA (aal2)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.member_id'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
do $$
declare n int;
begin
  if (select count(*) from public.contacts where email = 'rls-test@example.com') <> 1 then
    raise exception 'FAIL: aal2 member cannot read contacts';
  end if;
  raise notice 'PASS: verified member reads contacts';

  update public.contacts set status = 'meeting' where id = '00000000-0000-0000-0000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: member cannot update contact status'; end if;
  raise notice 'PASS: member can update contact status';

  begin
    update public.contacts set email = 'hijack@example.com' where id = '00000000-0000-0000-0000-0000000000c1';
    raise exception 'FAIL: member can change contact email';
  exception when insufficient_privilege then
    raise notice 'PASS: member cannot change contact email (column grant)';
  end;

  update public.threads set status = 'waiting' where id = '00000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: member cannot change thread status'; end if;
  raise notice 'PASS: member can change thread status';

  begin
    update public.threads set subject = 'x' where id = '00000000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL: member can change thread subject';
  exception when insufficient_privilege then
    raise notice 'PASS: member cannot change thread subject';
  end;

  begin
    insert into public.messages (thread_id, gmail_message_id, direction, sent_at)
    values ('00000000-0000-0000-0000-0000000000a1', 'x', 'inbound', now());
    raise exception 'FAIL: member can insert messages';
  exception when insufficient_privilege then
    raise notice 'PASS: member cannot insert messages (server only)';
  end;

  begin
    perform 1 from public.gmail_account;
    raise exception 'FAIL: member can read gmail_account';
  exception when insufficient_privilege then
    raise notice 'PASS: member cannot read gmail_account';
  end;

  begin
    perform 1 from public.sync_state;
    raise exception 'FAIL: member can read sync_state';
  exception when insufficient_privilege then
    raise notice 'PASS: member cannot read sync_state';
  end;

  begin
    perform public.upsert_contact_touch('a@b.co', null, null, 'inbound', now(), null);
    raise exception 'FAIL: member can call server-only RPC';
  exception when insufficient_privilege then
    raise notice 'PASS: member cannot call server-only RPCs';
  end;

  if (select count(*) from public.audit_log) <> 0 then
    raise exception 'FAIL: member can read audit_log';
  end if;
  raise notice 'PASS: member cannot read audit_log';

  update public.team_members set role = 'admin' where id = current_setting('test.member_id')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: member promoted themselves to admin'; end if;
  raise notice 'PASS: member cannot edit team_members';

  insert into public.internal_notes (contact_id, note_content)
  values ('00000000-0000-0000-0000-0000000000c1', 'test note');
  raise notice 'PASS: member can add a note (author = self by default)';

  begin
    insert into public.internal_notes (contact_id, note_content, user_id)
    values ('00000000-0000-0000-0000-0000000000c1', 'spoof', current_setting('test.admin_id')::uuid);
    raise exception 'FAIL: member can post a note as someone else';
  exception when insufficient_privilege then
    raise notice 'PASS: member cannot post a note as someone else';
  end;

  insert into public.thread_locks (thread_id, expires_at)
  values ('00000000-0000-0000-0000-0000000000a1', now() + interval '1 day');
  if (select expires_at from public.thread_locks
        where thread_id = '00000000-0000-0000-0000-0000000000a1') > now() + interval '2 minutes 1 second' then
    raise exception 'FAIL: thread lock expiry was not clamped';
  end if;
  raise notice 'PASS: thread lock expiry clamped to 2 minutes';

  if (select count(*) from public.get_gmail_status()) <> 1 then
    raise exception 'FAIL: get_gmail_status() not available to members';
  end if;
  raise notice 'PASS: member can read token-free Gmail status';
end $$;
reset role;

-- ------------------------------------------------------- admin, aal2
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.admin_id'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.audit_log where action in ('threads.status')) < 1 then
    raise exception 'FAIL: admin cannot see audit entries (or status change was not audited)';
  end if;
  raise notice 'PASS: thread status change was audited and admin can read audit_log';

  begin
    perform 1 from public.gmail_account;
    raise exception 'FAIL: admin client can read gmail_account directly';
  exception when insufficient_privilege then
    raise notice 'PASS: even admin clients cannot read gmail_account (service role only)';
  end;

  begin
    update public.team_members set role = 'member' where id = current_setting('test.admin_id')::uuid;
    raise exception 'FAIL: last admin could demote themselves';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS: last admin cannot be demoted';
  end;
end $$;
reset role;

-- --------------------------------------------- server-side lock functions
do $$
declare t1 uuid; t2 uuid;
begin
  t1 := public.acquire_sync_lock(60);
  t2 := public.acquire_sync_lock(60);
  if t1 is null or t2 is not null then raise exception 'FAIL: sync lock allowed overlap'; end if;
  if public.release_sync_lock(gen_random_uuid()) then raise exception 'FAIL: wrong token released lock'; end if;
  if not public.release_sync_lock(t1) then raise exception 'FAIL: owner could not release lock'; end if;
  raise notice 'PASS: sync lock prevents overlapping runs';
end $$;

rollback;
