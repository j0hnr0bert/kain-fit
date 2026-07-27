-- Security fix: kain_signal_replace_selection() was created with only an
-- explicit GRANT to service_role (see
-- 20260727130000_9af14a79-9790-44c7-8cc1-5f22f358c15e.sql). It never
-- revoked the implicit EXECUTE grant Postgres assigns to PUBLIC by default
-- at CREATE FUNCTION time, so PUBLIC (and therefore anon/authenticated,
-- which are members of PUBLIC) retained EXECUTE despite the function being
-- SECURITY DEFINER, accepting an arbitrary p_user_id with no auth.uid()
-- check, and being documented as "service_role only" in its own comment.
-- This let any authenticated browser client call the RPC with another
-- user's ID and mutate that user's kain_signal_insights rows directly,
-- bypassing RLS entirely (confirmed via a controlled local exploit).
--
-- This migration only corrects execution privileges. No function logic,
-- arguments, locking, or table structure changes.

REVOKE ALL ON FUNCTION public.kain_signal_replace_selection(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kain_signal_replace_selection(UUID, UUID, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.kain_signal_replace_selection(UUID, UUID, TEXT, JSONB) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.kain_signal_replace_selection(UUID, UUID, TEXT, JSONB) TO service_role;
