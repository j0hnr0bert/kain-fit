import { describe, it, expect } from "vitest";
import { rankInsights, selectTopInsight } from "../kain-signal-ranking";
import type { LoggingConsistencyEvidence, ProteinAdherenceEvidence } from "../kain-signal-types";

function proteinClear(): ProteinAdherenceEvidence {
  return {
    insightType: "protein_adherence",
    daysEvaluated: 8,
    daysAtOrAboveTarget: 5,
    adherenceRate: 0.625,
    proteinTargetG: 130,
    evidenceStrength: "clear_signal",
  };
}
function loggingClear(): LoggingConsistencyEvidence {
  return {
    insightType: "logging_consistency",
    windowDays: 60,
    activeDays: 14,
    consistencyRate: 14 / 60,
    currentStreak: 5,
    longestGapDays: 3,
    evidenceStrength: "clear_signal",
  };
}
function loggingStrong(): LoggingConsistencyEvidence {
  return { ...loggingClear(), activeDays: 22, evidenceStrength: "strong_signal" };
}

const noFeedback = {};

describe("rankInsights / selectTopInsight", () => {
  it("(a) exact tie on evidence strength is resolved by the type tiebreak — protein wins 2.1 vs 2.0", () => {
    const ranked = rankInsights([proteinClear(), loggingClear()], noFeedback);
    expect(ranked[0].insightType).toBe("protein_adherence");
    expect(ranked[0].rankScore).toBeCloseTo(2.1, 5);
    expect(ranked[1].rankScore).toBeCloseTo(2.0, 5);

    const top = selectTopInsight(ranked);
    expect(top?.insightType).toBe("protein_adherence");
  });

  it("(b) permanent 'dont_use_this' excludes that type entirely — logging wins alone", () => {
    const ranked = rankInsights([proteinClear(), loggingStrong()], {
      protein_adherence: { notQuiteCount: 0, dontUseThisEver: true },
    });
    const proteinCandidate = ranked.find((c) => c.insightType === "protein_adherence");
    expect(proteinCandidate?.suppressed).toBe(true);

    const top = selectTopInsight(ranked);
    expect(top?.insightType).toBe("logging_consistency");
  });

  it("(c) accumulated 'not_quite' feedback can flip the winner: two on a strong_signal zero it out, letting a clear_signal win", () => {
    const ranked = rankInsights([proteinClear(), loggingStrong()], {
      logging_consistency: { notQuiteCount: 2, dontUseThisEver: false },
    });
    const logging = ranked.find((c) => c.insightType === "logging_consistency");
    const protein = ranked.find((c) => c.insightType === "protein_adherence");
    expect(logging?.rankScore).toBeCloseTo(0, 5); // 3.0 - 1.5*2
    expect(protein?.rankScore).toBeCloseTo(2.1, 5);

    const top = selectTopInsight(ranked);
    expect(top?.insightType).toBe("protein_adherence");
  });

  it("no candidates at all -> selectTopInsight returns null (the valid silence state)", () => {
    expect(selectTopInsight(rankInsights([null, null], noFeedback))).toBeNull();
  });

  it("both candidates suppressed -> selectTopInsight returns null even though evidence exists", () => {
    const ranked = rankInsights([proteinClear(), loggingStrong()], {
      protein_adherence: { notQuiteCount: 0, dontUseThisEver: true },
      logging_consistency: { notQuiteCount: 0, dontUseThisEver: true },
    });
    expect(selectTopInsight(ranked)).toBeNull();
  });
});
