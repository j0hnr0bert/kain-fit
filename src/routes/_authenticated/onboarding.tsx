import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

// The personal questionnaire has been removed. Any deep link to /onboarding
// (older builds, cached history) now silently marks the account as onboarded
// and forwards to /today.
export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingRedirect,
});

function OnboardingRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        await supabase
          .from("profiles")
          .update({ onboarded: true })
          .eq("user_id", u.user.id);
      }
      navigate({ to: "/today", replace: true });
    })();
  }, [navigate]);
  return <div className="min-h-[100dvh] bg-background" />;
}