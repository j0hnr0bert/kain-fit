// Copy tests for the four new relational insight types (2026-08-10
// insight-quality upgrade). Covers: correct evidence-driven numbers,
// causality-honest phrasing (Phase 14), the same-day boundary (Phase 15),
// and the evidence-boundary rule (never a claim the underlying food-log
// data can't prove) already enforced for protein_adherence.

import { describe, it, expect } from "vitest";
import {
  proteinCalorieRelationshipCopy,
  proteinMealPositionCopy,
  weekdayWeekendPatternCopy,
  trendShiftCopy,
  type SignalCardContent,
} from "../kain-signal-copy";
import { evaluateSignalCopy } from "../kain-signal-guardrail";
import type {
  ProteinCalorieRelationshipEvidence,
  ProteinMealPositionEvidence,
  TrendShiftEvidence,
  WeekdayWeekendPatternEvidence,
} from "../kain-signal-types";

const calorieEvidence: ProteinCalorieRelationshipEvidence = {
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

const mealPositionEvidence: ProteinMealPositionEvidence = {
  insightType: "protein_meal_position",
  shortfallDaysEvaluated: 5,
  avgFirstMealProteinSharePct: 13.3,
  proteinTargetG: 200,
  evidenceStrength: "early_signal",
};

const weekendLowerEvidence: WeekdayWeekendPatternEvidence = {
  insightType: "weekday_weekend_pattern",
  weekdayCount: 10,
  weekendCount: 6,
  avgCaloriesWeekday: 1900,
  avgCaloriesWeekend: 1950,
  avgProteinWeekday: 140,
  avgProteinWeekend: 115,
  calorieDiffPct: 2.63,
  proteinDiffG: -25,
  evidenceStrength: "clear_signal",
};

const trendPositiveEvidence: TrendShiftEvidence = {
  insightType: "trend_shift",
  recentWindowDays: 5,
  priorWindowDays: 5,
  avgAttainmentPctRecent: 94.9,
  avgAttainmentPctPrior: 74.9,
  deltaPct: 20,
  direction: "positive",
  proteinTargetG: 150,
  evidenceStrength: "early_signal",
};

const trendNegativeEvidence: TrendShiftEvidence = {
  ...trendPositiveEvidence,
  avgAttainmentPctRecent: 74.9,
  avgAttainmentPctPrior: 94.9,
  deltaPct: -20,
  direction: "negative",
};

function allStrings(content: SignalCardContent): string[] {
  return [
    content.headline,
    content.observation,
    content.evidence,
    content.whyItMatters,
    content.takeaway,
  ];
}

const OVERCLAIMED_CAUSALITY =
  /\bcauses?\b|\bcausing\b|\bbecause of\b|\bleads? to\b|\bresults? in\b|\bimproves?\b|\bmakes? you\b/i;
const SAME_DAY_PATTERNS = [/\btoday\b/i, /\btonight\b/i, /\bnext meal\b/i, /\blog today\b/i];

describe("proteinCalorieRelationshipCopy", () => {
  const content = proteinCalorieRelationshipCopy(calorieEvidence);

  it("reflects the exact evidence numbers", () => {
    expect(content.observation).toContain("60g");
    expect(content.observation).toContain("6");
  });

  it("never overclaims causality and never issues a same-day instruction", () => {
    for (const text of allStrings(content)) {
      expect(text).not.toMatch(OVERCLAIMED_CAUSALITY);
      for (const pattern of SAME_DAY_PATTERNS) expect(text).not.toMatch(pattern);
    }
  });

  it("passes the guardrail's evaluateSignalCopy", () => {
    expect(evaluateSignalCopy(calorieEvidence, content).passes).toBe(true);
  });
});

describe("proteinMealPositionCopy", () => {
  const content = proteinMealPositionCopy(mealPositionEvidence);

  it("reflects the exact evidence numbers and scopes the claim to shortfall days only", () => {
    expect(content.observation).toContain("13%");
    expect(content.whyItMatters.toLowerCase()).toMatch(/shortfall|fall short/);
  });

  it("never overclaims causality and never issues a same-day instruction", () => {
    for (const text of allStrings(content)) {
      expect(text).not.toMatch(OVERCLAIMED_CAUSALITY);
      for (const pattern of SAME_DAY_PATTERNS) expect(text).not.toMatch(pattern);
    }
  });

  it("passes the guardrail's evaluateSignalCopy", () => {
    expect(evaluateSignalCopy(mealPositionEvidence, content).passes).toBe(true);
  });
});

describe("weekdayWeekendPatternCopy", () => {
  it("lower-on-weekends framing reflects the evidence and never overclaims causality", () => {
    const content = weekdayWeekendPatternCopy(weekendLowerEvidence);
    expect(content.observation).toContain("25g");
    expect(content.observation).toContain("lower");
    for (const text of allStrings(content)) {
      expect(text).not.toMatch(OVERCLAIMED_CAUSALITY);
      for (const pattern of SAME_DAY_PATTERNS) expect(text).not.toMatch(pattern);
    }
    expect(evaluateSignalCopy(weekendLowerEvidence, content).passes).toBe(true);
  });

  it("higher-on-weekends framing uses the opposite headline/direction language", () => {
    const higherEvidence: WeekdayWeekendPatternEvidence = {
      ...weekendLowerEvidence,
      avgProteinWeekday: 130,
      avgProteinWeekend: 155,
      proteinDiffG: 25,
    };
    const content = weekdayWeekendPatternCopy(higherEvidence);
    expect(content.observation).toContain("higher");
    expect(content.headline).not.toBe(weekdayWeekendPatternCopy(weekendLowerEvidence).headline);
    expect(evaluateSignalCopy(higherEvidence, content).passes).toBe(true);
  });
});

describe("trendShiftCopy", () => {
  it("positive trend reflects both window percentages and reads as improvement", () => {
    const content = trendShiftCopy(trendPositiveEvidence);
    expect(content.observation).toContain("95%");
    expect(content.observation).toContain("75%");
    expect(content.headline.toLowerCase()).toMatch(/better|trending/);
    for (const text of allStrings(content)) {
      expect(text).not.toMatch(OVERCLAIMED_CAUSALITY);
      for (const pattern of SAME_DAY_PATTERNS) expect(text).not.toMatch(pattern);
    }
    expect(evaluateSignalCopy(trendPositiveEvidence, content).passes).toBe(true);
  });

  it("negative trend reads as a decline, not an improvement", () => {
    const content = trendShiftCopy(trendNegativeEvidence);
    expect(content.headline.toLowerCase()).toMatch(/slip|declin|drop/);
    expect(evaluateSignalCopy(trendNegativeEvidence, content).passes).toBe(true);
  });

  it("never claims to predict what happens next — only describes the two historical windows", () => {
    const content = trendShiftCopy(trendPositiveEvidence);
    const allText = allStrings(content).join(" ").toLowerCase();
    expect(allText).not.toMatch(/\bwill\b|\bguaranteed\b|\bpredict/);
  });
});

describe("no generated relational copy contains a generic motivational phrase (Phase 7)", () => {
  const GENERIC_MOTIVATIONAL = /keep going|you'?re doing great|stay consistent/i;
  it.each([
    ["protein_calorie_relationship", proteinCalorieRelationshipCopy(calorieEvidence)],
    ["protein_meal_position", proteinMealPositionCopy(mealPositionEvidence)],
    ["weekday_weekend_pattern", weekdayWeekendPatternCopy(weekendLowerEvidence)],
    ["trend_shift", trendShiftCopy(trendPositiveEvidence)],
  ])("%s", (_label, content) => {
    for (const text of allStrings(content)) {
      expect(text).not.toMatch(GENERIC_MOTIVATIONAL);
    }
  });
});
