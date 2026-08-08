-- =====================================================================
-- Consolidated catch-up: replays repo migrations 20260722190500 through
-- 20260731070340, which exist in the repository but were never applied to
-- production (production migration history stopped at 20260721073053).
--
-- Written idempotently so that a fresh deployment which replays the nine
-- original files IN ORDER and then reaches this file still succeeds.
-- Applied as a single migration so kain_signal_replace_selection() is
-- created and its PUBLIC grant revoked in the same transaction — there is
-- no window in which the SECURITY DEFINER RPC is PUBLIC-executable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 20260725090000 — KainSignal Phase 1 schema (four additive tables)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kain_signal_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  computed_for_day TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('no_data','building','eligible','connected')),
  gates_met BOOLEAN NOT NULL,
  gate_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  composite_score NUMERIC NOT NULL DEFAULT 0,
  progress_label TEXT CHECK (progress_label IS NULL OR progress_label IN ('starting','taking_shape','nearly_ready')),
  active_logging_days INTEGER NOT NULL DEFAULT 0,
  qualifying_entries INTEGER NOT NULL DEFAULT 0,
  reasonably_complete_days INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, computed_for_day)
);

CREATE INDEX IF NOT EXISTS kain_signal_states_user_day_idx
  ON public.kain_signal_states (user_id, computed_for_day DESC);

GRANT SELECT ON public.kain_signal_states TO authenticated;
GRANT ALL ON public.kain_signal_states TO service_role;

ALTER TABLE public.kain_signal_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own signal state select" ON public.kain_signal_states;
CREATE POLICY "own signal state select"
  ON public.kain_signal_states FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_kain_signal_states_updated ON public.kain_signal_states;
CREATE TRIGGER trg_kain_signal_states_updated
  BEFORE UPDATE ON public.kain_signal_states
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.kain_signal_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state_id UUID NOT NULL REFERENCES public.kain_signal_states(id) ON DELETE CASCADE,
  computed_for_day TEXT NOT NULL,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('protein_adherence','logging_consistency')),
  evidence_strength TEXT NOT NULL CHECK (evidence_strength IN ('early_signal','clear_signal','strong_signal')),
  rank_score NUMERIC NOT NULL,
  is_selected BOOLEAN NOT NULL DEFAULT false,
  evidence JSONB NOT NULL,
  observation_facts JSONB NOT NULL,
  recommended_action_key TEXT NOT NULL,
  suppressed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kain_signal_insights_user_day_idx
  ON public.kain_signal_insights (user_id, computed_for_day DESC);
CREATE INDEX IF NOT EXISTS kain_signal_insights_user_type_idx
  ON public.kain_signal_insights (user_id, insight_type, computed_for_day DESC);

GRANT SELECT ON public.kain_signal_insights TO authenticated;
GRANT ALL ON public.kain_signal_insights TO service_role;

