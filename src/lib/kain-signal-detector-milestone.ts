// Milestone detector — the third KainSignal category, and the only one
// keyed on lifetime counts rather than a rolling window. A milestone is a
// certain fact ("you've crossed N"), not a confidence-graded pattern, so
// its qualification rule is different in kind from protein_adherence's or
// logging_consistency's: not "is there enough recent evidence," but "has
// this exact threshold been crossed, and has it never been recorded
// before."
//
// Crossing rule (2026-07-27 hardening pass): a threshold is "newly
// crossed" exactly when it is currently reached (lifetimeValue >=
// threshold) AND it has never been recorded before (excluded from
// recordedMilestoneKeys — built in kain-signal-generate.server.ts from
// every kain_signal_insights row this user has EVER had with
// insight_type='behavior_milestone', across all days). This is
// operationally equivalent to `previousValue < threshold <= currentValue`
// without needing a separately persisted watermark: recordedMilestoneKeys
// IS the permanent record of every threshold whose crossing has already
// been observed, so "not yet recorded" already means "previousValue never
// reached this threshold as far as this pipeline has ever checked."
//
// Bootstrap / multi-threshold policy (one mechanism handles both): when a
// single call finds MULTIPLE not-yet-recorded-but-crossed thresholds for
// the same type — whether because this is a brand-new user whose history
// already exceeds several thresholds (bootstrap), or because one mutation
// pushed the count past more than one threshold at once — only the
// highest is surfaced (shown to the user, eligible to be selected); every
// other newly-crossed threshold is returned as `completedSilently` and
// must be recorded in the SAME database write as a non-selectable,
// non-surfaced row (see kain-signal-generate.server.ts). This is what
// prevents the drip-feed bug: a threshold is only ever "eligible to
// surface" on the one call where it's part of the newly-crossed set: if it
// isn't the highest that call, it's completed immediately, not left
// pending for a future call to pick up.
//
// Cross-type priority: raw threshold numbers are never compared across
// milestone types (a 30-distinct-day milestone and a 50-meal milestone are
// different units — "largest number wins" is meaningless between them).
// MILESTONE_TYPE_PRIORITY is the explicit, documented, stable tie-break:
// meal_count outranks distinct_logging_days when both have a newly-crossed
// candidate in the same call. Within the same type, the higher threshold
// wins (it represents more accumulated history).
//
// Worked examples (used verbatim in the test suite):
//   24 -> 25 meals (25 not yet recorded, 10 already recorded) -> surfaces
//     meal_count:25, completedSilently=[].
//   25 -> 26 meals (25 already recorded) -> surfaces null (nothing newly
//     crossed).
//   9 -> 26 meals in one jump (nothing recorded yet) -> surfaces
//     meal_count:25, completedSilently=[meal_count:10] (never shown later).
//   existing user first seen at 63 meals (nothing recorded yet) ->
//     surfaces meal_count:50, completedSilently=[meal_count:10,
//     meal_count:25] — a one-time bootstrap emission, not a cascade.

import {
  DISTINCT_DAY_MILESTONE_THRESHOLDS,
  MEAL_COUNT_MILESTONE_THRESHOLDS,
} from "./kain-signal-config";
import type { MilestoneEvidence, MilestoneType } from "./kain-signal-types";

export function milestoneKey(milestoneType: MilestoneType, threshold: number): string {
  return `${milestoneType}:${threshold}`;
}

// Explicit, documented, stable cross-type ordering — never inferred from
// raw threshold magnitude. meal_count is the more frequently-updating,
// primary lifetime signal, so it takes priority when both types have a
// newly-crossed candidate in the same call.
export const MILESTONE_TYPE_PRIORITY: Record<MilestoneType, number> = {
  meal_count: 0,
  distinct_logging_days: 1,
};

export type MilestoneCompletion = {
  milestoneType: MilestoneType;
  threshold: number;
  observedValue: number;
};

export type MilestoneDetectionResult = {
  /** The single milestone (if any) eligible to be shown/selected this
   * call — the highest-priority newly-crossed threshold. */
  surfaced: MilestoneEvidence | null;
  /** Every OTHER newly-crossed threshold this same call — must be recorded
   * immediately (is_selected=false, never surfaced) so they can never
   * drip-feed across future calls. */
  completedSilently: MilestoneCompletion[];
};

function collectNewlyCrossed(input: {
  lifetimeMealCount: number;
  lifetimeDistinctLoggingDays: number;
  recordedMilestoneKeys: ReadonlySet<string>;
}): MilestoneCompletion[] {
  const candidates: MilestoneCompletion[] = [];
  for (const threshold of MEAL_COUNT_MILESTONE_THRESHOLDS) {
    if (
      input.lifetimeMealCount >= threshold &&
      !input.recordedMilestoneKeys.has(milestoneKey("meal_count", threshold))
    ) {
      candidates.push({
        milestoneType: "meal_count",
        threshold,
        observedValue: input.lifetimeMealCount,
      });
    }
  }
  for (const threshold of DISTINCT_DAY_MILESTONE_THRESHOLDS) {
    if (
      input.lifetimeDistinctLoggingDays >= threshold &&
      !input.recordedMilestoneKeys.has(milestoneKey("distinct_logging_days", threshold))
    ) {
      candidates.push({
        milestoneType: "distinct_logging_days",
        threshold,
        observedValue: input.lifetimeDistinctLoggingDays,
      });
    }
  }
  return candidates;
}

export function detectBehaviorMilestone(input: {
  lifetimeMealCount: number;
  lifetimeDistinctLoggingDays: number;
  recordedMilestoneKeys: ReadonlySet<string>;
}): MilestoneDetectionResult {
  const candidates = collectNewlyCrossed(input);
  if (candidates.length === 0) return { surfaced: null, completedSilently: [] };

  const sorted = [...candidates].sort((a, b) => {
    const typeDiff =
      MILESTONE_TYPE_PRIORITY[a.milestoneType] - MILESTONE_TYPE_PRIORITY[b.milestoneType];
    if (typeDiff !== 0) return typeDiff;
    return b.threshold - a.threshold;
  });
  const [top, ...rest] = sorted;

  return {
    surfaced: {
      insightType: "behavior_milestone",
      milestoneType: top.milestoneType,
      threshold: top.threshold,
      observedValue: top.observedValue,
      // A crossed threshold is a certain fact, not a graded confidence —
      // "strong_signal" is used only to satisfy the shared evidence-
      // strength type/DB CHECK, not as a variable strength judgment.
      evidenceStrength: "strong_signal",
    },
    completedSilently: rest,
  };
}
