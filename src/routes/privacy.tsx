import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — KainFit" },
      { name: "description", content: "How KainFit collects, uses, and protects your data." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="min-h-[100dvh] bg-background px-6 pt-6 pb-16">
      <div className="max-w-2xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground -ml-2 px-2 py-1"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: July 2026</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-foreground/90">
          <section>
            <h2 className="text-lg font-semibold">What we collect</h2>
            <p className="mt-2 text-muted-foreground">
              To power your account we store the email or phone you sign up with, the food entries
              you log, and basic profile details you provide during onboarding.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">How we use it</h2>
            <p className="mt-2 text-muted-foreground">
              Your data is used to render your Today screen, keep your history, and improve the
              accuracy of parsing for the foods you personally log. We do not sell your data.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Demo mode</h2>
            <p className="mt-2 text-muted-foreground">
              The demo experience runs entirely in your browser with pre-populated sample data.
              Nothing you type in demo mode is stored on our servers or linked to an account.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Security</h2>
            <p className="mt-2 text-muted-foreground">
              Data is protected by row-level security so one account can never read another's logs.
              Access tokens are stored in secure, browser-managed storage.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Your controls</h2>
            <p className="mt-2 text-muted-foreground">
              You can delete individual entries at any time. To delete your account and all
              associated data, contact{" "}
              <a href="mailto:privacy@kainfit.app" className="text-primary underline">
                privacy@kainfit.app
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
