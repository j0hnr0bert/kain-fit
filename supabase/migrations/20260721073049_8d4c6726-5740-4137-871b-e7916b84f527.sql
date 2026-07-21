CREATE OR REPLACE FUNCTION public.record_first_touch(_user_id uuid, _source text, _utm jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.profiles (user_id)
  VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.profiles
     SET first_touch_source = NULLIF(left(_source, 64), ''),
         first_touch_utm    = _utm,
         first_touched_at   = now()
   WHERE user_id = _user_id
     AND first_touched_at IS NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_first_touch(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_first_touch(uuid, text, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.record_first_touch(text, jsonb);