ALTER TABLE public.kain_signal_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own signal insights select" ON public.kain_signal_insights;
CREATE POLICY "own signal insights select"
  ON public.kain_signal_insights FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.kain_signal_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight_id UUID NOT NULL REFERENCES public.kain_signal_insights(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL,
  feedback_kind TEXT NOT NULL CHECK (feedback_kind IN ('not_quite','dont_use_this')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kain_signal_feedback_user_type_idx
  ON public.kain_signal_feedback (user_id, insight_type, created_at DESC);

GRANT SELECT, INSERT ON public.kain_signal_feedback TO authenticated;
GRANT ALL ON public.kain_signal_feedback TO service_role;

ALTER TABLE public.kain_signal_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own signal feedback select" ON public.kain_signal_feedback;
CREATE POLICY "own signal feedback select"
  ON public.kain_signal_feedback FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own signal feedback insert" ON public.kain_signal_feedback;
CREATE POLICY "own signal feedback insert"
  ON public.kain_signal_feedback FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.kain_signal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight_id UUID NOT NULL REFERENCES public.kain_signal_insights(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN
    ('shown','why_this_opened','accepted','dismissed','corrected','behavior_observed','outcome_improved')),
  event_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kain_signal_events_insight_idx
  ON public.kain_signal_events (insight_id, event_type);
CREATE INDEX IF NOT EXISTS kain_signal_events_user_idx
  ON public.kain_signal_events (user_id, created_at DESC);

GRANT SELECT, INSERT ON public.kain_signal_events TO authenticated;
GRANT ALL ON public.kain_signal_events TO service_role;

ALTER TABLE public.kain_signal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own signal events select" ON public.kain_signal_events;
CREATE POLICY "own signal events select"
  ON public.kain_signal_events FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own signal events insert (client-origin only)" ON public.kain_signal_events;
CREATE POLICY "own signal events insert (client-origin only)"
  ON public.kain_signal_events FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND event_type IN ('shown','why_this_opened','accepted','dismissed','corrected')
  );

-- ---------------------------------------------------------------------
-- 20260727100000 — widen insight_type to allow 'behavior_milestone'
-- ---------------------------------------------------------------------
ALTER TABLE public.kain_signal_insights
  DROP CONSTRAINT IF EXISTS kain_signal_insights_insight_type_check;

ALTER TABLE public.kain_signal_insights
  ADD CONSTRAINT kain_signal_insights_insight_type_check
  CHECK (insight_type IN ('protein_adherence', 'logging_consistency', 'behavior_milestone'));

-- ---------------------------------------------------------------------
-- 20260727130000 — milestone identity columns, one-selected-per-day
-- backstop, and the atomic selection-replacement RPC
-- ---------------------------------------------------------------------
ALTER TABLE public.kain_signal_insights
  ADD COLUMN IF NOT EXISTS milestone_type TEXT,
  ADD COLUMN IF NOT EXISTS milestone_threshold INTEGER;

UPDATE public.kain_signal_insights
  SET milestone_type = evidence->>'milestoneType',
      milestone_threshold = (evidence->>'threshold')::integer
  WHERE insight_type = 'behavior_milestone'
    AND milestone_type IS NULL;

ALTER TABLE public.kain_signal_insights
  DROP CONSTRAINT IF EXISTS kain_signal_insights_milestone_columns_check;
ALTER TABLE public.kain_signal_insights
  ADD CONSTRAINT kain_signal_insights_milestone_columns_check
  CHECK (
    (insight_type = 'behavior_milestone' AND milestone_type IS NOT NULL AND milestone_threshold IS NOT NULL)
    OR (insight_type <> 'behavior_milestone' AND milestone_type IS NULL AND milestone_threshold IS NULL)
  );

ALTER TABLE public.kain_signal_insights
  DROP CONSTRAINT IF EXISTS kain_signal_insights_milestone_identity_uniq;
ALTER TABLE public.kain_signal_insights
  ADD CONSTRAINT kain_signal_insights_milestone_identity_uniq
  UNIQUE (user_id, milestone_type, milestone_threshold);

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY user_id, computed_for_day
    ORDER BY created_at DESC
  ) AS rn
  FROM public.kain_signal_insights
  WHERE is_selected = true
)
UPDATE public.kain_signal_insights k
  SET is_selected = false
  FROM ranked
  WHERE k.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS kain_signal_insights_one_selected_per_day
  ON public.kain_signal_insights (user_id, computed_for_day)
  WHERE is_selected = true;

