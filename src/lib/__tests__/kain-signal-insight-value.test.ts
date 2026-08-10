import { describe, it, expect } from "vitest";
import {
  classifyActionability,
  classifyNovelty,
  insightValueMultiplier,
  passesInsightValueFloor,
} from "../kain-signal-insight-value";
import type { LoggingConsistencyEvidence, ProteinAdherenceEvidence } from "../kain-signal-types";

const baseProtein: ProteinAdherenceEvidence = {
  insightType: "protein_adherence",
  daysEvaluated: 8,
  daysAtOrAboveTarget: 5,
  adherenceRate: 0.625,
  proteinTargetG: 130,
  evidenceStrength: "clear_signal",
  averageGramsPerDay: 130,
  averageAttainmentPct: 100,
  medianAttainmentPct: 100,
  attainmentStdDevPct: 5,
  averageShortfallG: 0,
  consistency: "low_variance",
  direction: "positive",
  directionTier: "strong",
};

const loggingClear: LoggingConsistencyEvidence = {
  insightType: "logging_consistency",
  windowDays: 60,
  activeDays: 14,
  consistencyRate: 14 / 60,
  currentStreak: 5,
  longestGapDays: 3,
  evidenceStrength: "clear_signal",
  direction: "positive",
};

describe("classifyNovelty", () => {
  it("protein_adherence near-miss (positive, adherenceRate<0.5) is high novelty — the hidden near-miss", () => {
    const nearMiss: ProteinAdherenceEvidence = { ...baseProtein, adherenceRate: 0.2 };
    expect(classifyNovelty(nearMiss)).toBe("high");
  });

  it("protein_adherence otherwise is medium novelty", () => {
    expect(classifyNovelty(baseProtein)).toBe("medium");
  });

  it("logging_consistency is low novelty — a plain count/streak", () => {
    expect(classifyNovelty(loggingClear)).toBe("low");
  });
});

describe("classifyActionability", () => {
  it("protein_adherence negative direction is high actionability — a gram-specific action exists", () => {
    const negative: ProteinAdherenceEvidence = {
      ...baseProtein,
      direction: "negative",
      directionTier: "strong",
      averageAttainmentPct: 65,
      averageShortfallG: 45,
    };
    expect(classifyActionability(negative)).toBe("high");
  });

  it("logging_consistency is low actionability — nothing concrete to change", () => {
    expect(classifyActionability(loggingClear)).toBe("low");
  });
});

describe("insightValueMultiplier", () => {
  it("a low-novelty, low-actionability type scores well below 1.0x", () => {
    expect(insightValueMultiplier(loggingClear)).toBeLessThan(1.0);
  });

  it("a high-novelty, high-actionability negative protein_adherence case scores well above 1.0x", () => {
    const negative: ProteinAdherenceEvidence = {
      ...baseProtein,
      direction: "negative",
      directionTier: "strong",
      averageAttainmentPct: 65,
    };
    expect(insightValueMultiplier(negative)).toBeGreaterThan(1.0);
  });
});

describe("passesInsightValueFloor — Phase 12 'don't force a signal'", () => {
  it("a low-novelty candidate below strong_signal fails the floor", () => {
    expect(passesInsightValueFloor(loggingClear)).toBe(false);
  });

  it("a low-novelty candidate at strong_signal passes — genuinely substantial, even if plain", () => {
    expect(passesInsightValueFloor({ ...loggingClear, evidenceStrength: "strong_signal" })).toBe(
      true,
    );
  });

  it("medium/high-novelty candidates always pass, regardless of evidence strength tier", () => {
    expect(passesInsightValueFloor({ ...baseProtein, evidenceStrength: "early_signal" })).toBe(
      true,
    );
  });
});
