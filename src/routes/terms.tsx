import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — KainFit" },
      { name: "description", content: "The terms that govern your use of KainFit." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <main className="min-h-[100dvh] bg-background px-6 pt-6 pb-16">
      <div className="max-w-2xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground -ml-2 px-2 py-1"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: July 2026</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-foreground/90">
          <section>
            <h2 className="text-lg font-semibold">1. Using KainFit</h2>
            <p className="mt-2 text-muted-foreground">
              KainFit helps you track the food you eat. By creating an account you agree to use the
              app for personal, non-commercial tracking, and not to attempt to disrupt the service
              or misuse other users' data.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">2. Nutrition estimates</h2>
            <p className="mt-2 text-muted-foreground">
              Calorie and macronutrient values in KainFit are estimates generated from public food
              data and AI-assisted parsing. They are not medical advice. Values may vary based on
              ingredients, portion size, and preparation.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">3. Your content</h2>
            <p className="mt-2 text-muted-foreground">
              You keep ownership of everything you log. We only use it to power your personal
              tracking experience.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">4. Changes</h2>
            <p className="mt-2 text-muted-foreground">
              We may update these terms as KainFit evolves. Material changes will be surfaced in-app
              before they take effect.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">5. Contact</h2>
            <p className="mt-2 text-muted-foreground">
              Questions? Reach us at{" "}
              <a href="mailto:hello@kainfit.app" className="text-primary underline">
                hello@kainfit.app
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
