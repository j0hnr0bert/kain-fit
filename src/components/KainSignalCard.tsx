import { useState } from "react";
import { cn } from "@/lib/utils";
import type { SelectedInsightPayload } from "@/lib/kain-signal-generate.server";
import { copyForSelectedInsight, iconForSignal, themeForSignal } from "./kain-signal-card-content";

type KainSignalCardProps = {
  /** Caller must only render this once KainSignal is display-eligible on
   * its own terms — see today.tsx's kainSignalEligible check. There is no
   * null/silence variant: "no eligible KainSignal means no KainSignal
   * card" is enforced before this component is ever mounted. This
   * component is an independent layer from CoachingCard (2026-07-27
   * correction) — it renders purely on its own eligibility, never as an
   * alternative to CoachingCard. */
  selectedInsight: SelectedInsightPayload;
};

const ENTRANCE_CLASS =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300";

export function KainSignalCard({ selectedInsight }: KainSignalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const content = copyForSelectedInsight(selectedInsight);
  const Icon = iconForSignal(selectedInsight.insightType);
  const theme = themeForSignal(selectedInsight.insightType);

  return (
    <div
      // Remounts (and so replays its one-shot entrance) whenever the
      // selected insight actually changes for the day — never on an
      // unrelated rerender or refetch of the same insight.
      key={selectedInsight.id}
      className={cn(
        "mt-3 rounded-2xl border p-4 flex items-start gap-3",
        theme.bg,
        theme.border,
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
        <div className="text-sm font-semibold text-foreground">{content.headline}</div>
        <div className="mt-0.5 text-sm text-foreground/85">{content.observation}</div>
        {/* takeaway interprets the pattern — never a same-day instruction,
            never labeled as a recommendation or next action; that
            ownership belongs exclusively to CoachingCard. */}
        <div className="mt-1 text-sm font-medium text-foreground">{content.takeaway}</div>
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="mt-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
          aria-expanded={expanded}
        >
          What this may mean
        </button>
        {expanded && (
          <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground/70">Evidence: </span>
              {content.evidence}
            </p>
            <p>
              <span className="font-medium text-foreground/70">Why it matters: </span>
              {content.whyItMatters}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
