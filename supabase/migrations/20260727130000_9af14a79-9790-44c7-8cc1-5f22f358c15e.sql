-- KainSignal hardening pass (2026-07-27): two database-level invariants
-- that application code alone cannot guarantee under concurrent requests.
--
-- ============================================================
-- 1. Milestone identity uniqueness
-- ============================================================
--
-- Limitation this fixes: the previous "read recorded milestones, then
-- decide, then insert" flow in kain-signal-generate.server.ts is a
-- classic check-then-act race — two concurrent requests can both observe
-- a milestone as absent and both insert it. Application-level filtering
-- (recordedMilestoneKeys) prevents drip-feed replay on SEQUENTIAL calls
-- but cannot prevent a true duplicate under OVERLAPPING calls.
--
-- Why evidence JSONB alone can't solve it: JSONB fields are not, by
-- themselves, indexable as a real uniqueness target that PostgREST's
-- upsert conflict-resolution can reliably reference. Promoting the
-- identity fields (milestone_type, threshold) to real columns is the
-- smallest change that gives both a normal SQL UNIQUE constraint and a
-- clean Supabase-client upsert(..., { onConflict, ignoreDuplicates: true })
-- target.
--
-- The unique identity is exactly {user_id, milestone_type, threshold} —
-- observedValue is intentionally excluded (it naturally grows as the user
-- logs more; including it would let the same threshold "duplicate" at a
-- later observed value, which is exactly what must never happen).
-- Non-milestone rows have milestone_type/milestone_threshold = NULL;
-- Postgres treats NULLs as distinct in a UNIQUE constraint by default, so
-- protein_adherence/logging_consistency rows are entirely unaffected by
-- this constraint — it only ever applies where both columns are non-null,
-- i.e. behavior_milestone rows.
--
-- Safety: additive columns (nullable, no default-value rewrite cost),
-- backfilled from already-persisted evidence before the constraints are
-- added so existing rows are guaranteed to satisfy them. No duplicate
-- (user_id, milestone_type, threshold) rows exist in this beta dataset —
-- milestone tracking has not shipped to real users yet, only to local/dev
-- verification data. If real duplicates ever existed, this ALTER would
-- fail loudly at migration time (never silently corrupt data) and would
-- need a one-time dedup (keep earliest by created_at) before re-running.
--
-- Rollback: dropping the two new columns and their constraints is safe
-- and non-destructive to any other column; the milestone identity would
-- fall back to being enforced by application logic only, as before.

ALTER TABLE public.kain_signal_insights
  ADD COLUMN milestone_type TEXT,
  ADD COLUMN milestone_threshold INTEGER;

UPDATE public.kain_signal_insights
  SET milestone_type = evidence->>'milestoneType',
      milestone_threshold = (evidence->>'threshold')::integer
  WHERE insight_type = 'behavior_milestone';

ALTER TABLE public.kain_signal_insights
  ADD CONSTRAINT kain_signal_insights_milestone_columns_check
  CHECK (
    (insight_type = 'behavior_milestone' AND milestone_type IS NOT NULL AND milestone_threshold IS NOT NULL)
    OR (insight_type <> 'behavior_milestone' AND milestone_type IS NULL AND milestone_threshold IS NULL)
  );

ALTER TABLE public.kain_signal_insights
  ADD CONSTRAINT kain_signal_insights_milestone_identity_uniq
  UNIQUE (user_id, milestone_type, milestone_threshold);

-- ============================================================
-- 2. At most one selected insight per user per day
-- ============================================================
--
-- Limitation this fixes: the freshness-replacement flow (clear
-- is_selected, then insert the new ranked batch) is two separate
-- statements from the client's perspective — safe once wrapped in the
-- kain_signal_replace_selection() transaction below, but this partial
-- unique index is a structural backstop that makes the invariant true
-- even if a future code path ever writes kain_signal_insights outside
-- that function. It is also what makes the RPC's own UPDATE-then-INSERT
-- safe to serialize with an advisory lock: if two transactions somehow
-- still raced past the lock, this index guarantees the database itself
-- rejects a second concurrently-selected row rather than silently
-- allowing it.
--
-- Safety: additive index only, no existing-row rewrite. If duplicate
-- selected rows exist for the same user/day in this dev dataset (possible
-- from the earlier is_selected-not-cleared bug, now fixed in application
-- code), this CREATE UNIQUE INDEX would fail — see the cleanup statement
-- below, which keeps only the most recently created selected row per
-- user/day and clears the rest, run unconditionally and safely (a no-op
-- if no duplicates exist).
--
-- Rollback: dropping the index removes the backstop; the RPC's
-- transaction + advisory lock remains the primary guarantee.

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

CREATE UNIQUE INDEX kain_signal_insights_one_selected_per_day
  ON public.kain_signal_insights (user_id, computed_for_day)
  WHERE is_selected = true;

-- ============================================================
-- 3. Atomic selection replacement
-- ============================================================
--
-- Replaces the two-statement (UPDATE is_selected=false, then INSERT) flow
-- in kain-signal-generate.server.ts with a single transaction, serialized
-- per user+day via a transaction-scoped advisory lock so two overlapping
-- calls for the same user/day can never interleave their clear-then-insert
-- steps. ON CONFLICT DO NOTHING on the milestone identity constraint above
-- means a concurrent duplicate milestone attempt resolves safely instead
-- of erroring. service_role only — generation is privileged, matching
-- every other write in this schema.

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
  -- Serializes concurrent calls for the same user+day for the remainder
  -- of this transaction — released automatically on commit/rollback.
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

GRANT EXECUTE ON FUNCTION public.kain_signal_replace_selection(UUID, UUID, TEXT, JSONB) TO service_role;
