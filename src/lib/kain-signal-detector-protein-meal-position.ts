// Protein-by-meal-position detector (2026-08-10 insight-quality upgrade,
// Phase 3 "Protein by meal position"). On the days a user falls short of
// their protein target, is the shortfall spread evenly across the day, or
// concentrated in a low-protein first meal that leaves them "playing catch
// up" later? That's a structural, actionable pattern a single-day view
// can't reveal — Today only ever shows how the CURRENT day is going, never
// whether this is how every shortfall day starts.
//
// "First meal" is never assumed to be breakfast, and never reads a
// meal_type category — it is derived purely from each day's own logged_at
// timestamps: entries are grouped into meal-groups by chronological gap
// (a new group starts after a gap of at least MEAL_GROUP_GAP_MINUTES since
// the previous entry that day), and the first chronological group is "the
// first meal." This works identically for a 2-meal-a-day user and a
// 5-meal-a-day user, and never depends on how (or whether) the user
// categorizes what they log.
//
// Only evaluated over shortfall days (days below the user's protein
// target) — a day the user already hit target isn't part of the "why do I
// fall short" question this detector answers, and including hit-days would
// dilute the average toward an unrelated population.

import { sumNutrients } from "./nutrient-totals";
import { classifyEvidenceStrength } from "./kain-signal-evidence-strength";
import { mean } from "./kain-signal-stats";
import {
  MEAL_GROUP_GAP_MINUTES,
  PROTEIN_MEAL_POSITION_LOW_SHARE_PCT_MAX,
  PROTEIN_MEAL_POSITION_MIN_SHORTFALL_DAYS,
} from "./kain-signal-config";
import type { FoodEntryLite, ProteinMealPositionEvidence } from "./kain-signal-types";

function firstMealProteinShare(dayEntries: readonly FoodEntryLite[]): number | null {
  if (dayEntries.length === 0) return null;
  const sorted = [...dayEntries].sort(
    (a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime(),
  );
  const gapMs = MEAL_GROUP_GAP_MINUTES * 60 * 1000;
  const firstGroup: FoodEntryLite[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const gap =
      new Date(sorted[i].logged_at).getTime() - new Date(sorted[i - 1].logged_at).getTime();
    if (gap >= gapMs) break;
    firstGroup.push(sorted[i]);
  }
  const totalProtein = sumNutrients(sorted).protein;
  if (totalProtein <= 0) return null;
  const firstGroupProtein = sumNutrients(firstGroup).protein;
  return (firstGroupProtein / totalProtein) * 100;
}

export function detectProteinMealPosition(input: {
  entriesByDay: Readonly<Record<string, readonly FoodEntryLite[]>>;
  completeDays: readonly string[];
  proteinTargetG: number | null;
  proteinTargetWindowStartDay: string | null;
}): ProteinMealPositionEvidence | null {
  if (input.proteinTargetG == null || input.proteinTargetG <= 0) return null;
  if (input.proteinTargetWindowStartDay === null) return null;
  const target = input.proteinTargetG;
  const windowStart = input.proteinTargetWindowStartDay;

  const shortfallShares: number[] = [];
  for (const day of input.completeDays) {
    if (day < windowStart) continue;
    const dayEntries = input.entriesByDay[day] ?? [];
    const dayProtein = sumNutrients(dayEntries).protein;
    if (dayProtein >= target) continue; // only shortfall days count
    const share = firstMealProteinShare(dayEntries);
    if (share !== null) shortfallShares.push(share);
  }

  const shortfallDaysEvaluated = shortfallShares.length;
  if (shortfallDaysEvaluated < PROTEIN_MEAL_POSITION_MIN_SHORTFALL_DAYS) return null;

  const avgFirstMealProteinSharePct = mean(shortfallShares);
  if (avgFirstMealProteinSharePct > PROTEIN_MEAL_POSITION_LOW_SHARE_PCT_MAX) return null;

  const evidenceStrength = classifyEvidenceStrength(
    "protein_meal_position",
    shortfallDaysEvaluated,
  );
  if (evidenceStrength === null) return null;

  return {
    insightType: "protein_meal_position",
    shortfallDaysEvaluated,
    avgFirstMealProteinSharePct,
    proteinTargetG: target,
    evidenceStrength,
  };
}
