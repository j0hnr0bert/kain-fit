// Phase-1 detector #1 (the doctrine's own top opening domain): does the
// user reach their protein target more often than not, on days with
// complete evidence? Returns null — not an error, not a weak insight —
// when there's nothing to evaluate: no manual protein target set (most
// users won't have one), or too few complete days for the evidence to mean
// anything (see classifyEvidenceStrength's early-signal floor).
//
// 2026-08-08 recalibration: this module previously computed only a binary
// hit rate (daysAtOrAboveTarget / daysEvaluated) and left "is this good or
// bad" entirely to the copy layer, which in turn treated evidenceStrength
// (a pure sample-size measure) as if it meant "positive" — a user who hit
// a 220g target on 2 of 15 days (13% hit rate, ~65-75% average attainment)
// was surfaced as "one of your strongest nutrition patterns" and "a
// workable habit." That was a real production bug, not a wording issue:
// sample size and direction were conflated with no explicit direction
// field anywhere in the pipeline. This version computes average/median
// target-attainment percentage, day-to-day variance, and an explicit
// direction + directionTier — see kain-signal-config.ts's PROTEIN_* bands
// and classifyProteinDirection below. The binary hit-rate fields are kept
// only as supporting evidence in the rendered "evidence" sentence, never as
// the basis for direction.
//
// 2026-08-09 recalibration: also filters completeDays to only those on or
// after proteinTargetWindowStartDay — profiles.target_protein_g is a
// single current value with a companion protein_target_updated_at
// timestamp (see the migration), so a day logged under a DIFFERENT,
// earlier target is excluded rather than silently re-judged against
// today's number. Evidence effectively restarts (fewer days, or null if
// below the early-signal floor) immediately after any target change.
//

// Worked examples (used verbatim in the test suite):
//   8 complete days, target 130g, daily totals
//   [140,150,120,135,100,145,160,90] -> 5 days meet/exceed the target ->
//   adherenceRate=0.625, daysEvaluated=8 -> evidenceStrength='clear_signal'.
//   averageAttainmentPct ~= 106.5%, but attainment varies enough
//   (100/130=76.9% up to 160/130=123%) that this is NOT a clean "strong"
//   case — see the test file for the exact computed direction/tier.

import { sumNutrients } from "./nutrient-totals";
import { classifyEvidenceStrength } from "./kain-signal-evidence-strength";
import { mean, median, stdDev } from "./kain-signal-stats";
import {
  PROTEIN_BORDERLINE_MIN_ATTAINMENT_PCT,
  PROTEIN_LOW_VARIANCE_STDDEV_PCT_MAX,
  PROTEIN_MODERATE_VARIANCE_STDDEV_PCT_MAX,
  PROTEIN_NEGATIVE_CLEAR_MAX_ATTAINMENT_PCT,
  PROTEIN_NEGATIVE_STRONG_MAX_ATTAINMENT_PCT,
  PROTEIN_POSITIVE_CLEAR_MIN_ATTAINMENT_PCT,
  PROTEIN_POSITIVE_STRONG_MIN_ATTAINMENT_PCT,
} from "./kain-signal-config";
import type {
  AttainmentConsistency,
  FoodEntryLite,
  ProteinAdherenceEvidence,
  SignalDirection,
  SignalDirectionTier,
} from "./kain-signal-types";

function classifyConsistency(attainmentStdDevPct: number): AttainmentConsistency {
  if (attainmentStdDevPct <= PROTEIN_LOW_VARIANCE_STDDEV_PCT_MAX) return "low_variance";
  if (attainmentStdDevPct <= PROTEIN_MODERATE_VARIANCE_STDDEV_PCT_MAX) return "moderate_variance";
  return "high_variance";
}

