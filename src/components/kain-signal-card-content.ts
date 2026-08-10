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

import {
  Award,
  CalendarCheck,
  Scale,
  Clock,
  CalendarDays,
  LineChart,
  TrendingUp,
} from "lucide-react";
import {
  behaviorMilestoneCopy,
  loggingConsistencyCopy,
  proteinAdherenceCopy,
  proteinCalorieRelationshipCopy,
  proteinMealPositionCopy,
  weekdayWeekendPatternCopy,
  trendShiftCopy,
  type SignalCardContent,
} from "@/lib/kain-signal-copy";
import { passesContradictionGuardrail } from "@/lib/kain-signal-guardrail";
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
  protein_calorie_relationship: Scale,
  protein_meal_position: Clock,
  weekday_weekend_pattern: CalendarDays,
  trend_shift: LineChart,
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
//
// 2026-08-08 recalibration: returns null — rendering nothing rather than a
// contradictory card — when the persisted evidence and its own rendered
// copy fail the contradiction guardrail (kain-signal-guardrail.ts). Under
// normal operation this should never trigger: kain-signal-generate.server.ts
// already runs the same check before a candidate can ever be selected and
// persisted. This is the client-side half of that defense-in-depth pair,
// covering a row persisted before this recalibration shipped, or a future
// regression that somehow slipped past the server-side check.
export function copyForSelectedInsight(
  selectedInsight: SelectedInsightPayload,
): SignalCardContent | null {
  const content = ((): SignalCardContent => {
    switch (selectedInsight.evidence.insightType) {
      case "protein_adherence":
        return proteinAdherenceCopy(selectedInsight.evidence);
      case "logging_consistency":
        return loggingConsistencyCopy(selectedInsight.evidence);
      case "behavior_milestone":
        return behaviorMilestoneCopy(selectedInsight.evidence);
      case "protein_calorie_relationship":
        return proteinCalorieRelationshipCopy(selectedInsight.evidence);
      case "protein_meal_position":
        return proteinMealPositionCopy(selectedInsight.evidence);
      case "weekday_weekend_pattern":
        return weekdayWeekendPatternCopy(selectedInsight.evidence);
      case "trend_shift":
        return trendShiftCopy(selectedInsight.evidence);
    }
  })();
  if (!passesContradictionGuardrail(selectedInsight.evidence, content)) {
    console.error("[kain-signal] client-side guardrail rejected a persisted insight", {
      insightId: selectedInsight.id,
      insightType: selectedInsight.insightType,
    });
    return null;
  }
  return content;
}
