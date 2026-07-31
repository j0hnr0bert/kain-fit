import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // Browser-only: the Supabase client reads its session from localStorage.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { mode: "signin" as const, next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const record = data as unknown as {
      redirect_url?: string;
      redirect_to?: string;
      client?: { name?: string };
    };
    const immediate = record?.redirect_url ?? record?.redirect_to;
    if (immediate && !record?.client) throw redirect({ href: immediate });
    return record;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">Authorization request failed</h1>
      <p className="text-sm text-muted-foreground">
        {String((error as Error)?.message ?? error)}
      </p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? "this app";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error: err } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorization_id)
      : await supabase.auth.oauth.denyAuthorization(authorization_id);
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    const record = data as unknown as { redirect_url?: string; redirect_to?: string };
    const target = record?.redirect_url ?? record?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Connect {clientName} to KainFit</h1>
        <p className="text-sm text-muted-foreground">
          {clientName} will be able to search KainFit's food database and read, add and total your
          own food entries — acting as you. You can disconnect it any time from {clientName}.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button disabled={busy} onClick={() => decide(true)}>
          Approve
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
          Deny
        </Button>
      </div>
    </main>
  );
}