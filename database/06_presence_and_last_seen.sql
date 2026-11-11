-- ==============================================================================
-- Migration: 06_presence_and_last_seen.sql
-- Description: Adds last_seen_at tracking, updates team_members RLS for real-time presence,
--              and provides update_my_last_seen RPC for authenticated teammates.
-- ==============================================================================

-- 1. Add last_seen_at column to team_members
ALTER TABLE public.team_members 
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now();

-- 2. Allow all active team members to read all teammates
DROP POLICY IF EXISTS "team_members: verified members read all" ON public.team_members;
DROP POLICY IF EXISTS "team_members: members read all" ON public.team_members;
CREATE POLICY "team_members: members read all"
  ON public.team_members FOR SELECT TO authenticated
  USING (public.is_team_member());

-- 3. Allow teammates to update their own last_seen_at
DROP POLICY IF EXISTS "team_members: update own last_seen" ON public.team_members;
CREATE POLICY "team_members: update own last_seen"
  ON public.team_members FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

GRANT SELECT ON public.team_members TO authenticated;
GRANT UPDATE (last_seen_at) ON public.team_members TO authenticated;

-- 4. Lightweight RPC for updating presence timestamp
CREATE OR REPLACE FUNCTION public.update_my_last_seen()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.team_members
  SET last_seen_at = now()
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_my_last_seen() TO authenticated, service_role;

-- 5. Add team_members to Realtime publication
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.team_members;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END;
$$;
