-- ==============================================================================
-- Migration: 07_prospects.sql
-- Description: Adds shared Prospects & Prospect Socials tables with strict
--              normalization, unique duplicate constraints, full-text GIN search,
--              and RLS policies using public.is_team_member().
-- ==============================================================================

-- 1. Normalization Functions in SQL (matches lib/prospect-normalization.ts)
CREATE OR REPLACE FUNCTION public.normalize_email(raw_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cleaned TEXT;
  local_part TEXT;
  domain_part TEXT;
BEGIN
  IF raw_email IS NULL THEN
    RETURN NULL;
  END IF;

  cleaned := lower(btrim(raw_email));
  IF cleaned = '' OR position('@' in cleaned) = 0 THEN
    RETURN NULL;
  END IF;

  local_part := split_part(cleaned, '@', 1);
  domain_part := split_part(cleaned, '@', 2);

  IF local_part = '' OR domain_part = '' THEN
    RETURN NULL;
  END IF;

  -- Canonicalize googlemail.com to gmail.com and strip dots + plus-tags
  IF domain_part IN ('gmail.com', 'googlemail.com') THEN
    domain_part := 'gmail.com';
    local_part := split_part(local_part, '+', 1);
    local_part := replace(local_part, '.', '');
  END IF;

  RETURN local_part || '@' || domain_part;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_social_handle(p_platform TEXT, raw_handle TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  h TEXT;
BEGIN
  IF raw_handle IS NULL THEN
    RETURN '';
  END IF;

  h := lower(btrim(raw_handle));
  -- Strip query string and fragment
  h := split_part(h, '?', 1);
  h := split_part(h, '#', 1);

  -- Strip protocol
  h := regexp_replace(h, '^https?://', '');
  -- Strip www. / m. / mobile.
  h := regexp_replace(h, '^(www\.|m\.|mobile\.)', '');

  -- Strip known social domain prefixes
  h := regexp_replace(h, '^(instagram\.com/|instagr\.am/)', '');
  h := regexp_replace(h, '^(facebook\.com/profile\.php\?id=|facebook\.com/|fb\.com/)', '');
  h := regexp_replace(h, '^(linkedin\.com/in/|linkedin\.com/company/|linkedin\.com/school/|linkedin\.com/)', '');
  h := regexp_replace(h, '^(tiktok\.com/@|tiktok\.com/)', '');
  h := regexp_replace(h, '^(x\.com/|twitter\.com/)', '');
  h := regexp_replace(h, '^(youtube\.com/@|youtube\.com/c/|youtube\.com/channel/|youtube\.com/user/|youtube\.com/|youtu\.be/)', '');

  -- Strip leading/trailing slashes and leading @
  h := btrim(h, '/ ');
  h := regexp_replace(h, '^@+', '');
  h := btrim(h, '/ ');

  -- For handle-based platforms, keep only the primary handle segment if path has extra segments
  IF p_platform IN ('instagram', 'tiktok', 'x', 'facebook', 'linkedin', 'youtube') AND position('/' in h) > 0 THEN
    h := split_part(h, '/', 1);
  END IF;

  h := regexp_replace(h, '^@+', '');
  RETURN btrim(h, '/ ');
END;
$$;

-- 2. Create prospects table
CREATE TABLE IF NOT EXISTS public.prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) > 0 AND char_length(full_name) <= 200),
  company TEXT NOT NULL DEFAULT '' CHECK (char_length(company) <= 200),
  email TEXT NULL CHECK (email IS NULL OR char_length(email) <= 320),
  email_normalized TEXT NULL CHECK (email_normalized IS NULL OR char_length(email_normalized) <= 320),
  phone TEXT NULL CHECK (phone IS NULL OR char_length(phone) <= 60),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 5000),
  source TEXT NOT NULL DEFAULT '' CHECK (char_length(source) <= 120),
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'assigned', 'contacted', 'replied', 'not_interested', 'bad_email', 'do_not_contact')
  ),
  added_by UUID NOT NULL REFERENCES public.team_members(id) ON DELETE RESTRICT,
  assigned_to UUID NULL REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  contacted_at TIMESTAMPTZ NULL,
  contact_id UUID NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
  socials_search_text TEXT NOT NULL DEFAULT '',
  search_tsv TSVECTOR
);

