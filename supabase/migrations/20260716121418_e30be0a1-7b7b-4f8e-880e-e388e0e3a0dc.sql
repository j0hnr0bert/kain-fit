-- Drop duplicate food_entries index (same definition as food_entries_user_logged_at_idx).
DROP INDEX IF EXISTS public.food_entries_user_time_idx;

-- Speeds up "saved meal / repeat" lookups on the profile and today screens.
CREATE INDEX IF NOT EXISTS saved_foods_user_last_used_idx
  ON public.saved_foods (user_id, last_used_at DESC);

-- Speeds up feedback dashboard reads (ORDER BY created_at DESC).
CREATE INDEX IF NOT EXISTS feedback_submissions_created_at_idx
  ON public.feedback_submissions (created_at DESC);

-- Session-scoped event lookups (duplicate-suppression + demo-source funnel).
-- The existing (event_name, created_at DESC) index doesn't help session filters.
CREATE INDEX IF NOT EXISTS product_events_session_event_created_idx
  ON public.product_events (anonymous_session_id, event_name, created_at DESC)
  WHERE anonymous_session_id IS NOT NULL;

-- User-scoped analytics windows (day1/day7 return, per-user counts).
CREATE INDEX IF NOT EXISTS product_events_user_event_created_idx
  ON public.product_events (user_id, event_name, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Founder queue view of macro reports.
CREATE INDEX IF NOT EXISTS macro_reports_status_created_idx
  ON public.macro_reports (resolution_status, created_at DESC);