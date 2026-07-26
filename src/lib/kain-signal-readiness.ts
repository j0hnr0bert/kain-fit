// Readiness = hard gates (must all pass) + a composite score used only to
// pick a categorical progress label while the user is still in the
// "building" state. Split into two passes — computeCountGates (pure
// counting over entries) and finalizeReadiness (folds in whether either
// detector actually found a pattern) — so the "at least one repeated
// behavioral pattern" gate, which depends on detector output, doesn't
// create a circular dependency between this module and the detectors.
//
// The "repeated pattern" gate is satisfied by either Phase-1 detector
// producing any non-null evidence strength — deliberately not a third,
// invented pattern-detection heuristic; Phase 1's only two patterns are the
// two doctrine-approved detectors.

import { computeDaysCompleteness } from "./kain-signal-day-completeness";
import { classifyEntryConfidence } from "./kain-signal-confidence";
import { manilaDay } from "./retention";
import {
  CRITICAL_LOW_TRUST_SHARE_MAX,
  MIN_ACTIVE_LOGGING_DAYS,
  MIN_QUALIFYING_ENTRIES,
  MIN_REASONABLY_COMPLETE_DAYS,
  PROGRESS_LABEL_BANDS,
} from "./kain-signal-config";
import type { EvidenceStrength, FoodEntryLite, SignalState } from "./kain-signal-types";

export type CountGates = {
  activeLoggingDays: number;
  qualifyingEntries: number;
  reasonablyCompleteDays: number;
  countGatesMet: boolean;
  criticalDataQualityFailure: boolean;
};

export function computeCountGates(entries: readonly FoodEntryLite[]): CountGates {
  const activeLoggingDays = new Set(entries.map((e) => manilaDay(e.logged_at))).size;

  const lowTrustCount = entries.filter((e) => classifyEntryConfidence(e) === "low_trust").length;
  const qualifyingEntries = entries.length - lowTrustCount;
  const lowTrustShare = entries.length > 0 ? lowTrustCount / entries.length : 0;
  const criticalDataQualityFailure = lowTrustShare > CRITICAL_LOW_TRUST_SHARE_MAX;

  const reasonablyCompleteDays = Object.values(computeDaysCompleteness(entries)).filter(
    (d) => d.isReasonablyComplete,
  ).length;

  const countGatesMet =
    activeLoggingDays >= MIN_ACTIVE_LOGGING_DAYS &&
    qualifyingEntries >= MIN_QUALIFYING_ENTRIES &&
    reasonablyCompleteDays >= MIN_REASONABLY_COMPLETE_DAYS &&
    !criticalDataQualityFailure;

  return {
    activeLoggingDays,
    qualifyingEntries,
    reasonablyCompleteDays,
    countGatesMet,
    criticalDataQualityFailure,
  };
}

export type ProgressLabel = "starting" | "taking_shape" | "nearly_ready";

export type ReadinessResult = {
  gateResults: CountGates;
  gatesMet: boolean;
  compositeScore: number;
  progressLabel: ProgressLabel | null;
  // Only 'no_data' | 'building' | 'eligible' — 'connected' is decided by
  // the server orchestration layer (kain-signal-generate.server.ts) after
  // ranking confirms a genuinely useful insight exists, and by the
  // monotonic-state carry-forward rule for users who were already
  // connected before a weaker day.
  state: Exclude<SignalState, "connected">;
};

function labelForScore(score: number): ProgressLabel {
  if (score >= PROGRESS_LABEL_BANDS.nearly_ready[0]) return "nearly_ready";
  if (score >= PROGRESS_LABEL_BANDS.taking_shape[0]) return "taking_shape";
  return "starting";
}

export function finalizeReadiness(
  countGates: CountGates,
  detectorStrengths: readonly (EvidenceStrength | null)[],
): ReadinessResult {
  const hasRepeatedPattern = detectorStrengths.some((s) => s !== null);
  const gatesMet = countGates.countGatesMet && hasRepeatedPattern;

  const activeDaysRatio = Math.min(1, countGates.activeLoggingDays / MIN_ACTIVE_LOGGING_DAYS);
  const entriesRatio = Math.min(1, countGates.qualifyingEntries / MIN_QUALIFYING_ENTRIES);
  const completeDaysRatio = Math.min(
    1,
    countGates.reasonablyCompleteDays / MIN_REASONABLY_COMPLETE_DAYS,
  );
  const patternRatio = hasRepeatedPattern ? 1 : 0;
  const compositeScore = Math.round(
    100 * ((activeDaysRatio + entriesRatio + completeDaysRatio + patternRatio) / 4),
  );

  if (gatesMet) {
    return {
      gateResults: countGates,
      gatesMet,
      compositeScore,
      progressLabel: null,
      state: "eligible",
    };
  }
  const hasAnyActivity = countGates.activeLoggingDays > 0;
  if (!hasAnyActivity) {
    return {
      gateResults: countGates,
      gatesMet,
      compositeScore: 0,
      progressLabel: null,
      state: "no_data",
    };
  }
  return {
    gateResults: countGates,
    gatesMet,
    compositeScore,
    progressLabel: labelForScore(compositeScore),
    state: "building",
  };
}
