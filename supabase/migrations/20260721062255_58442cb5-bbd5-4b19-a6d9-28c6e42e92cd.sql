ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_touch_source text,
  ADD COLUMN IF NOT EXISTS first_touch_utm jsonb,
  ADD COLUMN IF NOT EXISTS first_touched_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_first_touch(_source text, _utm jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;

  -- Ensure a profile row exists (handle_new_user trigger usually creates it,
  -- but OAuth-first users can hit this before that trigger has landed).
  INSERT INTO public.profiles (user_id)
  VALUES (_uid)
  ON CONFLICT (user_id) DO NOTHING;

  -- First-touch is immutable once set.
  UPDATE public.profiles
     SET first_touch_source = NULLIF(left(_source, 64), ''),
         first_touch_utm    = _utm,
         first_touched_at   = now()
   WHERE user_id = _uid
     AND first_touched_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.record_first_touch(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_first_touch(text, jsonb) TO authenticated;