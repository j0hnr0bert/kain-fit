-- Strengthens first-meal-celebration eligibility beyond the plain
-- first_meal_celebrated_at IS NULL check added in 20260731052355. That
-- check alone is insufficient: a user could accumulate more than one
-- food_entries row between this migration applying to production and the
-- application code that calls it being deployed (old app code has no
-- knowledge of the new column and never touches it), leaving them with a
-- null flag but a lifetime entry count greater than one. A later save
-- under the new code would then falsely read as "first ever."
--
-- This function closes that gap by requiring BOTH conditions atomically,
-- inside one transaction, with a row lock on the caller's own profile so
-- two concurrent calls for the same user cannot both succeed:
--   1. first_meal_celebrated_at IS NULL
--   2. the caller's lifetime food_entries count is exactly 1
--
-- No arguments are accepted — the target is always auth.uid(), the
-- calling user's own identity from their verified JWT. This is a
-- deliberate hardening lesson from this same codebase's earlier
-- kain_signal_replace_selection incident (a SECURITY DEFINER function
-- that accepted an arbitrary target user id and was left executable by
-- PUBLIC): eliminating the parameter entirely, rather than trusting an
-- internal auth.uid() = _user_id check, makes it structurally impossible
-- for one user to target another's row through this function.
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

  -- Row lock serializes concurrent calls for the same user: a second
  -- concurrent call blocks here until the first commits, then re-reads
  -- the now-current flag and count and correctly fails to claim.
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

-- Explicit, alongside the CREATE — never left as a separate later
-- migration — so there is no window where this function exists without
-- correct grants.
REVOKE ALL ON FUNCTION public.claim_first_meal_celebration() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_first_meal_celebration() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_first_meal_celebration() TO authenticated;
