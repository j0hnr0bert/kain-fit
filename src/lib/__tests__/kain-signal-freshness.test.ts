import { describe, it, expect } from "vitest";
import { isMaterialChange, type SignalSelection } from "../kain-signal-freshness";
import type { LoggingConsistencyEvidence, ProteinAdherenceEvidence } from "../kain-signal-types";

const proteinEvidence: ProteinAdherenceEvidence = {
  insightType: "protein_adherence",
  daysEvaluated: 8,
  daysAtOrAboveTarget: 5,
  adherenceRate: 0.625,
  proteinTargetG: 130,
  evidenceStrength: "clear_signal",
};

const loggingEvidence: LoggingConsistencyEvidence = {
  insightType: "logging_consistency",
  windowDays: 60,
  activeDays: 22,
  consistencyRate: 22 / 60,
  currentStreak: 5,
  longestGapDays: 3,
  evidenceStrength: "strong_signal",
};

const proteinSelection: SignalSelection = {
  insightType: "protein_adherence",
  evidence: proteinEvidence,
};

describe("isMaterialChange", () => {
  it("(a) same category, identical evidence -> not material", () => {
    expect(isMaterialChange(proteinSelection, { ...proteinSelection })).toBe(false);
  });

  it("(b) same category, a copy-driving field changed -> material", () => {
    const next: SignalSelection = {
      insightType: "protein_adherence",
      evidence: { ...proteinEvidence, daysAtOrAboveTarget: 6, adherenceRate: 0.75 },
    };
    expect(isMaterialChange(proteinSelection, next)).toBe(true);
  });

  it("(c) category changed (protein -> logging) -> material", () => {
    const next: SignalSelection = { insightType: "logging_consistency", evidence: loggingEvidence };
    expect(isMaterialChange(proteinSelection, next)).toBe(true);
  });

  it("(d) previously had a selected insight, now none -> material", () => {
    expect(isMaterialChange(proteinSelection, null)).toBe(true);
  });

  it("(e) previously none, now a selected insight -> material", () => {
    expect(isMaterialChange(null, proteinSelection)).toBe(true);
  });

  it("(f) both null (no signal before, no signal now) -> not material", () => {
    expect(isMaterialChange(null, null)).toBe(false);
  });

  it("raw adherenceRate drift that still rounds to the same displayed percentage is not material", () => {
    const next: SignalSelection = {
      insightType: "protein_adherence",
      evidence: { ...proteinEvidence, adherenceRate: 0.626 }, // still rounds to 63%, same as 0.625
    };
    expect(isMaterialChange(proteinSelection, next)).toBe(false);
  });

  it("longestGapDays changing alone (not a copy-driving field for logging_consistency) is not material", () => {
    const base: SignalSelection = { insightType: "logging_consistency", evidence: loggingEvidence };
    const next: SignalSelection = {
      insightType: "logging_consistency",
      evidence: { ...loggingEvidence, longestGapDays: 10 },
    };
    expect(isMaterialChange(base, next)).toBe(false);
  });
});
