import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { ArrowLeft, Scale as ScaleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";

const searchSchema = z.object({
  from: z.enum(["today_help", "profile_help"]).optional(),
});

export const Route = createFileRoute("/_authenticated/scale-guide")({
  validateSearch: (search) => searchSchema.parse(search),
  component: ScaleGuidePage,
  head: () => ({
    meta: [
      { title: "Food scale guide — KainFit" },
      {
        name: "description",
        content:
          "Learn how to weigh your food with a basic digital scale and log it accurately in KainFit.",
      },
    ],
  }),
});

const EXAMPLE_TEXT = "150g chicken adobo and 200g cooked rice";

const STEPS: { n: number; title: string; body: string }[] = [
  { n: 1, title: "Place your empty plate on the scale.", body: "Any flat plate or bowl works." },
  {
    n: 2,
    title: "Press TARE so the display returns to 0 g.",
    body: "This ignores the plate's weight.",
  },
  { n: 3, title: "Add the food and read its weight.", body: "Weigh the portion you actually eat." },
  { n: 4, title: 'Type or say: "150 grams chicken adobo."', body: "KainFit handles the rest." },
];

function ScaleGuidePage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/_authenticated/scale-guide" });
  const entryPoint = search.from ?? "today_help";

  useEffect(() => {
    track("scale_guide_opened", { entry_point: entryPoint });
  }, [entryPoint]);

  function tryOnToday() {
    track("scale_example_started", { entry_point: entryPoint });
    track("scale_guide_completed", { entry_point: entryPoint });
    try {
      sessionStorage.setItem("kf.scalePrefill", EXAMPLE_TEXT);
      sessionStorage.setItem("kf.scaleFocus", "1");
    } catch {
      /* ignore */
    }
    navigate({ to: "/today" });
  }

  return (
    <div className="min-h-[100dvh] bg-background pb-16 overflow-x-hidden">
      <div
        className="max-w-md mx-auto px-5"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full -ml-2"
            aria-label="Back"
          >
            <Link to="/today">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
        </div>

        <div className="flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/10 text-primary mb-4">
          <ScaleIcon className="h-8 w-8" />
        </div>

        <h1 className="text-2xl font-bold tracking-tight leading-tight">
          Track food more accurately
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A basic digital food scale and KainFit are all you need.
        </p>

        <ol className="mt-6 space-y-3">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="rounded-2xl bg-card border border-border p-4 flex gap-4 items-start"
            >
              <div
                aria-hidden
                className="h-9 w-9 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold"
              >
                {s.n}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-snug">{s.title}</div>
                <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{s.body}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-6 rounded-2xl bg-muted/50 border border-border p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Try this example
          </div>
          <div className="mt-1 text-sm font-medium break-words">{EXAMPLE_TEXT}</div>
        </div>

        <Button
          onClick={tryOnToday}
          className="mt-4 w-full h-12 rounded-2xl text-base font-semibold"
        >
          Try it on Today
        </Button>

        <p className="mt-5 text-xs text-muted-foreground leading-relaxed px-1">
          Weigh the portion you actually eat. For the most accurate result, specify cooked or raw
          when it matters.
        </p>
      </div>
    </div>
  );
}
