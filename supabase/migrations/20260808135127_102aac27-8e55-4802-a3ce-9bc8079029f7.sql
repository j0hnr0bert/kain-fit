-- Defence-in-depth: schema-level ALTER DEFAULT PRIVILEGES on `public`
-- (owned by roles postgres/supabase_admin, platform-managed) automatically
-- grants anon/authenticated/service_role the FULL table privilege set
-- (arwdDxtm) on every newly created table. That silently widened the
-- narrow "GRANT SELECT" / "GRANT SELECT, INSERT" statements declared for
-- the four KainSignal tables.
--
-- No data was exposed: RLS is enabled on all four and there are no
-- INSERT/UPDATE/DELETE policies for the widened paths, and every policy is
-- scoped `TO authenticated`, so anon resolves to zero rows. This migration
-- removes the unused surface so the effective grants match the documented
-- intent, rather than relying on RLS as the only barrier.
--
-- Idempotent: REVOKE ALL then GRANT exactly the intended set.

-- kain_signal_states — read-only for the owner; writes are service_role
-- only (privileged generation pipeline).
REVOKE ALL ON public.kain_signal_states FROM anon;
REVOKE ALL ON public.kain_signal_states FROM authenticated;
GRANT SELECT ON public.kain_signal_states TO authenticated;
GRANT ALL ON public.kain_signal_states TO service_role;

-- kain_signal_insights — read-only for the owner; writes are service_role
-- only, via kain_signal_replace_selection().
REVOKE ALL ON public.kain_signal_insights FROM anon;
REVOKE ALL ON public.kain_signal_insights FROM authenticated;
GRANT SELECT ON public.kain_signal_insights TO authenticated;
GRANT ALL ON public.kain_signal_insights TO service_role;

-- kain_signal_feedback — owner may read and append their own corrections;
-- no edits or deletes (corrective memory must stay append-only).
REVOKE ALL ON public.kain_signal_feedback FROM anon;
REVOKE ALL ON public.kain_signal_feedback FROM authenticated;
GRANT SELECT, INSERT ON public.kain_signal_feedback TO authenticated;
GRANT ALL ON public.kain_signal_feedback TO service_role;

-- kain_signal_events — owner may read and append client-origin events;
-- no edits or deletes (impression/outcome log must stay append-only).
REVOKE ALL ON public.kain_signal_events FROM anon;
REVOKE ALL ON public.kain_signal_events FROM authenticated;
GRANT SELECT, INSERT ON public.kain_signal_events TO authenticated;
GRANT ALL ON public.kain_signal_events TO service_role;