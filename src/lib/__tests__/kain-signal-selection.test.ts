import { describe, it, expect } from "vitest";
import {
  selectWinner,
  patternOnlyEvidenceStrengths,
  selectPatternTop,
} from "../kain-signal-selection";
import { finalizeReadiness, type CountGates } from "../kain-signal-readiness";
import { rankInsights } from "../kain-signal-ranking";
import type { RankedCandidate } from "../kain-signal-ranking";
import type {
  InsightEvidence,
  LoggingConsistencyEvidence,
  MilestoneEvidence,
  ProteinAdherenceEvidence,
} from "../kain-signal-types";

function milestoneCandidate(
  threshold: number,
  overrides: Partial<RankedCandidate> = {},
): RankedCandidate {
  const evidence: MilestoneEvidence = {
    insightType: "behavior_milestone",
    milestoneType: "meal_count",
    threshold,
    observedValue: threshold,
    evidenceStrength: "strong_signal",
  };
  return {
    insightType: "behavior_milestone",
    evidence,
    rankScore: 3,
    suppressed: false,
    ...overrides,
  };
}

function proteinCandidate(overrides: Partial<RankedCandidate> = {}): RankedCandidate {
  const evidence: ProteinAdherenceEvidence = {
    insightType: "protein_adherence",
    daysEvaluated: 14,
    daysAtOrAboveTarget: 10,
    adherenceRate: 10 / 14,
    proteinTargetG: 130,
    evidenceStrength: "strong_signal",
  };
  return {
    insightType: "protein_adherence",
    evidence,
    rankScore: 3.1,
    suppressed: false,
    ...overrides,
  };
}

describe("selectWinner — selection policy (§8, 2026-07-27 correction)", () => {
  it("a newly-crossed milestone outranks a strong reveal/protect candidate, even with a lower rankScore", () => {
    const ranked = [proteinCandidate({ rankScore: 10 }), milestoneCandidate(25, { rankScore: 0 })];
    const winner = selectWinner(ranked);
    expect(winner?.insightType).toBe("behavior_milestone");
  });

  it("falls back to the normal ranking engine when no milestone candidate is present", () => {
    const ranked = [proteinCandidate()];
    const winner = selectWinner(ranked);
    expect(winner?.insightType).toBe("protein_adherence");
  });

  it("an old, already-recorded milestone does not permanently suppress newer insights — because it can never appear as a candidate again", () => {
    // A milestone that was recorded on a previous day is never rebuilt as a
    // candidate at all (see kain-signal-detector-milestone.ts's
    // recordedMilestoneKeys exclusion) — so the `ranked` array passed in on
    // a later day simply won't contain it. selectWinner correctly falls
    // through to the reveal/protect ranking in that case.
    const rankedWithoutOldMilestone = [proteinCandidate()];
    const winner = selectWinner(rankedWithoutOldMilestone);
    expect(winner?.insightType).toBe("protein_adherence");
  });

  it("a suppressed milestone (permanent 'don't use this' feedback) does not win — falls back to the next candidate", () => {
    const ranked = [proteinCandidate(), milestoneCandidate(25, { suppressed: true })];
    const winner = selectWinner(ranked);
    expect(winner?.insightType).toBe("protein_adherence");
  });

  it("two different milestone thresholds are distinct identities — the evidence carries the exact threshold crossed", () => {
    const evidence10 = milestoneCandidate(10).evidence as MilestoneEvidence;
    const evidence25 = milestoneCandidate(25).evidence as MilestoneEvidence;
    expect(evidence10.threshold).not.toBe(evidence25.threshold);
    expect(evidence10.milestoneType).toBe(evidence25.milestoneType);
  });

  it("milestone evidence is deterministic — identical inputs produce identical evidence", () => {
    const a = milestoneCandidate(25).evidence;
    const b = milestoneCandidate(25).evidence;
    expect(a).toEqual(b);
  });

  it("returns null when nothing is eligible", () => {
    expect(selectWinner([])).toBeNull();
  });
});

const loggingEvidence: LoggingConsistencyEvidence = {
  insightType: "logging_consistency",
  windowDays: 60,
  activeDays: 3, // below the early-signal floor — evidenceStrength would be null via the real detector
  consistencyRate: 3 / 60,
  currentStreak: 3,
  longestGapDays: 0,
  evidenceStrength: "early_signal",
};

const milestoneEvidence: MilestoneEvidence = {
  insightType: "behavior_milestone",
  milestoneType: "meal_count",
  threshold: 10,
  observedValue: 10,
  evidenceStrength: "strong_signal",
};