// See kain-signal-config.ts's PROTEIN_* constants for the calibration
// rationale. Evaluated high-to-low so the bands never overlap.
export function classifyProteinDirection(
  averageAttainmentPct: number,
  consistency: AttainmentConsistency,
): { direction: SignalDirection; directionTier: SignalDirectionTier } {
  if (averageAttainmentPct >= PROTEIN_POSITIVE_STRONG_MIN_ATTAINMENT_PCT) {
    // A volatile 90%+ average (some days far under, some far over) is not
    // the same claim as a steady one — cap the tier, never the direction,
    // so copy can still say "positive" but must not say "consistent."
    return {
      direction: "positive",
      directionTier: consistency === "high_variance" ? "clear" : "strong",
    };
  }
  if (averageAttainmentPct >= PROTEIN_POSITIVE_CLEAR_MIN_ATTAINMENT_PCT) {
    return { direction: "positive", directionTier: "clear" };
  }
  if (averageAttainmentPct >= PROTEIN_BORDERLINE_MIN_ATTAINMENT_PCT) {
    return { direction: "neutral", directionTier: "borderline" };
  }
  if (averageAttainmentPct >= PROTEIN_NEGATIVE_STRONG_MAX_ATTAINMENT_PCT) {
    return { direction: "negative", directionTier: "clear" };
  }
  return { direction: "negative", directionTier: "strong" };
}

export function detectProteinAdherence(input: {
  entriesByDay: Readonly<Record<string, readonly FoodEntryLite[]>>;
  completeDays: readonly string[];
  proteinTargetG: number | null;
  // Target-window safety (2026-08-09 recalibration): a Manila-day string —
  // only qualified days on or after this day may be evaluated against
  // proteinTargetG. A day logged before the target last changed was
  // logged under a DIFFERENT target; judging it against today's number
  // would retroactively invent an adherence pattern that never happened.
  // A target that's set but has no reliable window-start (should not
  // happen given the migration's backfill + trigger, but not worth
  // trusting blindly) means null here — return null rather than guess.
  proteinTargetWindowStartDay: string | null;
}): ProteinAdherenceEvidence | null {
  if (input.proteinTargetG == null || input.proteinTargetG <= 0) return null;
  if (input.proteinTargetWindowStartDay === null) return null;

  const windowStart = input.proteinTargetWindowStartDay;
  const qualifiedDays = input.completeDays.filter((day) => day >= windowStart);

  const daysEvaluated = qualifiedDays.length;
  const target = input.proteinTargetG;
  const dailyGrams: number[] = [];
  let daysAtOrAboveTarget = 0;
  for (const day of qualifiedDays) {
    const dayEntries = input.entriesByDay[day] ?? [];
    const proteinTotal = sumNutrients(dayEntries).protein;
    dailyGrams.push(proteinTotal);
    if (proteinTotal >= target) daysAtOrAboveTarget += 1;
  }

  const evidenceStrength = classifyEvidenceStrength("protein_adherence", daysEvaluated);
  if (evidenceStrength === null) return null;

  const dailyAttainmentPct = dailyGrams.map((g) => (g / target) * 100);
  const averageGramsPerDay = mean(dailyGrams);
  const averageAttainmentPct = mean(dailyAttainmentPct);
  const medianAttainmentPct = median(dailyAttainmentPct);
  const attainmentStdDevPct = stdDev(dailyAttainmentPct, averageAttainmentPct);
  const consistency = classifyConsistency(attainmentStdDevPct);
  const { direction, directionTier } = classifyProteinDirection(averageAttainmentPct, consistency);

  return {
    insightType: "protein_adherence",
    daysEvaluated,
    daysAtOrAboveTarget,
    adherenceRate: daysEvaluated > 0 ? daysAtOrAboveTarget / daysEvaluated : 0,
    proteinTargetG: target,
    evidenceStrength,
    averageGramsPerDay,
    averageAttainmentPct,
    medianAttainmentPct,
    attainmentStdDevPct,
    averageShortfallG: target - averageGramsPerDay,
    consistency,
    direction,
    directionTier,
  };
}
