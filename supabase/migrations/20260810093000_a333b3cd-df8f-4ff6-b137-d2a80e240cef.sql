-- KainSignal insight-quality upgrade (2026-08-10) — add the four new
-- relational insight types to kain_signal_insights.insight_type's CHECK
-- constraint: protein_calorie_relationship, protein_meal_position,
-- weekday_weekend_pattern, trend_shift.
--
-- Same shape as the 20260727100000 migration that added
-- 'behavior_milestone' — widen the existing enum-shaped CHECK constraint,
-- change nothing else. The evidence/observation_facts JSONB columns are
-- already schema-flexible enough to hold each new type's fields; only the
-- plain-TEXT insight_type column's CHECK needed widening.
--
-- Safety: purely additive (adds four more allowed values to an existing
-- CHECK), no data rewrite, no existing row can violate the widened
-- constraint since it is a strict superset of the old one. No new table,
-- no new column, no index change, no RLS change (the existing policies
-- already scope by user_id, not by insight_type).
--
-- Rollback: safe to revert to the narrower 3-value constraint as long as
-- no rows of the four new types exist yet (true before this module ships).

ALTER TABLE public.kain_signal_insights
  DROP CONSTRAINT kain_signal_insights_insight_type_check;

ALTER TABLE public.kain_signal_insights
  ADD CONSTRAINT kain_signal_insights_insight_type_check
  CHECK (insight_type IN (
    'protein_adherence',
    'logging_consistency',
    'behavior_milestone',
    'protein_calorie_relationship',
    'protein_meal_position',
    'weekday_weekend_pattern',
    'trend_shift'
  ));
