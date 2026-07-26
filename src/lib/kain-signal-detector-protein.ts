// Phase-1 detector #1 (the doctrine's own top opening domain): does the
// user reach their protein target more often than not, on days with
// complete evidence? Returns null — not an error, not a weak insight —
// when there's nothing to evaluate: no manual protein target set (most
// users won't have one), or too few complete days for the evidence to mean
// anything (see classifyEvidenceStrength's early-signal floor).
//
// Worked example (used verbatim in the test suite): 8 complete days,
// target 130g, daily protein totals [140,150,120,135,100,145,160,90] -> 5
// days meet/exceed the target -> adherenceRate=0.625, daysEvaluated=8 ->
// evidenceStrength='clear_signal' (8 >= clear:8, < strong:14).

import { sumNutrients } from "./nutrient-totals";
import { classifyEvidenceStrength } from "./kain-signal-evidence-strength";
import type { FoodEntryLite, ProteinAdherenceEvidence } from "./kain-signal-types";

export function detectProteinAdherence(input: {
  entriesByDay: Readonly<Record<string, readonly FoodEntryLite[]>>;
  completeDays: readonly string[];
  proteinTargetG: number | null;
}): ProteinAdherenceEvidence | null {
  if (input.proteinTargetG == null || input.proteinTargetG <= 0) return null;

  const daysEvaluated = input.completeDays.length;
  let daysAtOrAboveTarget = 0;
  for (const day of input.completeDays) {
    const dayEntries = input.entriesByDay[day] ?? [];
    const proteinTotal = sumNutrients(dayEntries).protein;
    if (proteinTotal >= input.proteinTargetG) daysAtOrAboveTarget += 1;
  }

  const evidenceStrength = classifyEvidenceStrength("protein_adherence", daysEvaluated);
  if (evidenceStrength === null) return null;

  return {
    insightType: "protein_adherence",
    daysEvaluated,
    daysAtOrAboveTarget,
    adherenceRate: daysEvaluated > 0 ? daysAtOrAboveTarget / daysEvaluated : 0,
    proteinTargetG: input.proteinTargetG,
    evidenceStrength,
  };
}
