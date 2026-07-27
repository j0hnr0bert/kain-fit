// Thin UI-layer glue for KainSignalCard — icon and theme selection only.
// All copy generation is the existing, unmodified pure pipeline in
// src/lib/kain-signal-copy.ts; this file never generates or alters a
// string, matching the same decision/wording separation coaching.ts and
// coaching-card-content.ts already use.
//
// Kept as a .ts file (not .tsx), same as coaching-card-content.ts, so
// react-refresh/only-export-components doesn't warn on a component file
// that also exports non-component values.
//
// No silence-variant handling here — KainSignalCard is only ever rendered
// by today.tsx once it is display-eligible on its own terms (state ===
// "connected" AND a real insight was selected). "No eligible KainSignal
// means no KainSignal card" is enforced at the render-site gate, not
// inside this component tree.

import { Award, CalendarCheck, TrendingUp } from "lucide-react";
import {
  behaviorMilestoneCopy,
  loggingConsistencyCopy,
  proteinAdherenceCopy,
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
// --primary/--reinforce. Shared across all three categories, including
// milestones — KainSignal reads as one consistent, distinct surface, not a
// different visual system per category (see the doctrine's "do not
// visually merge the cards [with CoachingCard], but do not introduce a
// broad visual redesign" instruction).
const SIGNAL_THEME: SignalTheme = {
  bg: "bg-signal/10",
  border: "border-signal/28",
  icon: "text-signal",
  iconWrap: "bg-signal/18",
};

const ICON_BY_INSIGHT_TYPE: Record<InsightType, typeof TrendingUp> = {
  protein_adherence: TrendingUp,
  logging_consistency: CalendarCheck,
  behavior_milestone: Award,
};

export function themeForSignal(_insightType: InsightType): SignalTheme {
  return SIGNAL_THEME;
}

export function iconForSignal(insightType: InsightType): typeof TrendingUp {
  return ICON_BY_INSIGHT_TYPE[insightType];
}

// Dispatches to the exact same pure copy functions kain-signal-copy.ts
// itself uses — reimplemented as a thin wrapper here (rather than exporting
// a dispatcher from kain-signal-copy.ts) only because the client only ever
// has a persisted SelectedInsightPayload, never the server-side-only
// RankedCandidate shape.
export function copyForSelectedInsight(selectedInsight: SelectedInsightPayload): SignalCardContent {
  switch (selectedInsight.evidence.insightType) {
    case "protein_adherence":
      return proteinAdherenceCopy(selectedInsight.evidence);
    case "logging_consistency":
      return loggingConsistencyCopy(selectedInsight.evidence);
    case "behavior_milestone":
      return behaviorMilestoneCopy(selectedInsight.evidence);
  }
}
