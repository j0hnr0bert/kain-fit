import { cn } from "@/lib/utils";
import type { CoachingResult } from "@/lib/coaching";
import { messageFor, themeForTone } from "./coaching-card-content";

type CoachingCardProps = {
  result: CoachingResult;
  proteinRemaining: number;
  weekly: { thisWeekDays: number; lastWeekDays: number };
  /** True only in the render where `result` became "celebrate" because of a
   * just-completed save (coaching.ts's transient override) — never true for
   * the steady-state Celebrate branch. Gates the one-shot entrance
   * animation so it never plays on page load or an unrelated rerender. */
  justCompletedCelebrate?: boolean;
};

export function CoachingCard({
  result,
  proteinRemaining,
  weekly,
  justCompletedCelebrate,
}: CoachingCardProps) {
  const content = messageFor(result, proteinRemaining, weekly);
  if (!content) return null;
  const Icon = content.icon;
  const theme = themeForTone(content.tone);
  const playEntrance = content.tone === "celebrate" && justCompletedCelebrate === true;
  return (
    <div
      className={cn(
        "mt-3 rounded-2xl border p-4 flex items-start gap-3",
        theme.bg,
        theme.border,
        // motion-safe: only plays under prefers-reduced-motion: no-preference
        // (same convention already used for the spinner in routes/index.tsx).
        // Runs once — content.tone is only ever "celebrate" via the
        // transient override for a single render (see coaching.ts's
        // consumeCelebrateIfShown), so this class combination can't recur
        // from an unrelated rerender or query refetch.
        playEntrance &&
          "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300",
      )}
    >
      <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", theme.icon)} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-sm font-medium">{content.line}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{content.taglish}</div>
      </div>
    </div>
  );
}
