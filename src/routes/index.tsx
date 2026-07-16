import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

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

  if (!checked) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background px-6 pt-16 pb-10 safe-area">
      <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="h-10 w-10 rounded-2xl bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">K</span>
            </div>
            <span className="text-xl font-semibold tracking-tight">KainFit</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight leading-[1.1]">
            Know what you ate.
            <br />
            <span className="text-primary">Instantly.</span>
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Fast, accurate macro tracking built for the way Filipinos eat. Type or say
            what you had — in English, Filipino, or Taglish.
          </p>
        </div>
        <div className="space-y-3 mt-6">
          <Button asChild size="lg" className="w-full h-14 text-base rounded-2xl">
            <Link to="/auth" search={{ mode: "signup" }}>Get started</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="w-full h-14 text-base rounded-2xl">
            <Link to="/auth" search={{ mode: "signin" }}>I already have an account</Link>
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground text-center max-w-md mx-auto">
        KainFit provides nutrition estimates for personal tracking. Values may vary based on ingredients and preparation.
      </p>
    </div>
  );
}
