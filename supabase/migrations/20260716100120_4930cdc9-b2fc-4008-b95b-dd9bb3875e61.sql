
REVOKE EXECUTE ON FUNCTION public.reserve_demo_slot(text, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_demo_slot(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_demo_success(text) FROM anon, authenticated;
