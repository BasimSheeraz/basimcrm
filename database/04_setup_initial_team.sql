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
