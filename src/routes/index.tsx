import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { track, getAcquisitionSource } from "@/lib/analytics";
import { BetaBadge } from "@/components/BetaBadge";

export const Route = createFileRoute("/")({
  component: Welcome,
});

function Welcome() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate({ to: "/today", replace: true });
      } else {
        setChecked(true);
      }
    });
  }, [navigate]);

  useEffect(() => {
    // Fire once per landing view — also captures ?source= into sessionStorage.
    track("landing_viewed", { acquisition_source: getAcquisitionSource() ?? undefined });
  }, []);

  if (!checked) {
    return (
      <div
        className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-background"
        role="status"
        aria-live="polite"
        aria-label="Preparing KainFit"
      >
        <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-2xl">
          K
        </div>
        <div
          className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent motion-safe:animate-spin"
          aria-hidden="true"
        />
        <div className="text-sm text-primary font-medium">Preparing KainFit…</div>
      </div>
    );
  }

  return (
    <div
      className="min-h-[100dvh] flex flex-col bg-background px-6"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 3rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)",
      }}
    >
      <main className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="h-10 w-10 rounded-2xl bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">K</span>
            </div>
            <span className="text-xl font-semibold tracking-tight">KainFit</span>
            <BetaBadge className="ml-1" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight leading-[1.1]">
            Know what you ate.
            <br />
            <span className="text-primary">Instantly.</span>
          </h1>
          <p className="mt-2 text-lg font-medium text-primary">Kain mo. Klaro agad.</p>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Fast, accurate macro tracking built for the way Filipinos eat. Type or say what you had
            — in English, Filipino, or Taglish.
          </p>
        </div>
        <div className="space-y-3 mt-6">
          <Button asChild size="lg" className="w-full h-14 text-base rounded-2xl">
            <Link to="/auth" search={{ mode: "signup" }}>
              Get started
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full h-14 text-base rounded-2xl">
            <Link to="/demo">Try the demo</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="w-full h-14 text-base rounded-2xl">
            <Link to="/auth" search={{ mode: "signin" }}>
              I already have an account
            </Link>
          </Button>
        </div>
      </main>
      <footer className="mt-10 max-w-md mx-auto w-full">
        <p className="text-sm text-muted-foreground/90 text-center leading-relaxed">
          KainFit provides nutrition estimates for personal tracking. Values may vary based on
          ingredients and preparation.
        </p>
      </footer>
    </div>
  );
}