-- 3. Create prospect_socials table
CREATE TABLE IF NOT EXISTS public.prospect_socials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (
    platform IN ('instagram', 'facebook', 'linkedin', 'tiktok', 'x', 'youtube', 'website', 'other')
  ),
  handle TEXT NOT NULL CHECK (char_length(btrim(handle)) > 0 AND char_length(handle) <= 500),
  handle_normalized TEXT NOT NULL CHECK (char_length(btrim(handle_normalized)) > 0 AND char_length(handle_normalized) <= 500),
  profile_url TEXT NOT NULL CHECK (char_length(btrim(profile_url)) > 0 AND char_length(profile_url) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT prospect_socials_platform_handle_unique UNIQUE (platform, handle_normalized)
);

-- 4. Unique & Performance Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_email_normalized_unique
  ON public.prospects (email_normalized)
  WHERE email_normalized IS NOT NULL AND email_normalized <> '';

CREATE INDEX IF NOT EXISTS idx_prospect_socials_platform_handle
  ON public.prospect_socials (platform, handle_normalized);

CREATE INDEX IF NOT EXISTS idx_prospect_socials_prospect_id
  ON public.prospect_socials (prospect_id);

CREATE INDEX IF NOT EXISTS idx_prospects_status
  ON public.prospects (status);

CREATE INDEX IF NOT EXISTS idx_prospects_assigned_to
  ON public.prospects (assigned_to);

CREATE INDEX IF NOT EXISTS idx_prospects_contact_id
  ON public.prospects (contact_id);

