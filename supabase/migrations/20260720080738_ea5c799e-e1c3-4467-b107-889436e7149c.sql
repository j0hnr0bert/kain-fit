
CREATE TABLE public.signup_funnel_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NULL,
  anonymous_session_id TEXT NOT NULL,
  step TEXT NOT NULL,
  reason TEXT NULL,
  detail TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX signup_funnel_events_step_created_idx ON public.signup_funnel_events (step, created_at DESC);
CREATE INDEX signup_funnel_events_session_idx ON public.signup_funnel_events (anonymous_session_id, created_at);

GRANT ALL ON public.signup_funnel_events TO service_role;

ALTER TABLE public.signup_funnel_events ENABLE ROW LEVEL SECURITY;

-- Deny-all: writes go through the SECURITY DEFINER RPC, reads through the admin client.
CREATE POLICY "signup_funnel_events_deny_all" ON public.signup_funnel_events
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.log_signup_funnel_event(
  _step TEXT,
  _anonymous_session_id TEXT,
  _reason TEXT,
  _detail TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _allowed CONSTANT TEXT[] := ARRAY[
    'signup_form_viewed',
    'signup_email_entered',
    'signup_password_entered',
    'signup_submit_clicked',
    'signup_validation_failed',
    'signup_request_sent',
    'signup_request_error',
    'signup_email_verification_sent',
    'signup_completed'
  ];
BEGIN
  IF _step IS NULL OR NOT (_step = ANY (_allowed)) THEN
    RETURN;
  END IF;
  IF _anonymous_session_id IS NULL OR length(_anonymous_session_id) = 0 THEN
    RETURN;
  END IF;
  INSERT INTO public.signup_funnel_events (user_id, anonymous_session_id, step, reason, detail)
  VALUES (_uid, left(_anonymous_session_id, 128), _step, NULLIF(left(_reason, 64), ''), NULLIF(left(_detail, 500), ''));
END;
$$;

REVOKE ALL ON FUNCTION public.log_signup_funnel_event(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_signup_funnel_event(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
