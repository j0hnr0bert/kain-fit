-- First-meal celebration: a single nullable column marking when a user's
-- first-ever food_entries row was saved. Set exactly once, atomically, via
-- `UPDATE profiles SET first_meal_celebrated_at = now()
--  WHERE user_id = $1 AND first_meal_celebrated_at IS NULL`
-- at save time (see today.tsx). Postgres row-level locking on that
-- WHERE-guarded UPDATE makes the claim race-safe under concurrent saves —
-- at most one concurrent caller can ever see the column as still null and
-- successfully claim it — with no new table and no new function.

ALTER TABLE public.profiles ADD COLUMN first_meal_celebrated_at TIMESTAMPTZ;

-- Backfill: any profile that already has at least one food_entries row has
-- already passed their real "first meal" moment before this feature
-- existed. Mark them celebrated now so existing beta users are never shown
-- the first-meal celebration retroactively on their next ordinary save.
UPDATE public.profiles p
SET first_meal_celebrated_at = now()
WHERE p.first_meal_celebrated_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.food_entries f WHERE f.user_id = p.user_id
  );

-- Widen is_allowed_event_name() to accept 'first_meal_saved', emitted once
-- per user the first time the claim above succeeds (see
-- src/lib/first-meal-celebration.ts and today.tsx).
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
    'rage_tap',
    'first_meal_saved'
  ]);
$function$;
