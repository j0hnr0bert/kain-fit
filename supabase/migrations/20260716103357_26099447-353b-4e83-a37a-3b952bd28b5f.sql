
-- All three tables receive writes exclusively through SECURITY DEFINER RPCs
-- (submit_feedback, log_product_event, reserve_demo_slot / mark_demo_success /
-- release_demo_slot). Those functions run as the function owner and bypass
-- RLS. To satisfy the scanner and document intent explicitly, we:
--   1. Add owner-scoped SELECT policies where user-facing reads make sense.
--   2. Add a RESTRICTIVE deny-all policy for direct anon/authenticated DML
--      on each table, so a future accidental permissive policy still cannot
--      open direct writes/reads outside the audited RPCs.

-- ---------- demo_usage ----------
-- Purely internal accounting; never read or written directly by clients.
CREATE POLICY "demo_usage no direct access"
  ON public.demo_usage
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ---------- feedback_submissions ----------
-- Authenticated users may read their own feedback rows.
CREATE POLICY "Users read own feedback"
  ON public.feedback_submissions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Block all direct anon/authenticated writes; submit_feedback SECURITY DEFINER
-- is the only supported write path and bypasses RLS.
CREATE POLICY "feedback_submissions no direct writes"
  ON public.feedback_submissions
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "feedback_submissions no direct updates or deletes"
  ON public.feedback_submissions
  AS RESTRICTIVE
  FOR UPDATE
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "feedback_submissions no direct deletes"
  ON public.feedback_submissions
  AS RESTRICTIVE
  FOR DELETE
  TO anon, authenticated
  USING (false);

-- ---------- product_events ----------
-- Authenticated users may read their own analytics events.
CREATE POLICY "Users read own product events"
  ON public.product_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Block all direct anon/authenticated writes; log_product_event SECURITY DEFINER
-- is the only supported write path.
CREATE POLICY "product_events no direct writes"
  ON public.product_events
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "product_events no direct updates"
  ON public.product_events
  AS RESTRICTIVE
  FOR UPDATE
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "product_events no direct deletes"
  ON public.product_events
  AS RESTRICTIVE
  FOR DELETE
  TO anon, authenticated
  USING (false);
