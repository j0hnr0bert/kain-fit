// Protein-vs-calorie relationship detector (2026-08-10 insight-quality
// upgrade, Phase 3 "Protein vs calorie intake"). Answers a question Today's
// single-day view structurally cannot: across the user's own history, are
// their lowest-calorie days ALSO disproportionately low-protein days? If
// so, that's a real tradeoff the user is cutting protein along with
// calories, not just calories alone — and it's the kind of pattern that's
// invisible one day at a time, which is exactly the "I hadn't noticed that"
// bar this upgrade is aiming for.
//
// Method: split the user's own complete days into two halves by their own
// median daily calories (never a fixed absolute number like "1800 kcal" —
// that would be an invented, unpersonalized threshold; the median is
// whatever THIS user's own data says "lower" and "higher" mean for them).
// Compare average protein between the two halves. Only surfaces if the gap
// is large enough (PROTEIN_CALORIE_MIN_GAP_G) to be a real pattern, not
// noise — a 3g difference between halves proves nothing.
//
// This never claims cutting calories CAUSES the protein drop — only that
// the two move together in this user's own logged history (see
// kain-signal-copy.ts's causality-safe phrasing and kain-signal-
// guardrail.ts's universal causal-language check).

import { sumNutrients } from "./nutrient-totals";
import { classifyEvidenceStrength } from "./kain-signal-evidence-strength";
import { mean, median } from "./kain-signal-stats";
import { PROTEIN_CALORIE_MIN_DAYS, PROTEIN_CALORIE_MIN_GAP_G } from "./kain-signal-config";
import type { FoodEntryLite, ProteinCalorieRelationshipEvidence } from "./kain-signal-types";

export function detectProteinCalorieRelationship(input: {
  entriesByDay: Readonly<Record<string, readonly FoodEntryLite[]>>;
  completeDays: readonly string[];
}): ProteinCalorieRelationshipEvidence | null {
  const daysEvaluated = input.completeDays.length;
  if (daysEvaluated < PROTEIN_CALORIE_MIN_DAYS) return null;

  const perDay = input.completeDays.map((day) => {
    const dayEntries = input.entriesByDay[day] ?? [];
    const totals = sumNutrients(dayEntries);
    return { day, calories: totals.calories, protein: totals.protein };
  });

  const calorieMedian = median(perDay.map((d) => d.calories));
  const lowerGroup = perDay.filter((d) => d.calories < calorieMedian);
  const higherGroup = perDay.filter((d) => d.calories >= calorieMedian);
  // A degenerate split (e.g. every day has identical calories) leaves one
  // side empty — nothing to compare.
  if (lowerGroup.length === 0 || higherGroup.length === 0) return null;

  const avgCaloriesLowerGroup = mean(lowerGroup.map((d) => d.calories));
  const avgCaloriesHigherGroup = mean(higherGroup.map((d) => d.calories));
  const avgProteinLowerGroup = mean(lowerGroup.map((d) => d.protein));
  const avgProteinHigherGroup = mean(higherGroup.map((d) => d.protein));
  const proteinGapG = avgProteinHigherGroup - avgProteinLowerGroup;

  // Only the "protein drops with calories" direction is a tradeoff worth
  // naming — the reverse (protein stays flat, or is even higher, on
  // lower-calorie days) means the user is already protecting protein when
  // cutting calories, which is a different, non-actionable story this
  // detector isn't built to tell.
  if (proteinGapG < PROTEIN_CALORIE_MIN_GAP_G) return null;

  const evidenceStrength = classifyEvidenceStrength("protein_calorie_relationship", daysEvaluated);
  if (evidenceStrength === null) return null;

  return {
    insightType: "protein_calorie_relationship",
    daysEvaluated,
    lowerCalorieDayCount: lowerGroup.length,
    higherCalorieDayCount: higherGroup.length,
    avgCaloriesLowerGroup,
    avgCaloriesHigherGroup,
    avgProteinLowerGroup,
    avgProteinHigherGroup,
    proteinGapG,
    evidenceStrength,
  };
}
