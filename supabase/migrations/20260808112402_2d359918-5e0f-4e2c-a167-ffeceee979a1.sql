-- The 2026-07-16 migration that created reserve_demo_slot/release_demo_slot/
-- mark_demo_success revoked EXECUTE from PUBLIC on each (correct — they're
-- SECURITY DEFINER) but never granted it back to service_role, which is
-- the only role that calls them (see admin.rpc(...) in food.functions.ts's
-- demo food-parse flow). Result: every unauthenticated demo request fails
-- at the rate-limit-reservation step with a permission-denied error before
-- the AI parse ever runs — confirmed locally via a direct RPC call
-- returning 42501 "permission denied for function reserve_demo_slot".
GRANT EXECUTE ON FUNCTION public.reserve_demo_slot(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_demo_slot(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_demo_success(TEXT) TO service_role;
