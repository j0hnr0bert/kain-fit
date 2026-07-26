import { useState } from "react";
import { cn } from "@/lib/utils";
import type { TodaySignalPayload } from "@/lib/kain-signal-generate.server";
import { copyForSelectedInsight, iconForSignal, themeForSignal } from "./kain-signal-card-content";

type KainSignalCardProps = {
  /** Caller must only render this once payload.state === "connected" — see
   * today.tsx's showKainSignalSlot precedence rule. selectedInsight may
   * still be null here (the valid silence state: gates stay met, but
   * nothing new cleared the ranking bar today). */
  payload: TodaySignalPayload;
};

const ENTRANCE_CLASS =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300";

export function KainSignalCard({ payload }: KainSignalCardProps) {
  const [whyThisOpen, setWhyThisOpen] = useState(false);
  const insightType = payload.selectedInsight?.insightType ?? null;
  const content = copyForSelectedInsight(payload.selectedInsight);
  const Icon = iconForSignal(insightType);
  const theme = themeForSignal(insightType);

  return (
    <div
      // Remounts (and so replays its one-shot entrance) whenever the
      // selected insight actually changes for the day — never on an
      // unrelated rerender or refetch of the same insight.
      key={payload.selectedInsight?.id ?? "silence"}
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
        <div className="mt-1 text-sm font-medium text-foreground">{content.oneBetterMove}</div>
        {payload.selectedInsight && (
          <button
            type="button"
            onClick={() => setWhyThisOpen((open) => !open)}
            className="mt-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
            aria-expanded={whyThisOpen}
          >
            Why this?
          </button>
        )}
        {whyThisOpen && payload.selectedInsight && (
          <div className="mt-1.5 text-xs text-muted-foreground">{content.whyThis}</div>
        )}
      </div>
    </div>
  );
}
