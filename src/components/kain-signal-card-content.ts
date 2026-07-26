// Thin UI-layer glue for KainSignalCard — icon and theme selection only.
// All copy generation is the existing, unmodified pure pipeline in
// src/lib/kain-signal-copy.ts; this file never generates or alters a
// string, matching the same decision/wording separation coaching.ts and
// coaching-card-content.ts already use.
//
// Kept as a .ts file (not .tsx), same as coaching-card-content.ts, so
// react-refresh/only-export-components doesn't warn on a component file
// that also exports non-component values.

import { CalendarCheck, Sparkles, TrendingUp } from "lucide-react";
import {
  loggingConsistencyCopy,
  proteinAdherenceCopy,
  validSilenceCopy,
  type SignalCardContent,
} from "@/lib/kain-signal-copy";
import type { SelectedInsightPayload } from "@/lib/kain-signal-generate.server";
import type { InsightType } from "@/lib/kain-signal-types";

export type SignalTheme = {
  bg: string;
  border: string;
  icon: string;
  iconWrap: string;
};

// One shared identity for any real insight — see styles.css's --signal
// token comment for why this is a new color rather than a reuse of
// --primary/--reinforce.
const SIGNAL_THEME: SignalTheme = {
  bg: "bg-signal/10",
  border: "border-signal/28",
  icon: "text-signal",
  iconWrap: "bg-signal/18",
};

// The silence variant is deliberately neutral/muted, not tinted with
// --signal — "nothing urgent today" should read as calm, not as another
// attention-seeking colored card.
const SILENCE_THEME: SignalTheme = {
  bg: "bg-muted/60",
  border: "border-border",
  icon: "text-muted-foreground",
  iconWrap: "bg-muted",
};

const ICON_BY_INSIGHT_TYPE: Record<InsightType, typeof TrendingUp> = {
  protein_adherence: TrendingUp,
  logging_consistency: CalendarCheck,
};

export function themeForSignal(insightType: InsightType | null): SignalTheme {
  return insightType ? SIGNAL_THEME : SILENCE_THEME;
}

export function iconForSignal(insightType: InsightType | null): typeof Sparkles {
  return insightType ? ICON_BY_INSIGHT_TYPE[insightType] : Sparkles;
}

// Dispatches to the exact same pure copy functions kain-signal-copy.ts's
// own signalCardCopy() uses internally — reimplemented as a thin wrapper
// here (rather than calling signalCardCopy directly) only because the
// client only ever has a persisted SelectedInsightPayload, never the
// server-side-only RankedCandidate shape signalCardCopy expects.
export function copyForSelectedInsight(
  selectedInsight: SelectedInsightPayload | null,
): SignalCardContent {
  if (!selectedInsight) return validSilenceCopy();
  return selectedInsight.evidence.insightType === "protein_adherence"
    ? proteinAdherenceCopy(selectedInsight.evidence)
    : loggingConsistencyCopy(selectedInsight.evidence);
}
