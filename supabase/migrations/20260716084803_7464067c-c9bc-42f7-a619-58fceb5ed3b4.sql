
CREATE OR REPLACE FUNCTION public.is_allowed_event_name(_name TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _name = ANY (ARRAY[
    'landing_viewed','demo_started','demo_food_submitted','demo_food_confirmed',
    'signup_started','signup_completed','onboarding_completed',
    'food_submitted','food_parse_succeeded','food_parse_failed',
    'food_clarification_requested','food_edited_before_confirmation',
    'food_confirmed','food_deleted','incorrect_macros_reported',
    'saved_meal_repeated','feedback_submitted','app_returned'
  ]);
$$;
