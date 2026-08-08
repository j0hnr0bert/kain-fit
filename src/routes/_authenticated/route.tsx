import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // getSession() reads the JWT from local storage (no network round trip)
    // instead of getUser()'s server-validated fetch. This gate only decides
    // client-side redirect speed — the real data-access boundary is RLS +
    // PostgREST's own independent JWT verification on every request, which
    // is unaffected by which of these two calls we use here.
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw redirect({ to: "/auth", search: { mode: "signin" } });
    return { user: data.session.user };
  },
  component: () => <Outlet />,
});
