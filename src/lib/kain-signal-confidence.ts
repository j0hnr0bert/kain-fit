// Derives a per-entry data-quality class from the fields food_entries
// actually has (data_source, is_estimate, confidence) — see
// kain-signal-types.ts's EntryConfidenceClass comment for why this isn't
// based on a logging-method tag (voice/barcode/plate-scan): that field
// doesn't exist in this schema, since logging today is text-only,
// AI-parsed. This mapping reuses the same three source fields
// food-display.ts's foodStatus() already reads for its own display tone,
// but produces a KainSignal-specific three-class verdict instead of a UI
// label.
//
// Worked examples:
//   data_source="verified_database", is_estimate=false, confidence=0.95
//     -> "verified" (a matched food, portion confirmed, no estimate)
//   data_source="verified_database", is_estimate=true,  confidence=0.8
//     -> "provisional" (matched food, but preparation/portion inferred)
//   data_source="estimated",         is_estimate=true,  confidence=0.4
//     -> "low_trust" (both the estimated source and the low confidence
//        independently qualify it)

import { LOW_TRUST_CONFIDENCE_MAX } from "./kain-signal-config";
import type { EntryConfidenceClass, FoodEntryLite } from "./kain-signal-types";

export function classifyEntryConfidence(
  entry: Pick<FoodEntryLite, "data_source" | "is_estimate" | "confidence">,
): EntryConfidenceClass {
  const isLowConfidence = entry.confidence != null && entry.confidence < LOW_TRUST_CONFIDENCE_MAX;
  if (entry.data_source === "estimated" || isLowConfidence) {
    return "low_trust";
  }
  if (entry.data_source === "verified_database" && !entry.is_estimate) {
    return "verified";
  }
  return "provisional";
}
