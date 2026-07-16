-- Revoke EXECUTE from public/anon/authenticated on unused SECURITY DEFINER functions.
-- These are not called from the client; the app writes via server functions using the service-role client.
REVOKE ALL ON FUNCTION public.log_product_event(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_feedback(text, integer, integer, text, text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;

-- has_role is intentionally callable by authenticated so RLS policies referencing public.has_role(auth.uid(), ...) succeed.
-- Keep EXECUTE narrow: only authenticated (RLS eval role); revoke from anon and PUBLIC.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;