-- KainSignal V2 target-window safety (2026-08-09 recalibration).
--
-- Problem: profiles.target_protein_g holds only the user's CURRENT
-- protein target, with no record of when that value became effective.
-- KainSignal's protein-adherence detector evaluates a rolling window of
-- historical days against whatever target is current at generation time —
-- if a user changes their target, days logged under the OLD target get
-- silently re-judged against the NEW one, which can retroactively invent
-- a false adherence problem (or a false success) that never actually
-- happened.
--
-- Fix: track when target_protein_g last materially changed, and have the
-- detector only evaluate qualified days on or after that timestamp — see
-- kain-signal-generate.server.ts and kain-signal-detector-protein.ts.
--
-- Additive only. No existing column changes type or becomes non-nullable;
-- no existing row's target_protein_g/manual_targets_enabled value changes.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS protein_target_updated_at TIMESTAMPTZ;

-- Conservative backfill for existing users: we do not know when their
-- current target was actually first set (no history exists), so rather
-- than fabricate a date, this initializes the window at migration-apply
-- time for anyone who already has a target. That means protein-adherence
-- evidence effectively restarts for existing users with a target already
-- set — fewer insights for a while, never a wrong one. Users with no
-- target set are unaffected (the detector already returns nothing for a
-- null target, independent of this column).
UPDATE public.profiles
SET protein_target_updated_at = now()
WHERE target_protein_g IS NOT NULL
  AND protein_target_updated_at IS NULL;

-- Keeps protein_target_updated_at correct for every future write path
-- (the client's performSaveTargets update today, any future admin/
-- service-role path) atomically, with no client-side read-before-write
-- race and no risk of a caller forgetting to set it. IS DISTINCT FROM
-- (not <>) so this fires correctly for the NULL <-> value transitions too
-- (target first set, or target cleared), matching every case in the
-- recalibration spec's target-update semantics — re-saving the exact same
-- number is a no-op for this column, so existing evidence is not reset by
-- a redundant save.
CREATE OR REPLACE FUNCTION public.touch_protein_target_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.target_protein_g IS DISTINCT FROM OLD.target_protein_g THEN
    NEW.protein_target_updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_touch_protein_target_updated_at ON public.profiles;
CREATE TRIGGER trg_touch_protein_target_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_protein_target_updated_at();
