-- ==============================================================================
-- Migration: 08_gmail_security_and_sync.sql / 20261111000003_gmail_security_and_sync.sql
-- Description: Adds connected_gmail to team_members, tightens gmail_accounts RLS
--              to prevent token column reads from authenticated clients, and
--              adds owner uniqueness constraint on gmail_accounts.
-- ==============================================================================

-- 1. Ensure connected_gmail exists on team_members
ALTER TABLE public.team_members 
  ADD COLUMN IF NOT EXISTS connected_gmail TEXT;

-- 2. Ensure bcc_email exists on messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS bcc_email TEXT;

-- 3. Unique index on gmail_accounts(owner_user_id) so each teammate has at most 1 primary mailbox
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_gmail_accounts_owner_user'
  ) THEN
    ALTER TABLE public.gmail_accounts
      ADD CONSTRAINT uq_gmail_accounts_owner_user UNIQUE (owner_user_id);
  END IF;
EXCEPTION
  WHEN duplicate_table OR duplicate_object THEN
    NULL;
END $$;

-- 4. Column-level security on gmail_accounts:
-- Revoke token column from authenticated users, grant safe metadata columns only
REVOKE SELECT ON public.gmail_accounts FROM authenticated;

GRANT SELECT (
  id, 
  owner_user_id, 
  email, 
  status, 
  connected_at, 
  history_id, 
  last_sync_at, 
  sync_locked_until, 
  daily_cap, 
  warmup_started_at, 
  warmup_override, 
  pause_reason, 
  created_at, 
  updated_at
) ON public.gmail_accounts TO authenticated;

-- Service role retains full access to all columns
GRANT ALL ON public.gmail_accounts TO service_role;

-- 5. Row Level Security policies on gmail_accounts
ALTER TABLE public.gmail_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members can view gmail accounts metadata" ON public.gmail_accounts;
CREATE POLICY "Team members can view gmail accounts metadata"
  ON public.gmail_accounts
  FOR SELECT
  TO authenticated
  USING (public.is_team_member());

DROP POLICY IF EXISTS "Team members can update own gmail account" ON public.gmail_accounts;
CREATE POLICY "Team members can update own gmail account"
  ON public.gmail_accounts
  FOR UPDATE
  TO authenticated
  USING (owner_user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Service role full access on gmail accounts" ON public.gmail_accounts;
CREATE POLICY "Service role full access on gmail accounts"
  ON public.gmail_accounts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
