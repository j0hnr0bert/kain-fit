import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { track, getAcquisitionSource } from "@/lib/analytics";
import { BetaBadge } from "@/components/BetaBadge";
import { TargetRings } from "@/components/TargetRings";
import { CoachingCard } from "@/components/CoachingCard";
import { InstallKainFitCTA } from "@/components/InstallKainFitCTA";

export const Route = createFileRoute("/")({
  component: Welcome,
});

const FOOD_EXAMPLES = [
  "150g chicken adobo and 200g rice",
  "2 eggs and 1 cup rice",
  "200g grilled bangus",
  "1 serving beef tapa and 150g rice",
];

function Welcome() {
  const navigate = useNavigate();

  useEffect(() => {
    // Background only — never gates first paint. A signed-out visitor
    // never notices this ran; a signed-in one is redirected straight to
    // Today once it resolves, with no loading state shown in between
    // (the public shell below renders unconditionally either way).
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/today", replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    track("landing_viewed", { acquisition_source: getAcquisitionSource() ?? undefined });
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background">
      <div
        className="max-w-md mx-auto px-6"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)" }}
      >
        {/* ---- A. HERO ---- */}
        <header className="inline-flex items-center gap-2 mb-6">
          <div className="h-10 w-10 rounded-2xl bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg">K</span>
          </div>
          <span className="text-xl font-semibold tracking-tight">KainFit</span>
          <BetaBadge className="ml-1" />
        </header>

        <h1 className="text-4xl font-bold tracking-tight leading-[1.1]">
          Know what you ate. <span className="text-primary">Instantly.</span>
        </h1>
        <p className="mt-2 text-lg font-medium text-primary">Kain mo. Klaro agad.</p>
        <p className="mt-4 text-base text-muted-foreground leading-relaxed">
          Fast, accurate macro tracking built for Filipino food. Type or say what you ate in
          English, Filipino, or Taglish.
        </p>

        <p className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-3 py-1.5 w-fit">
          Free beta · No credit card required
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Try it before creating an account.</p>

        <div className="space-y-3 mt-6">
          <Button asChild size="lg" className="w-full h-14 text-base rounded-2xl">
            <Link to="/demo">Try KainFit free</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full h-14 text-base rounded-2xl">
            <Link to="/auth" search={{ mode: "signup" }}>
              Create free account
            </Link>
          </Button>
          <InstallKainFitCTA variant="landing" />
          <Button asChild variant="ghost" className="w-full h-11 text-sm rounded-2xl">
            <Link to="/auth" search={{ mode: "signin" }}>
              Sign in
            </Link>
          </Button>
        </div>
      </div>

      {/* ---- B. PRODUCT PROOF ---- */}
      <section className="max-w-md mx-auto px-6 mt-14">
        <h2 className="text-2xl font-bold tracking-tight">See the whole day clearly.</h2>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          Every meal updates your calories and macros so you know exactly where you stand.
        </p>
        <div className="mt-5 rounded-3xl bg-card border border-border p-5 shadow-sm">
          <div className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
            Today's targets
          </div>
          <TargetRings
            calories={1840}
            calorieTarget={2400}
            protein={178}
            proteinTarget={220}
            carbs={210}
            carbsTarget={300}
            fat={62}
            fatTarget={100}
          />
          <CoachingCard
            result={{ kind: "guide", reason: "protein-remaining" }}
            proteinRemaining={42}
            weekly={{ thisWeekDays: 3, lastWeekDays: 2 }}
            promiseEligible={false}
          />
        </div>
      </section>

      {/* ---- C. THREE-STEP EXPLANATION ---- */}
      <section className="max-w-md mx-auto px-6 mt-14">
        <h2 className="text-2xl font-bold tracking-tight">Log. Review. Know what's next.</h2>
        <ol className="mt-5 space-y-5">
          <Step
            n={1}
            title="Describe what you ate"
            body="Type or speak naturally in English, Filipino, or Taglish."
          />
          <Step
            n={2}
            title="Review the estimate"
            body="Confirm the amount, preparation, calories, and macros."
          />
          <Step
            n={3}
            title="See where you stand"
            body="Your daily totals update so you know what to prioritize next."
          />
        </ol>
      </section>

      {/* ---- D. BUILT-FOR-FILIPINO-FOOD PROOF ---- */}
      <section className="max-w-md mx-auto px-6 mt-14">
        <h2 className="text-2xl font-bold tracking-tight">Built for the way Filipinos eat.</h2>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          No rigid food search. Describe the meal naturally and KainFit works out the rest.
        </p>
        <div className="mt-4 space-y-2">
          {FOOD_EXAMPLES.map((ex) => (
            <div
              key={ex}
              className="rounded-2xl bg-card border border-border px-4 py-3 text-sm font-medium text-foreground"
            >
              "{ex}"
            </div>
          ))}
        </div>
      </section>

      {/* ---- E. INSTALLATION SECTION ---- */}
      <section className="max-w-md mx-auto px-6 mt-14">
        <h2 className="text-2xl font-bold tracking-tight">Install KainFit</h2>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          Add KainFit to your Home Screen for faster access — no App Store required during beta.
        </p>
        <InstallKainFitCTA variant="landing" className="mt-4" />
      </section>

      {/* ---- F. TRUST AND BETA DISCLOSURE ---- */}
      <section className="max-w-md mx-auto px-6 mt-14">
        <h2 className="text-2xl font-bold tracking-tight">Why trust KainFit</h2>
        <ul className="mt-4 space-y-2.5 text-sm text-foreground">
          {[
            "Free beta — no credit card required",
            "Built for Filipino food",
            "English, Filipino, and Taglish input",
            "Review before saving",
            "Edit anything that looks wrong",
            "Beta feedback directly improves the product",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <span
                className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0"
                aria-hidden="true"
              />
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-5 text-xs text-muted-foreground leading-relaxed">
          KainFit provides nutrition estimates for personal tracking. Values may vary by ingredients
          and preparation.
        </p>
        <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
          <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
            Privacy Policy
          </Link>
          <Link to="/terms" className="underline underline-offset-2 hover:text-foreground">
            Terms
          </Link>
        </div>
      </section>

      {/* ---- G. FINAL CTA ---- */}
      <section className="max-w-md mx-auto px-6 mt-14 pb-16">
        <div className="rounded-3xl bg-primary/5 border border-primary/20 p-6 text-center">
          <h2 className="text-xl font-bold tracking-tight">Try it. It takes seconds.</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Free beta · No credit card required
          </p>
          <Button asChild size="lg" className="mt-4 w-full h-14 text-base rounded-2xl">
            <Link to="/demo">Try KainFit free</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
        {n}
      </span>
      <div className="pt-0.5">
        <div className="text-base font-semibold text-foreground">{title}</div>
        <div className="mt-0.5 text-sm text-muted-foreground leading-relaxed">{body}</div>
      </div>
    </li>
  );
}
