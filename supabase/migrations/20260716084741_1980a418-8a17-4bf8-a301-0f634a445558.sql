
-- ============================================================
-- Roles
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own roles" ON public.user_roles;
CREATE POLICY "read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, anon, service_role;

-- ============================================================
-- Product events
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  anonymous_session_id TEXT NULL,
  event_name TEXT NOT NULL,
  acquisition_source TEXT NULL,
  event_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.product_events TO service_role;
-- Deliberately NO grants to anon or authenticated: inserts go through a SECURITY DEFINER function; reads via admin server functions using service_role.
ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

-- No policies = no anon/authenticated access. service_role bypasses RLS.
CREATE INDEX IF NOT EXISTS idx_product_events_created_at ON public.product_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_event_name ON public.product_events (event_name);
CREATE INDEX IF NOT EXISTS idx_product_events_user_id ON public.product_events (user_id);
CREATE INDEX IF NOT EXISTS idx_product_events_session ON public.product_events (anonymous_session_id);

-- Allowed event names
CREATE OR REPLACE FUNCTION public.is_allowed_event_name(_name TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT _name = ANY (ARRAY[
    'landing_viewed',
    'demo_started',
    'demo_food_submitted',
    'demo_food_confirmed',
    'signup_started',
    'signup_completed',
    'onboarding_completed',
    'food_submitted',
    'food_parse_succeeded',
    'food_parse_failed',
    'food_clarification_requested',
    'food_edited_before_confirmation',
    'food_confirmed',
    'food_deleted',
    'incorrect_macros_reported',
    'saved_meal_repeated',
    'feedback_submitted',
    'app_returned'
  ]);
$$;

-- Public-callable logger. Silently ignores duplicates (same session+event within 1s).
CREATE OR REPLACE FUNCTION public.log_product_event(
  _event_name TEXT,
  _anonymous_session_id TEXT,
  _acquisition_source TEXT,
  _event_properties JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _event_name IS NULL OR NOT public.is_allowed_event_name(_event_name) THEN
    RETURN;
  END IF;

  -- Duplicate suppression: same event+session within 1 second
  IF _anonymous_session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.product_events
    WHERE anonymous_session_id = _anonymous_session_id
      AND event_name = _event_name
      AND created_at > now() - INTERVAL '1 second'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.product_events (user_id, anonymous_session_id, event_name, acquisition_source, event_properties)
  VALUES (
    _uid,
    NULLIF(_anonymous_session_id, ''),
    _event_name,
    NULLIF(_acquisition_source, ''),
    COALESCE(_event_properties, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_product_event(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated, service_role;

-- ============================================================
-- Macro reports
-- ============================================================
CREATE TABLE IF NOT EXISTS public.macro_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_entry_id UUID NULL REFERENCES public.food_entries(id) ON DELETE SET NULL,
  issue_type TEXT NOT NULL,
  explanation TEXT NULL,
  original_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  corrected_values JSONB NULL,
  resolution_status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.macro_reports TO authenticated;
GRANT ALL ON public.macro_reports TO service_role;
ALTER TABLE public.macro_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own macro reports select" ON public.macro_reports;
CREATE POLICY "own macro reports select" ON public.macro_reports
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "own macro reports insert" ON public.macro_reports;
CREATE POLICY "own macro reports insert" ON public.macro_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_macro_reports_user_id ON public.macro_reports (user_id);
CREATE INDEX IF NOT EXISTS idx_macro_reports_created_at ON public.macro_reports (created_at DESC);

-- ============================================================
-- Feedback submissions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.feedback_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  anonymous_session_id TEXT NULL,
  ease_rating SMALLINT NULL CHECK (ease_rating IS NULL OR (ease_rating BETWEEN 1 AND 5)),
  accuracy_rating SMALLINT NULL CHECK (accuracy_rating IS NULL OR (accuracy_rating BETWEEN 1 AND 5)),
  confusing TEXT NULL,
  missed_food TEXT NULL,
  would_use_tomorrow TEXT NULL,
  comment TEXT NULL,
  allow_contact BOOLEAN NOT NULL DEFAULT false,
  acquisition_source TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.feedback_submissions TO service_role;
-- No direct anon/authenticated grants: submissions go via SECURITY DEFINER function; reads via admin server functions.
ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.submit_feedback(
  _anonymous_session_id TEXT,
  _ease_rating INT,
  _accuracy_rating INT,
  _confusing TEXT,
  _missed_food TEXT,
  _would_use_tomorrow TEXT,
  _comment TEXT,
  _allow_contact BOOLEAN,
  _acquisition_source TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.feedback_submissions
    (user_id, anonymous_session_id, ease_rating, accuracy_rating, confusing, missed_food,
     would_use_tomorrow, comment, allow_contact, acquisition_source)
  VALUES
    (auth.uid(),
     NULLIF(_anonymous_session_id, ''),
     CASE WHEN _ease_rating BETWEEN 1 AND 5 THEN _ease_rating::SMALLINT ELSE NULL END,
     CASE WHEN _accuracy_rating BETWEEN 1 AND 5 THEN _accuracy_rating::SMALLINT ELSE NULL END,
     NULLIF(_confusing, ''),
     NULLIF(_missed_food, ''),
     NULLIF(_would_use_tomorrow, ''),
     NULLIF(_comment, ''),
     COALESCE(_allow_contact, false),
     NULLIF(_acquisition_source, ''));
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_feedback(TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO anon, authenticated, service_role;
