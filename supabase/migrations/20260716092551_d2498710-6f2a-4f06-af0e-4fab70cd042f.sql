
-- Add 'founder' role to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'founder';

-- Extend allowed product event names to include founder dashboard access
CREATE OR REPLACE FUNCTION public.is_allowed_event_name(_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT _name = ANY (ARRAY[
    'landing_viewed','demo_started','demo_food_submitted','demo_food_confirmed',
    'signup_started','signup_completed','onboarding_completed',
    'food_submitted','food_parse_succeeded','food_parse_failed',
    'food_clarification_requested','food_edited_before_confirmation',
    'food_confirmed','food_deleted','incorrect_macros_reported',
    'saved_meal_repeated','feedback_submitted','app_returned',
    'admin_dashboard_viewed'
  ]);
$function$;
