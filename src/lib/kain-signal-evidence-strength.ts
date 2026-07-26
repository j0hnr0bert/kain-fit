// Table-driven evidence-strength classification, kept as its own module so
// "thresholds are configurable per insight type" (not one universal
// sample-size cutoff) is directly testable independent of either detector.
// Below the "early" floor, a sample is too small to claim anything at all
// — classifyEvidenceStrength returns null, and the calling detector must
// return null too (no evidence object at all, not a weak one).
//
// Worked boundaries (protein: early=5, clear=8, strong=14):
//   sampleSize=4  -> null (too little to say anything)
//   sampleSize=5  -> "early_signal"
//   sampleSize=8  -> "clear_signal"
//   sampleSize=14 -> "strong_signal"

import {
  LOGGING_CONSISTENCY_EVIDENCE_THRESHOLDS,
  PROTEIN_ADHERENCE_EVIDENCE_THRESHOLDS,
} from "./kain-signal-config";
import type { EvidenceStrength, InsightType } from "./kain-signal-types";

export function classifyEvidenceStrength(
  insightType: InsightType,
  sampleSize: number,
): EvidenceStrength | null {
  const thresholds =
    insightType === "protein_adherence"
      ? PROTEIN_ADHERENCE_EVIDENCE_THRESHOLDS
      : LOGGING_CONSISTENCY_EVIDENCE_THRESHOLDS;
  if (sampleSize >= thresholds.strong) return "strong_signal";
  if (sampleSize >= thresholds.clear) return "clear_signal";
  if (sampleSize >= thresholds.early) return "early_signal";
  return null;
}
