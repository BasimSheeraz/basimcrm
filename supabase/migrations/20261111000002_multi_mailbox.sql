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

-- Only the owner or an admin can update account settings (e.g. daily cap, pause/resume)
DROP POLICY IF EXISTS "Account owners and admins can update accounts" ON public.gmail_accounts;
CREATE POLICY "Account owners and admins can update accounts"
  ON public.gmail_accounts
  FOR UPDATE
  TO authenticated
  USING (
    public.is_team_admin() OR 
    owner_user_id = (SELECT id FROM public.team_members WHERE user_id = auth.uid() AND is_active = true)
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
    user_id = (SELECT id FROM public.team_members WHERE user_id = auth.uid() AND is_active = true)
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
