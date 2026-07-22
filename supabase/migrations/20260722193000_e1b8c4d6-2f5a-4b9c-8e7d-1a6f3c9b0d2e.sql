-- Widen is_allowed_event_name() to accept 'rage_tap', a new generic,
-- reusable event fired by noteTapForRageDetection() (src/lib/analytics.ts)
-- when the same UI element is tapped 3+ times within 1.5s.
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
    'admin_dashboard_viewed',
    'app_loaded','today_ready',
    'food_search_started','food_search_results_shown',
    'food_calculation_started','food_calculation_completed',
    'food_log_saved',
    'cache_hit','cache_miss',
    'performance_error','web_vital',
    'auth_method_chosen','signup_failed','first_food_logged',
    'auth_attempt_completed',
    'recent_item_reused','favorite_used','saved_meal_reused',
    'scale_guide_opened','scale_guide_completed',
    'scale_example_started','scale_example_logged',
    'rage_tap'
  ]);
$function$;
