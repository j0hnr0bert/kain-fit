
CREATE TABLE public.demo_usage (
  session_id text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.demo_usage TO service_role;

ALTER TABLE public.demo_usage ENABLE ROW LEVEL SECURITY;

-- No policies: table is only accessed by server code via service_role, which bypasses RLS.

CREATE OR REPLACE FUNCTION public.reserve_demo_slot(_sid text, _limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO public.demo_usage (session_id, count)
  VALUES (_sid, 1)
  ON CONFLICT (session_id) DO UPDATE
    SET count = public.demo_usage.count + 1,
        updated_at = now()
    WHERE public.demo_usage.count < _limit
  RETURNING count INTO new_count;

  IF new_count IS NULL THEN
    RETURN -1;
  END IF;
  RETURN new_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_demo_slot(text, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.release_demo_slot(_sid text, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.demo_usage
     SET count = GREATEST(0, count - 1),
         last_reason = _reason,
         updated_at = now()
   WHERE session_id = _sid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_demo_slot(text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.mark_demo_success(_sid text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.demo_usage
     SET last_success_at = now(),
         last_reason = NULL,
         updated_at = now()
   WHERE session_id = _sid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_demo_success(text) FROM PUBLIC;
