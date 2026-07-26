-- KainSignal Phase 1 ("Signal Foundation") — evidence-backed daily insight system.
-- Four new tables, additive only: no changes to food_entries/profiles. See
-- the KainSignal implementation plan for full rationale on each design
-- choice referenced in the comments below.

-- 1) kain_signal_states — one persisted readiness snapshot per user per
-- Manila day. computed_for_day is TEXT (not SQL DATE) to match the app's
-- single fixed-offset (UTC+8, no DST) day-bucketing definition in
-- src/lib/retention.ts's manilaDay() exactly — a second day-boundary
-- definition here would risk silently disagreeing with it.
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

CREATE POLICY "own signal state select"
  ON public.kain_signal_states FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
-- Deliberately no INSERT/UPDATE policy for authenticated: generation is
-- privileged (service_role only, via the KainSignal server pipeline).

CREATE TRIGGER trg_kain_signal_states_updated
  BEFORE UPDATE ON public.kain_signal_states
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) kain_signal_insights — every candidate insight computed that day, with
-- the winner flagged. The `evidence`/`observation_facts` columns are the
-- permanent, reconstructable answer to "why did KainFit show me this?" — if
-- an insight can't be reconstructed from a stored row, it must not have
-- been shown.
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

CREATE POLICY "own signal insights select"
  ON public.kain_signal_insights FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
-- No INSERT/UPDATE for authenticated — written only by the privileged
-- generation pipeline (service_role).

-- 3) kain_signal_feedback — corrective memory ("Not quite" / "Don't use
-- this"). User-owned and directly client-writable, same trust level as
-- food_entries/macro_reports. Never touches food_entries — corrections
-- change interpretation/ranking only, never raw records.
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

CREATE POLICY "own signal feedback select"
  ON public.kain_signal_feedback FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own signal feedback insert"
  ON public.kain_signal_feedback FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

-- 4) kain_signal_events — impression/outcome tracking, FK'd to the
-- specific insight it concerns (unlike product_events' free-form JSONB,
-- this gives an exact, indexed join for outcome measurement).
-- 'behavior_observed'/'outcome_improved' are system-computed and must never
-- be client-insertable — enforced structurally by the INSERT policy's
-- WITH CHECK, not just by convention.
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

CREATE POLICY "own signal events select"
  ON public.kain_signal_events FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own signal events insert (client-origin only)"
  ON public.kain_signal_events FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND event_type IN ('shown','why_this_opened','accepted','dismissed','corrected')
  );
