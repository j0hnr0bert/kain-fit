// Guardrail causality-language test (2026-08-10 insight-quality upgrade,
// Phase 14). Proves checkCausalityLanguage catches an overclaimed causal
// sentence for EVERY insight type, not just the four new relational ones —
// this check runs unconditionally in evaluateSignalCopy, so a future copy
// edit anywhere in the pipeline can't reintroduce "X improves Y" language.

import { describe, it, expect } from "vitest";
import { evaluateSignalCopy } from "../kain-signal-guardrail";
import type {
  LoggingConsistencyEvidence,
  ProteinCalorieRelationshipEvidence,
} from "../kain-signal-types";
import type { SignalCardContent } from "../kain-signal-copy";

const relationalEvidence: ProteinCalorieRelationshipEvidence = {
  insightType: "protein_calorie_relationship",
  daysEvaluated: 12,
  lowerCalorieDayCount: 6,
  higherCalorieDayCount: 6,
  avgCaloriesLowerGroup: 1500,
  avgCaloriesHigherGroup: 2200,
  avgProteinLowerGroup: 90,
  avgProteinHigherGroup: 150,
  proteinGapG: 60,
  evidenceStrength: "early_signal",
};

const loggingEvidence: LoggingConsistencyEvidence = {
  insightType: "logging_consistency",
  windowDays: 60,
  activeDays: 22,
  consistencyRate: 22 / 60,
  currentStreak: 5,
  longestGapDays: 3,
  evidenceStrength: "strong_signal",
  direction: "positive",
};

function contentWith(takeaway: string): SignalCardContent {
  return {
    headline: "Headline.",
    observation: "Observation.",
    evidence: "Evidence.",
    whyItMatters: "Why it matters.",
    takeaway,
  };
}

describe("evaluateSignalCopy — universal causality-language check (Phase 14)", () => {
  it.each([
    "Saved meals improve your protein intake.",
    "Cutting calories causes your protein to drop.",
    "This happens because of your logging habits.",
    "Skipping breakfast leads to a bigger gap later.",
    "Logging earlier results in better adherence.",
    "This food makes you hit your target more often.",
  ])("rejects an overclaimed causal sentence: %s", (badSentence) => {
    const result = evaluateSignalCopy(relationalEvidence, contentWith(badSentence));
    expect(result.passes).toBe(false);
    if (!result.passes) {
      expect(result.reasons.join(" ")).toMatch(/causality/i);
    }
  });

  it("the check applies to logging_consistency too, not just the relational types", () => {
    const result = evaluateSignalCopy(
      loggingEvidence,
      contentWith("Logging every day improves your consistency."),
    );
    expect(result.passes).toBe(false);
  });

  it("passes causality-honest phrasing (tends to, associated with, shows up on)", () => {
    const result = evaluateSignalCopy(
      relationalEvidence,
      contentWith(
        "On lower-calorie days, cutting from lower-protein foods first would help close this gap.",
      ),
    );
    expect(result.passes).toBe(true);
  });
});
