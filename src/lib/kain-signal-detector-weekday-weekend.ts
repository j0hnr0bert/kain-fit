// Weekday-vs-weekend detector (2026-08-10 insight-quality upgrade, Phase 3
// "Weekday vs weekend"). Deliberately narrow: this detector looks for
// exactly one specific, higher-value pattern — calories staying roughly
// flat between weekdays and weekends while protein moves — and surfaces
// nothing when both move together. "Weekend calories are higher" is what
// most users already assume without being told; it's the obvious story,
// not an insight. The surprising, useful version is when that assumption
// turns out to be wrong: the total food intake looks similar, but its
// protein content quietly drops.
//
// Day-of-week is read directly from the Manila-day string itself (no extra
// query, no timezone ambiguity beyond what manilaDay() already resolved
// upstream) — noon UTC on that calendar date is used purely to get a
// stable getUTCDay() read, never to interpret the day boundary itself.

import { sumNutrients } from "./nutrient-totals";
import { classifyEvidenceStrength } from "./kain-signal-evidence-strength";
import { mean } from "./kain-signal-stats";
import {
  WEEKDAY_WEEKEND_MAX_STABLE_CALORIE_DIFF_PCT,
  WEEKDAY_WEEKEND_MIN_PROTEIN_DIFF_G,
  WEEKDAY_WEEKEND_MIN_WEEKDAY_DAYS,
  WEEKDAY_WEEKEND_MIN_WEEKEND_DAYS,
} from "./kain-signal-config";
import type { FoodEntryLite, WeekdayWeekendPatternEvidence } from "./kain-signal-types";

function isWeekend(day: string): boolean {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

export function detectWeekdayWeekendPattern(input: {
  entriesByDay: Readonly<Record<string, readonly FoodEntryLite[]>>;
  completeDays: readonly string[];
}): WeekdayWeekendPatternEvidence | null {
  const weekdayDays: string[] = [];
  const weekendDays: string[] = [];
  for (const day of input.completeDays) {
    (isWeekend(day) ? weekendDays : weekdayDays).push(day);
  }
  if (
    weekdayDays.length < WEEKDAY_WEEKEND_MIN_WEEKDAY_DAYS ||
    weekendDays.length < WEEKDAY_WEEKEND_MIN_WEEKEND_DAYS
  ) {
    return null;
  }

  const totalsFor = (days: readonly string[]) =>
    days.map((day) => sumNutrients(input.entriesByDay[day] ?? []));

  const weekdayTotals = totalsFor(weekdayDays);
  const weekendTotals = totalsFor(weekendDays);
  const avgCaloriesWeekday = mean(weekdayTotals.map((t) => t.calories));
  const avgCaloriesWeekend = mean(weekendTotals.map((t) => t.calories));
  const avgProteinWeekday = mean(weekdayTotals.map((t) => t.protein));
  const avgProteinWeekend = mean(weekendTotals.map((t) => t.protein));

  if (avgCaloriesWeekday <= 0) return null;
  const calorieDiffPct = ((avgCaloriesWeekend - avgCaloriesWeekday) / avgCaloriesWeekday) * 100;
  const proteinDiffG = avgProteinWeekend - avgProteinWeekday;

  // The narrow pattern this detector exists for: calories essentially flat
  // (within the stability band, either direction) AND protein moves by a
  // material amount (either direction — a weekend protein INCREASE with
  // flat calories is just as non-obvious as a decrease).
  if (Math.abs(calorieDiffPct) > WEEKDAY_WEEKEND_MAX_STABLE_CALORIE_DIFF_PCT) return null;
  if (Math.abs(proteinDiffG) < WEEKDAY_WEEKEND_MIN_PROTEIN_DIFF_G) return null;

  const evidenceStrength = classifyEvidenceStrength(
    "weekday_weekend_pattern",
    weekdayDays.length + weekendDays.length,
  );
  if (evidenceStrength === null) return null;

  return {
    insightType: "weekday_weekend_pattern",
    weekdayCount: weekdayDays.length,
    weekendCount: weekendDays.length,
    avgCaloriesWeekday,
    avgCaloriesWeekend,
    avgProteinWeekday,
    avgProteinWeekend,
    calorieDiffPct,
    proteinDiffG,
    evidenceStrength,
  };
}
