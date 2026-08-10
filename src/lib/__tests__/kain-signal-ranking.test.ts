import { describe, it, expect } from "vitest";
import { rankInsights, selectTopInsight } from "../kain-signal-ranking";
import type {
  LoggingConsistencyEvidence,
  ProteinAdherenceEvidence,
  TrendShiftEvidence,
  WeekdayWeekendPatternEvidence,
} from "../kain-signal-types";

function proteinClear(): ProteinAdherenceEvidence {
  return {
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
    direction: "positive",
  };
}
function loggingStrong(): LoggingConsistencyEvidence {
  return { ...loggingClear(), activeDays: 22, evidenceStrength: "strong_signal" };
}

const noFeedback = {};

describe("rankInsights / selectTopInsight", () => {
  // 2026-08-10 insight-quality upgrade: protein_adherence (novelty=medium,
  // actionability=medium -> 1.0x multiplier here, since this fixture's
  // direction is positive and adherenceRate is >=0.5) and logging_
  // consistency (novelty=low, actionability=low -> 0.48x multiplier) no
  // longer land close enough to need the tiebreak at all — protein now
  // wins decisively because it IS the more valuable insight, not just via
  // an arbitrary type-priority nudge. See the dedicated tiebreak-isolation
  // test below for a case where the multiplier is actually equal.
  it("(a) protein's higher insight-value multiplier now dominates a same-evidence-strength comparison", () => {
    const ranked = rankInsights([proteinClear(), loggingClear()], noFeedback);
    expect(ranked[0].insightType).toBe("protein_adherence");
    expect(ranked[0].rankScore).toBeCloseTo(2 * 1.0 + 0.1, 5); // 2.1
    expect(ranked[1].rankScore).toBeCloseTo(2 * 0.48, 5); // 0.96

    const top = selectTopInsight(ranked);
    expect(top?.insightType).toBe("protein_adherence");
  });

  it("tiebreak isolation: two candidates with an EQUAL insight-value multiplier and equal evidence strength are resolved purely by INSIGHT_TYPE_PRIORITY_TIEBREAK", () => {
    // weekday_weekend_pattern and trend_shift both carry the same
    // (high novelty x medium actionability = 1.5x) multiplier — see
    // kain-signal-insight-value.ts — so at equal evidenceStrength their
    // rankScores are identical except for the type tiebreak, which is 0
    // for both today (2026-08-10: neither has an assigned preference —
    // see kain-signal-config.ts). This test documents that a genuine tie
    // is possible and stable-sorts deterministically rather than that one
    // specific type wins.
    const weekend: WeekdayWeekendPatternEvidence = {
      insightType: "weekday_weekend_pattern",
      weekdayCount: 10,
      weekendCount: 6,
      avgCaloriesWeekday: 1900,
      avgCaloriesWeekend: 1950,
      avgProteinWeekday: 140,
      avgProteinWeekend: 115,
      calorieDiffPct: 2.6,
      proteinDiffG: -25,
      evidenceStrength: "clear_signal",
    };
    const trend: TrendShiftEvidence = {
      insightType: "trend_shift",
      recentWindowDays: 5,
      priorWindowDays: 5,
      avgAttainmentPctRecent: 91,
      avgAttainmentPctPrior: 78,
      deltaPct: 13,
      direction: "positive",
      proteinTargetG: 150,
      evidenceStrength: "clear_signal",
    };
    const ranked = rankInsights([weekend, trend], noFeedback);
    expect(ranked[0].rankScore).toBeCloseTo(ranked[1].rankScore, 5);
    expect(ranked[0].rankScore).toBeCloseTo(2 * 1.5, 5); // 3.0
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

  it("(c) accumulated 'not_quite' feedback can flip the winner: enough penalty drags a strong_signal below a clear_signal", () => {
    const ranked = rankInsights([proteinClear(), loggingStrong()], {
      logging_consistency: { notQuiteCount: 2, dontUseThisEver: false },
    });
    const logging = ranked.find((c) => c.insightType === "logging_consistency");
    const protein = ranked.find((c) => c.insightType === "protein_adherence");
    expect(logging?.rankScore).toBeCloseTo(3 * 0.48 - 1.5 * 2, 5); // 1.44 - 3.0 = -1.56
    expect(protein?.rankScore).toBeCloseTo(2.1, 5);

    const top = selectTopInsight(ranked);
    expect(top?.insightType).toBe("protein_adherence");
  });

  it("insight-value multiplier can flip a sample-size-only comparison: a high-novelty early_signal beats a low-novelty strong_signal", () => {
    // protein_calorie_relationship: novelty=high, actionability=high ->
    // 1.5 * 1.3 = 1.95x. At early_signal (base 1): 1 * 1.95 = 1.95.
    // logging_consistency: novelty=low, actionability=low -> 0.6 * 0.8 =
    // 0.48x. At strong_signal (base 3): 3 * 0.48 = 1.44. The relational
    // candidate wins despite far less raw sample-size evidence — this is
    // the literal "do NOT let sample size alone dominate" requirement.
    const relational = {
      insightType: "protein_calorie_relationship" as const,
      daysEvaluated: 12,
      lowerCalorieDayCount: 6,
      higherCalorieDayCount: 6,
      avgCaloriesLowerGroup: 1500,
      avgCaloriesHigherGroup: 2100,
      avgProteinLowerGroup: 95,
      avgProteinHigherGroup: 140,
      proteinGapG: 45,
      evidenceStrength: "early_signal" as const,
    };
    const ranked = rankInsights([relational, loggingStrong()], noFeedback);
    expect(ranked[0].insightType).toBe("protein_calorie_relationship");
    expect(ranked[0].rankScore).toBeGreaterThan(ranked[1].rankScore);
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
