-- =====================================================================
-- Link the 3 Supabase Auth users into public.team_members
--
-- 1. Create the 3 users first in: Supabase Dashboard -> Authentication ->
--    Users -> "Add user" -> "Create new user" (tick "Auto Confirm User").
-- 2. Paste THIS FILE into the SQL Editor, replace the 3 REPLACE_WITH_...
--    placeholders with the real login emails IN THE EDITOR ONLY.
--    Do not commit real emails back into this file.
-- 3. Run. It is idempotent: safe to run again to fix a name/colour.
--
-- Basim must stay first: the "at least one admin" guard needs an admin
-- to exist before members are updated.
-- =====================================================================
do $$
declare
  v_members jsonb := '[
    {"email": "REPLACE_WITH_BASIM_EMAIL", "name": "Basim", "role": "admin",  "color": "#2563eb"},
    {"email": "REPLACE_WITH_MOIZ_EMAIL",  "name": "Moiz",  "role": "member", "color": "#9333ea"},
    {"email": "REPLACE_WITH_ALI_EMAIL",   "name": "Ali",   "role": "member", "color": "#059669"}
  ]'::jsonb;
  r     jsonb;
  v_id  uuid;
  v_em  text;
begin
  for r in select * from jsonb_array_elements(v_members) loop
    v_em := lower(btrim(r ->> 'email'));

    if v_em like 'replace_with_%' then
      raise exception 'Replace the placeholder emails before running this script.';
    end if;

    select u.id into v_id from auth.users u where lower(u.email) = v_em;
    if v_id is null then
      raise exception 'No Supabase Auth user found for %. Create it in Authentication -> Users first.', v_em;
    end if;

    insert into public.team_members (id, name, email, role, avatar_color)
    values (v_id, r ->> 'name', v_em, r ->> 'role', r ->> 'color')
    on conflict (id) do update
      set name         = excluded.name,
          email        = excluded.email,
          role         = excluded.role,
          avatar_color = excluded.avatar_color;

    raise notice 'Linked % as % (%)', r ->> 'name', r ->> 'role', v_id;
  end loop;
end;
$$;

-- Verify: should return exactly 3 rows, 1 admin + 2 members.
select name, email, role, avatar_color from public.team_members order by role, name;
