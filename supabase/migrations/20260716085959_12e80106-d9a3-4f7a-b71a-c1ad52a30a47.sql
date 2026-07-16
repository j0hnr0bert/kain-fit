
-- Lock down SECURITY DEFINER functions: revoke EXECUTE from anon/authenticated/public
-- for functions that should only run internally (via service role or triggers).
REVOKE EXECUTE ON FUNCTION public.log_product_event(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_feedback(text, integer, integer, text, text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_allowed_event_name(text) FROM PUBLIC, anon, authenticated;
-- has_role is referenced by RLS policies; keep it callable by authenticated
-- but revoke from anon and public.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;

-- Admin-only visibility for beta instrumentation tables (writes still go through
-- server functions using the service role, which bypasses RLS).
CREATE POLICY "admins can read product_events"
  ON public.product_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can read feedback_submissions"
  ON public.feedback_submissions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to resolve macro reports.
CREATE POLICY "admins can update macro_reports"
  ON public.macro_reports FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can delete macro_reports"
  ON public.macro_reports FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Only admins may create, modify, or remove role assignments.
CREATE POLICY "admins can insert user_roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can update user_roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can delete user_roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
