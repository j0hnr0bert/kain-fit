// Trend-shift detector (2026-08-10 insight-quality upgrade, Phase 3 "Trend
// shift"). Compares the user's most recent qualified-day window against the
// window immediately before it, using the same attainment-percentage basis
// protein_adherence already computes (average target-attainment, not raw
// grams) — a genuine improvement or decline the user is unlikely to have
// consciously registered, since Today only ever shows the single most
// recent day, never a week-over-week comparison.
//
// Target-window safety applies here exactly as it does to protein_adherence
// (see kain-signal-detector-protein.ts's own comment) — a target change
// must never let an old-target day slip into either comparison window.

import { sumNutrients } from "./nutrient-totals";
import { classifyEvidenceStrength } from "./kain-signal-evidence-strength";
import { mean } from "./kain-signal-stats";
import { TREND_SHIFT_MIN_DELTA_PCT, TREND_SHIFT_WINDOW_DAYS } from "./kain-signal-config";
import type { FoodEntryLite, TrendShiftEvidence } from "./kain-signal-types";

export function detectTrendShift(input: {
  entriesByDay: Readonly<Record<string, readonly FoodEntryLite[]>>;
  completeDays: readonly string[];
  proteinTargetG: number | null;
  proteinTargetWindowStartDay: string | null;
}): TrendShiftEvidence | null {
  if (input.proteinTargetG == null || input.proteinTargetG <= 0) return null;
  if (input.proteinTargetWindowStartDay === null) return null;
  const target = input.proteinTargetG;
  const windowStart = input.proteinTargetWindowStartDay;

  const qualifiedDays = [...input.completeDays].filter((day) => day >= windowStart).sort();
  const w = TREND_SHIFT_WINDOW_DAYS;
  if (qualifiedDays.length < w * 2) return null;

  const attainmentPctFor = (day: string) => {
    const dayProtein = sumNutrients(input.entriesByDay[day] ?? []).protein;
    return (dayProtein / target) * 100;
  };

  const recentDays = qualifiedDays.slice(-w);
  const priorDays = qualifiedDays.slice(-2 * w, -w);

  const avgAttainmentPctRecent = mean(recentDays.map(attainmentPctFor));
  const avgAttainmentPctPrior = mean(priorDays.map(attainmentPctFor));
  const deltaPct = avgAttainmentPctRecent - avgAttainmentPctPrior;

  if (Math.abs(deltaPct) < TREND_SHIFT_MIN_DELTA_PCT) return null;

  const evidenceStrength = classifyEvidenceStrength("trend_shift", qualifiedDays.length);
  if (evidenceStrength === null) return null;

  return {
    insightType: "trend_shift",
    recentWindowDays: recentDays.length,
    priorWindowDays: priorDays.length,
    avgAttainmentPctRecent,
    avgAttainmentPctPrior,
    deltaPct,
    direction: deltaPct > 0 ? "positive" : "negative",
    proteinTargetG: target,
    evidenceStrength,
  };
}