CREATE INDEX IF NOT EXISTS idx_prospects_created_at
  ON public.prospects (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prospects_search_tsv
  ON public.prospects USING GIN (search_tsv);

-- 5. Triggers to enforce normalization and maintain full-text search tsvector
CREATE OR REPLACE FUNCTION public.prospects_before_write_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.full_name := btrim(COALESCE(NEW.full_name, ''));
  NEW.company := btrim(COALESCE(NEW.company, ''));
  NEW.notes := COALESCE(NEW.notes, '');
  NEW.source := btrim(COALESCE(NEW.source, ''));

  IF NEW.email IS NOT NULL AND btrim(NEW.email) <> '' THEN
    NEW.email := lower(btrim(NEW.email));
    NEW.email_normalized := public.normalize_email(NEW.email);
  ELSE
    NEW.email := NULL;
    NEW.email_normalized := NULL;
  END IF;

  IF NEW.phone IS NOT NULL AND btrim(NEW.phone) = '' THEN
    NEW.phone := NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;

  NEW.search_tsv :=
    setweight(to_tsvector('simple', COALESCE(NEW.full_name, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.company, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.email, '') || ' ' || COALESCE(NEW.email_normalized, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.socials_search_text, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.notes, '') || ' ' || COALESCE(NEW.source, '')), 'C');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prospects_before_write ON public.prospects;
CREATE TRIGGER trg_prospects_before_write
  BEFORE INSERT OR UPDATE ON public.prospects
  FOR EACH ROW
  EXECUTE FUNCTION public.prospects_before_write_trigger();

CREATE OR REPLACE FUNCTION public.prospect_socials_before_write_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.platform := lower(btrim(NEW.platform));
  NEW.handle := btrim(NEW.handle);
  NEW.handle_normalized := public.normalize_social_handle(NEW.platform, NEW.handle);
  NEW.profile_url := btrim(NEW.profile_url);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prospect_socials_before_write ON public.prospect_socials;
CREATE TRIGGER trg_prospect_socials_before_write
  BEFORE INSERT OR UPDATE ON public.prospect_socials
  FOR EACH ROW
  EXECUTE FUNCTION public.prospect_socials_before_write_trigger();

-- Sync social handles into prospects.socials_search_text so GIN index searches handles too
CREATE OR REPLACE FUNCTION public.sync_prospect_socials_search_text()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_id UUID;
  combined_handles TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.prospect_id;
  ELSE
    target_id := NEW.prospect_id;
  END IF;

  SELECT COALESCE(string_agg(platform || ' ' || handle || ' ' || handle_normalized, ' '), '')
  INTO combined_handles
  FROM public.prospect_socials
  WHERE prospect_id = target_id;

  UPDATE public.prospects
  SET socials_search_text = combined_handles
  WHERE id = target_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prospect_socials_sync_fts ON public.prospect_socials;
CREATE TRIGGER trg_prospect_socials_sync_fts
  AFTER INSERT OR UPDATE OR DELETE ON public.prospect_socials
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_prospect_socials_search_text();

-- 6. Atomic "Next Up" RPC so two teammates never grab the same prospect simultaneously
CREATE OR REPLACE FUNCTION public.claim_next_prospect(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prospect_id UUID;
BEGIN
  IF NOT public.is_team_member() THEN
    RAISE EXCEPTION 'Unauthorized: team member access required';
  END IF;

  -- Prefer already assigned to this user (status 'assigned' or 'new'), then unassigned 'new' with an email
  SELECT p.id
  INTO v_prospect_id
  FROM public.prospects p
  WHERE p.email IS NOT NULL
    AND p.email <> ''
    AND p.status IN ('new', 'assigned')
    AND (p.assigned_to = p_user_id OR p.assigned_to IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.do_not_contact d
      WHERE lower(d.value) = p.email
         OR lower(d.value) = split_part(p.email, '@', 2)
    )
  ORDER BY
    CASE WHEN p.assigned_to = p_user_id THEN 0 ELSE 1 END ASC,
    p.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_prospect_id IS NOT NULL THEN
    UPDATE public.prospects
    SET assigned_to = p_user_id,
        status = 'assigned',
        updated_at = now()
    WHERE id = v_prospect_id;
  END IF;

  RETURN v_prospect_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_next_prospect(UUID) TO authenticated, service_role;

-- 7. Row Level Security (RLS) with public.is_team_member()
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_socials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prospects: team members select" ON public.prospects;
CREATE POLICY "prospects: team members select"
  ON public.prospects FOR SELECT TO authenticated
  USING (public.is_team_member());

DROP POLICY IF EXISTS "prospects: team members insert" ON public.prospects;
CREATE POLICY "prospects: team members insert"
  ON public.prospects FOR INSERT TO authenticated
  WITH CHECK (public.is_team_member() AND added_by = auth.uid());

DROP POLICY IF EXISTS "prospects: team members update" ON public.prospects;
CREATE POLICY "prospects: team members update"
  ON public.prospects FOR UPDATE TO authenticated
  USING (public.is_team_member())
  WITH CHECK (public.is_team_member());

DROP POLICY IF EXISTS "prospects: creator or admin delete" ON public.prospects;
CREATE POLICY "prospects: creator or admin delete"
  ON public.prospects FOR DELETE TO authenticated
  USING (
    public.is_team_member()
    AND (
      added_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.id = auth.uid() AND tm.role = 'admin' AND tm.is_active = true
      )
    )
  );

DROP POLICY IF EXISTS "prospect_socials: team members select" ON public.prospect_socials;
CREATE POLICY "prospect_socials: team members select"
  ON public.prospect_socials FOR SELECT TO authenticated
  USING (public.is_team_member());

DROP POLICY IF EXISTS "prospect_socials: team members insert" ON public.prospect_socials;
CREATE POLICY "prospect_socials: team members insert"
  ON public.prospect_socials FOR INSERT TO authenticated
  WITH CHECK (public.is_team_member());

DROP POLICY IF EXISTS "prospect_socials: team members update" ON public.prospect_socials;
CREATE POLICY "prospect_socials: team members update"
  ON public.prospect_socials FOR UPDATE TO authenticated
  USING (public.is_team_member())
  WITH CHECK (public.is_team_member());

DROP POLICY IF EXISTS "prospect_socials: team members delete" ON public.prospect_socials;
CREATE POLICY "prospect_socials: team members delete"
  ON public.prospect_socials FOR DELETE TO authenticated
  USING (public.is_team_member());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospects TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospect_socials TO authenticated, service_role;

-- 8. Add prospects to Realtime publication
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.prospects;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END;
$$;
