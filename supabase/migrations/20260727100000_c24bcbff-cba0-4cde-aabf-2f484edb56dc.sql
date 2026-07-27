-- KainSignal — add 'behavior_milestone' as a valid insight_type.
--
-- Limitation this fixes: kain_signal_insights.insight_type has
-- CHECK (insight_type IN ('protein_adherence','logging_consistency')) —
-- inserting a milestone row under any other value fails at the database
-- layer. The evidence JSONB column is already schema-flexible enough to
-- hold a milestone's identity (milestoneType/threshold/observedValue), but
-- that flexibility cannot widen a CHECK constraint on a different, plain
-- TEXT column — the two are unrelated. This is the smallest schema change
-- that unblocks the behavior_milestone signal module: widen the
-- constraint, change nothing else.
--
-- Safety: purely additive (adds one more allowed value to an existing
-- enum-shaped CHECK), no data rewrite, no existing row can violate the
-- widened constraint since it is a superset of the old one. No new table,
-- no new column, no index change.
--
-- Rollback: safe to revert to the narrower 2-value constraint as long as
-- no 'behavior_milestone' rows exist yet (true before this module ships).
-- If milestone rows do exist, reverting would require deleting or
-- reclassifying them first — reverting is not expected to be needed, but
-- is not silently destructive either way (the ALTER itself never touches
-- existing rows).

ALTER TABLE public.kain_signal_insights
  DROP CONSTRAINT kain_signal_insights_insight_type_check;

ALTER TABLE public.kain_signal_insights
  ADD CONSTRAINT kain_signal_insights_insight_type_check
  CHECK (insight_type IN ('protein_adherence', 'logging_consistency', 'behavior_milestone'));