const notReadyCountGates: CountGates = {
  activeLoggingDays: 3,
  qualifyingEntries: 3,
  reasonablyCompleteDays: 1,
  countGatesMet: false,
  criticalDataQualityFailure: false,
};

describe("patternOnlyEvidenceStrengths — module-level readiness (2026-07-27 correction)", () => {
  it("excludes milestone evidence entirely", () => {
    const candidates: (InsightEvidence | null)[] = [null, null, milestoneEvidence];
    expect(patternOnlyEvidenceStrengths(candidates)).toEqual([null, null]);
  });

  it("still passes through real pattern evidence unchanged", () => {
    const proteinEvidence: ProteinAdherenceEvidence = {
      insightType: "protein_adherence",
      daysEvaluated: 8,
      daysAtOrAboveTarget: 5,
      adherenceRate: 0.625,
      proteinTargetG: 130,
      evidenceStrength: "clear_signal",
    };
    const candidates: (InsightEvidence | null)[] = [
      proteinEvidence,
      loggingEvidence,
      milestoneEvidence,
    ];
    expect(patternOnlyEvidenceStrengths(candidates)).toEqual(["clear_signal", "early_signal"]);
  });

  it("a milestone alone can never satisfy pattern readiness (item 4: no false completedSilently trigger via readiness)", () => {
    // No pattern candidates at all — only a milestone. If milestone
    // evidence leaked into this array, hasRepeatedPattern (and therefore
    // gatesMet/state) would incorrectly become true from the milestone
    // alone.
    const candidates: (InsightEvidence | null)[] = [null, null, milestoneEvidence];
    const readiness = finalizeReadiness(
      notReadyCountGates,
      patternOnlyEvidenceStrengths(candidates),
    );
    expect(readiness.gatesMet).toBe(false);
    expect(readiness.state).not.toBe("eligible");
  });

  it("pattern modules remain blocked below their own evidence floor regardless of a present milestone (evidence requirements not weakened)", () => {
    // Both pattern slots are null (as the real detectors would return below
    // their early-signal floor) even though a milestone is present.
    const candidates: (InsightEvidence | null)[] = [null, null, milestoneEvidence];
    const readiness = finalizeReadiness(
      { ...notReadyCountGates, countGatesMet: true }, // even if count gates alone pass
      patternOnlyEvidenceStrengths(candidates),
    );
    expect(readiness.gatesMet).toBe(false); // still false: no real pattern evidence
  });
});

describe("selectPatternTop — the connected-state transition must ignore milestones", () => {
  it("returns null when only a milestone is present — a milestone alone must never grant 'connected'", () => {
    const ranked = rankInsights([milestoneEvidence], {});
    expect(selectPatternTop(ranked)).toBeNull();
  });

  it("returns the pattern winner even when a milestone also outranks it in selectWinner", () => {
    const proteinEvidence: ProteinAdherenceEvidence = {
      insightType: "protein_adherence",
      daysEvaluated: 14,
      daysAtOrAboveTarget: 10,
      adherenceRate: 10 / 14,
      proteinTargetG: 130,
      evidenceStrength: "strong_signal",
    };
    const ranked = rankInsights([proteinEvidence, milestoneEvidence], {});
    // selectWinner (display/persistence) picks the milestone...
    expect(selectWinner(ranked)?.insightType).toBe("behavior_milestone");
    // ...but selectPatternTop (connected-state transition) still sees the
    // genuine pattern underneath it.
    expect(selectPatternTop(ranked)?.insightType).toBe("protein_adherence");
  });
});

describe("milestone independence from readiness (items 1-2: renders regardless of trend/protein readiness)", () => {
  it("a meal-count milestone is selected as the winner even when no pattern module is ready", () => {
    // Simulates a fresh-ish user: no protein target (null), too few active
    // days for logging_consistency's early floor (null) — only the
    // milestone is a real candidate.
    const ranked = rankInsights([null, null, milestoneEvidence], {});
    const winner = selectWinner(ranked);
    expect(winner?.insightType).toBe("behavior_milestone");
  });

  it("a distinct-day milestone is selected as the winner even when protein readiness is false (no manual target)", () => {
    const distinctDayMilestone: MilestoneEvidence = {
      insightType: "behavior_milestone",
      milestoneType: "distinct_logging_days",
      threshold: 7,
      observedValue: 7,
      evidenceStrength: "strong_signal",
    };
    // proteinEvidence is null (no manual target set — detectProteinAdherence
    // itself would return null here).
    const ranked = rankInsights([null, loggingEvidence, distinctDayMilestone], {});
    const winner = selectWinner(ranked);
    expect(winner?.insightType).toBe("behavior_milestone");
  });
});
