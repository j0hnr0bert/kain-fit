import { cn } from "@/lib/utils";
import type { CoachingResult } from "@/lib/coaching";
import {
  messageFor,
  themeForTone,
  REACTION_THEME,
  type ReactionContent,
} from "./coaching-card-content";

type CoachingCardProps = {
  result: CoachingResult;
  proteinRemaining: number;
  weekly: { thisWeekDays: number; lastWeekDays: number };
  /** See isPromiseEligible in coaching-card-content.ts — true only when the
   * user's active targets were explicitly entered/confirmed by them
   * (profiles.manual_targets_enabled), never for an auto-generated default.
   * Gates "Promise kept" vs. "Targets handled" on Celebrate. */
  promiseEligible: boolean;
  /** True only in the render where `result` became "celebrate" because of a
   * just-completed save (coaching.ts's transient override) — never true for
   * the steady-state Celebrate branch. Gates the one-shot entrance
   * animation so it never plays on page load or an unrelated rerender. */
  justCompletedCelebrate?: boolean;
  /** Transient post-save acknowledgment (the "doggy-biscuit moment") — when
   * present, shown instead of the normal messageFor() content for a few
   * seconds (see today.tsx's save handler), then cleared so the standing
   * coaching hierarchy takes back over on its own. Never changes what
   * evaluateCoaching() decides — purely a display-layer overlay. */
  reaction?: ReactionContent | null;
  /** Called when the reaction's explicit dismiss control (shown only when
   * reaction.dismissible is true) is activated. today.tsx wires this to
   * the same state clear its own auto-dismiss timer already performs. */
  onDismissReaction?: () => void;
};

const ENTRANCE_CLASS =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300";

export function CoachingCard({
  result,
  proteinRemaining,
  weekly,
  promiseEligible,
  justCompletedCelebrate,
  reaction,
  onDismissReaction,
}: CoachingCardProps) {
  if (reaction) {
    const theme = REACTION_THEME[reaction.quality];
    const Icon = reaction.icon;
    return (
      <div
        role="status"
        className={cn(
          "mt-3 rounded-2xl border p-4 flex items-start gap-3",
          theme.bg,
          theme.border,
          theme.extra,
          // Always plays — presence of `reaction` itself only ever means
          // "a save just completed" (see today.tsx), so this is never
          // shown on page load or an unrelated rerender.
          ENTRANCE_CLASS,
        )}
      >
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            theme.iconWrap,
          )}
        >
          <Icon className={cn("h-4 w-4", theme.icon)} aria-hidden="true" />
        </div>
        <div className="min-w-0 pt-0.5">
          <div className="text-sm font-semibold text-foreground">{reaction.headline}</div>
          <div className="mt-0.5 text-sm text-foreground/85">{reaction.body}</div>
          {reaction.nextAction && (
            <div className="mt-1.5 text-xs font-medium text-foreground/70">
              {reaction.nextAction}
            </div>
          )}
          <div className="mt-1 text-xs text-muted-foreground">{reaction.taglish}</div>
        </div>
        {reaction.dismissible && (
          <button
            type="button"
            onClick={onDismissReaction}
            aria-label="Dismiss"
            className="shrink-0 -m-1 p-1 text-foreground/50 hover:text-foreground/80"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        )}
      </div>
    );
  }

  const content = messageFor(result, proteinRemaining, weekly, promiseEligible);
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
        theme.extra,
        // Runs once — content.tone is only ever "celebrate" via the
        // transient override for a single render (see coaching.ts's
        // consumeCelebrateIfShown), so this class combination can't recur
        // from an unrelated rerender or query refetch.
        playEntrance && ENTRANCE_CLASS,
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          theme.iconWrap,
        )}
      >
        <Icon className={cn("h-4 w-4", theme.icon)} aria-hidden="true" />
      </div>
      <div className="min-w-0 pt-0.5">
        <div className="text-sm font-semibold text-foreground">{content.headline}</div>
        <div className="mt-0.5 text-sm text-foreground/85">{content.body}</div>
        <div className="mt-1 text-xs text-muted-foreground">{content.taglish}</div>
      </div>
    </div>
  );
}