CREATE OR REPLACE FUNCTION public.kain_signal_replace_selection(
  p_user_id UUID,
  p_state_id UUID,
  p_computed_for_day TEXT,
  p_rows JSONB
) RETURNS SETOF public.kain_signal_insights
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_computed_for_day, 0));

  UPDATE public.kain_signal_insights
    SET is_selected = false
    WHERE user_id = p_user_id
      AND computed_for_day = p_computed_for_day
      AND is_selected = true;

  RETURN QUERY
  INSERT INTO public.kain_signal_insights (
    user_id, state_id, computed_for_day, insight_type, evidence_strength,
    rank_score, is_selected, evidence, observation_facts,
    recommended_action_key, suppressed, milestone_type, milestone_threshold
  )
  SELECT
    p_user_id,
    p_state_id,
    p_computed_for_day,
    (elem->>'insight_type'),
    (elem->>'evidence_strength'),
    (elem->>'rank_score')::numeric,
    (elem->>'is_selected')::boolean,
    elem->'evidence',
    elem->'observation_facts',
    (elem->>'recommended_action_key'),
    (elem->>'suppressed')::boolean,
    elem->>'milestone_type',
    NULLIF(elem->>'milestone_threshold', '')::integer
  FROM jsonb_array_elements(p_rows) AS elem
  ON CONFLICT (user_id, milestone_type, milestone_threshold) DO NOTHING
  RETURNING *;
END;
$$;

-- ---------------------------------------------------------------------
-- 20260727135651 — least-privilege lockdown of the RPC above. Same
-- transaction as its CREATE, so PUBLIC never holds EXECUTE at any point.
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.kain_signal_replace_selection(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kain_signal_replace_selection(UUID, UUID, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.kain_signal_replace_selection(UUID, UUID, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.kain_signal_replace_selection(UUID, UUID, TEXT, JSONB) TO service_role;

-- ---------------------------------------------------------------------
-- 20260731052355 — first-meal celebration column + backfill
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_meal_celebrated_at TIMESTAMPTZ;

UPDATE public.profiles p
  SET first_meal_celebrated_at = now()
  WHERE p.first_meal_celebrated_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.food_entries f WHERE f.user_id = p.user_id
    );

-- ---------------------------------------------------------------------
-- 20260731070340 — first-meal claim RPC. Takes no target user: always
-- acts on auth.uid(), so cross-user targeting is structurally impossible.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_first_meal_celebration()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _count integer;
  _claimed boolean;
BEGIN
  IF _uid IS NULL THEN
    RETURN false;
  END IF;

  PERFORM 1 FROM public.profiles WHERE user_id = _uid FOR UPDATE;

  SELECT count(*) INTO _count FROM public.food_entries WHERE user_id = _uid;

  UPDATE public.profiles
    SET first_meal_celebrated_at = now()
    WHERE user_id = _uid
      AND first_meal_celebrated_at IS NULL
      AND _count = 1
  RETURNING true INTO _claimed;

  RETURN COALESCE(_claimed, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_first_meal_celebration() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_first_meal_celebration() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_first_meal_celebration() TO authenticated;

-- ---------------------------------------------------------------------
-- 20260722190500 / 20260722191500 / 20260722193000 / 20260731052355 —
-- final consolidated analytics event allow-list (last definition wins).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_allowed_event_name(_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT _name = ANY (ARRAY[
    'landing_viewed','demo_started','demo_food_submitted','demo_food_confirmed',
    'signup_started','signup_completed','onboarding_completed',
    'food_submitted','food_parse_succeeded','food_parse_failed',
    'food_clarification_requested','food_edited_before_confirmation',
    'food_confirmed','food_deleted','incorrect_macros_reported',
    'saved_meal_repeated','feedback_submitted','app_returned',
    'admin_dashboard_viewed',
    'app_loaded','today_ready',
    'food_search_started','food_search_results_shown',
    'food_calculation_started','food_calculation_completed',
    'food_log_saved',
    'cache_hit','cache_miss',
    'performance_error','web_vital',
    'auth_method_chosen','signup_failed','first_food_logged',
    'auth_attempt_completed',
    'recent_item_reused','favorite_used','saved_meal_reused',
    'scale_guide_opened','scale_guide_completed',
    'scale_example_started','scale_example_logged',
    'rage_tap',
    'first_meal_saved'
  ]);
$function$;