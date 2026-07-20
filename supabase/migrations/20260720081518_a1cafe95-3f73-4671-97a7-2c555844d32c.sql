CREATE OR REPLACE FUNCTION public.log_signup_funnel_event(_step text, _anonymous_session_id text, _reason text, _detail text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'signup_completed',
    'oauth_google_started',
    'oauth_google_failed',
    'oauth_apple_started',
    'oauth_apple_failed'
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
$function$;