// Change-triggered persistence for KainSignal's selected insight — the
// After-Meal Re-Evaluation piece of the v2 doctrine. Recomputation is cheap
// and safe to run on every load/meal-save (see kain-signal.functions.ts and
// kain-signal-generate.server.ts), but writing a new kain_signal_insights
// row on every recomputation would make the "why was this shown" audit
// trail noisy and flicker the UI on insignificant numeric drift. This
// module decides, from two evidence snapshots, whether the difference is
// worth a new persisted row and a possible on-screen change — always from
// the exact fields that drive kain-signal-copy.ts's rendered strings, never
// from a fuzzy "materially stronger" heuristic.
//
// Worked examples (used verbatim in the test suite):
//   (a) same category, identical evidence -> not material (no write)
//   (b) same category, a copy-driving field changed -> material
//   (c) category changed (protein -> logging) -> material
//   (d) previously had a selected insight, now none -> material
//   (e) previously none, now a selected insight -> material
//   (f) both null (no signal before, no signal now) -> not material

import type { InsightEvidence, InsightType } from "./kain-signal-types";

export type SignalSelection = { insightType: InsightType; evidence: InsightEvidence } | null;

// Only the fields kain-signal-copy.ts actually reads are compared — a field
// that isn't rendered can't be visible to the user, so its drift must not
// trigger a write either. adherenceRate is compared as its rendered
// rounded percentage, not the raw float, for the same reason (two rates
// that round to the same percentage render identical copy).
function copyDrivingFacts(evidence: InsightEvidence): Record<string, number | string> {
  if (evidence.insightType === "protein_adherence") {
    return {
      daysEvaluated: evidence.daysEvaluated,
      daysAtOrAboveTarget: evidence.daysAtOrAboveTarget,
      proteinTargetG: evidence.proteinTargetG,
      adherencePct: Math.round(evidence.adherenceRate * 100),
      evidenceStrength: evidence.evidenceStrength,
    };
  }
  if (evidence.insightType === "logging_consistency") {
    return {
      windowDays: evidence.windowDays,
      activeDays: evidence.activeDays,
      currentStreak: evidence.currentStreak,
      evidenceStrength: evidence.evidenceStrength,
    };
  }
  // behavior_milestone: identity is milestoneType+threshold (never the same
  // pair twice — see kain-signal-detector-milestone.ts's dedup), so any two
  // milestone evidence objects that reach this comparison at all are
  // already guaranteed to differ on at least one of these fields.
  return {
    milestoneType: evidence.milestoneType,
    threshold: evidence.threshold,
    observedValue: evidence.observedValue,
  };
}

export function isMaterialChange(previous: SignalSelection, next: SignalSelection): boolean {
  if (previous === null && next === null) return false;
  if (previous === null || next === null) return true;
  if (previous.insightType !== next.insightType) return true;

  const prevFacts = copyDrivingFacts(previous.evidence);
  const nextFacts = copyDrivingFacts(next.evidence);
  const keys = new Set([...Object.keys(prevFacts), ...Object.keys(nextFacts)]);
  for (const key of keys) {
    if (prevFacts[key] !== nextFacts[key]) return true;
  }
  return false;
}
