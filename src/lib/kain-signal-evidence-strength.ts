// Table-driven evidence-strength classification, kept as its own module so
// "thresholds are configurable per insight type" (not one universal
// sample-size cutoff) is directly testable independent of any detector.
// Below the "early" floor, a sample is too small to claim anything at all
// — classifyEvidenceStrength returns null, and the calling detector must
// return null too (no evidence object at all, not a weak one).
//
// Worked boundaries (protein: early=5, clear=8, strong=14):
//   sampleSize=4  -> null (too little to say anything)
//   sampleSize=5  -> "early_signal"
//   sampleSize=8  -> "clear_signal"
//   sampleSize=14 -> "strong_signal"
//
// 2026-08-10 insight-quality upgrade: was a two-way ternary (protein vs.
// logging) before the four new relational detectors needed their own
// threshold bands too — this is now a full per-InsightType table.
// behavior_milestone never calls this (its evidenceStrength is a fixed
// "strong_signal" — see kain-signal-types.ts's MilestoneEvidence comment)
// but still has a table entry so this function stays total over InsightType
// rather than partial.

import {
  LOGGING_CONSISTENCY_EVIDENCE_THRESHOLDS,
  PROTEIN_ADHERENCE_EVIDENCE_THRESHOLDS,
  PROTEIN_CALORIE_RELATIONSHIP_EVIDENCE_THRESHOLDS,
  PROTEIN_MEAL_POSITION_EVIDENCE_THRESHOLDS,
  TREND_SHIFT_EVIDENCE_THRESHOLDS,
  WEEKDAY_WEEKEND_EVIDENCE_THRESHOLDS,
} from "./kain-signal-config";
import type { EvidenceStrength, InsightType } from "./kain-signal-types";

type Thresholds = { early: number; clear: number; strong: number };

const THRESHOLDS_BY_TYPE: Record<InsightType, Thresholds> = {
  protein_adherence: PROTEIN_ADHERENCE_EVIDENCE_THRESHOLDS,
  logging_consistency: LOGGING_CONSISTENCY_EVIDENCE_THRESHOLDS,
  behavior_milestone: { early: 0, clear: 0, strong: 0 }, // unused — see header comment
  protein_calorie_relationship: PROTEIN_CALORIE_RELATIONSHIP_EVIDENCE_THRESHOLDS,
  protein_meal_position: PROTEIN_MEAL_POSITION_EVIDENCE_THRESHOLDS,
  weekday_weekend_pattern: WEEKDAY_WEEKEND_EVIDENCE_THRESHOLDS,
  trend_shift: TREND_SHIFT_EVIDENCE_THRESHOLDS,
};

export function classifyEvidenceStrength(
  insightType: InsightType,
  sampleSize: number,
): EvidenceStrength | null {
  const thresholds = THRESHOLDS_BY_TYPE[insightType];
  if (sampleSize >= thresholds.strong) return "strong_signal";
  if (sampleSize >= thresholds.clear) return "clear_signal";
  if (sampleSize >= thresholds.early) return "early_signal";
  return null;
}
