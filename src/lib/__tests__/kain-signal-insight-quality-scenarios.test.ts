// KainSignal V2 insight-quality upgrade (2026-08-10) — synthetic scenarios
// run through the real pipeline, per the mandate's required Phase 13 test
// matrix (Cases 1-8). Each case documents Input / Candidates / Winner /
// Final copy / PASS-FAIL, matching the required report format.

import { describe, it, expect } from "vitest";
import { detectProteinAdherence } from "../kain-signal-detector-protein";
import { detectProteinCalorieRelationship } from "../kain-signal-detector-protein-calorie";
import { detectProteinMealPosition } from "../kain-signal-detector-protein-meal-position";
import { detectWeekdayWeekendPattern } from "../kain-signal-detector-weekday-weekend";
import { detectTrendShift } from "../kain-signal-detector-trend-shift";
import {
  proteinAdherenceCopy,
  proteinCalorieRelationshipCopy,
  proteinMealPositionCopy,
  weekdayWeekendPatternCopy,
  trendShiftCopy,
} from "../kain-signal-copy";
import { evaluateSignalCopy } from "../kain-signal-guardrail";
import { rankInsights, selectTopInsight } from "../kain-signal-ranking";
import { classifyNovelty } from "../kain-signal-insight-value";
import { SIGNAL_REGISTRY } from "../kain-signal-registry";
import type { FoodEntryLite } from "../kain-signal-types";

function proteinEntry(day: string, proteinG: number, calories?: number): FoodEntryLite {
  return {
    logged_at: `${day}T04:00:00Z`,
    calories: calories ?? Math.max(proteinG * 4, 400),
    protein_g: proteinG,
    carbs_g: 0,
    fat_g: 0,
    data_source: "verified_database",
    is_estimate: false,
    confidence: 0.9,
  };
}

function daysFrom(start: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

describe("Case 1 — near miss beats a generic 'missed target' reading", () => {
  it("Input: 5 days at [210,215,205,225,212]g vs a 220g target -> Candidates: near-miss (positive) vs a naive gap reading -> Winner: near-miss framing, high novelty -> PASS", () => {
    const dailyGrams = [210, 215, 205, 225, 212];
    const days = daysFrom("2026-07-01", 5);
    const entriesByDay: Record<string, FoodEntryLite[]> = {};
    days.forEach((day, i) => (entriesByDay[day] = [proteinEntry(day, dailyGrams[i])]));

    const evidence = detectProteinAdherence({
      entriesByDay,
      completeDays: days,
      proteinTargetG: 220,
      proteinTargetWindowStartDay: "2026-01-01",
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.direction).toBe("positive");
    expect(evidence!.adherenceRate).toBeLessThan(0.5); // only 1 of 5 hits exactly
    expect(classifyNovelty(evidence!)).toBe("high"); // the hidden near-miss, not a plain positive

    const content = proteinAdherenceCopy(evidence!);
    expect(content.headline).not.toMatch(/gap|behind|missed/i);
    expect(evaluateSignalCopy(evidence!, content).passes).toBe(true);
  });
});

describe("Case 2 — low-calorie protein drop", () => {
  it("Input: 6 days at 1500kcal/90g vs 6 days at 2200kcal/150g -> Candidates: protein_calorie_relationship -> Winner: relationship insight surfaces, high novelty -> PASS", () => {
    const days = daysFrom("2026-07-01", 12);
    const entriesByDay: Record<string, FoodEntryLite[]> = {};
    days.forEach((day, i) => {
      const lower = i < 6;
      entriesByDay[day] = [proteinEntry(day, lower ? 90 : 150, lower ? 1500 : 2200)];
    });

    const evidence = detectProteinCalorieRelationship({ entriesByDay, completeDays: days });
    expect(evidence).not.toBeNull();
    expect(evidence!.proteinGapG).toBeGreaterThan(0);
    expect(classifyNovelty(evidence!)).toBe("high");

    const content = proteinCalorieRelationshipCopy(evidence!);
    expect(evaluateSignalCopy(evidence!, content).passes).toBe(true);
  });
});

describe("Case 3 — weekend difference", () => {
  it("Input: calories ~flat, protein 25g lower on weekends -> Candidates: weekday_weekend_pattern -> Winner: weekend protein insight -> PASS", () => {
    const weekendDays = [
      "2026-08-01",
      "2026-08-02",
      "2026-08-08",
      "2026-08-09",
      "2026-08-15",
      "2026-08-16",
    ];
    const weekdayDays = [
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
    ];
    const entriesByDay: Record<string, FoodEntryLite[]> = {};
    for (const day of weekdayDays) entriesByDay[day] = [proteinEntry(day, 140, 1900)];
    for (const day of weekendDays) entriesByDay[day] = [proteinEntry(day, 115, 1950)];

    const evidence = detectWeekdayWeekendPattern({
      entriesByDay,
      completeDays: [...weekdayDays, ...weekendDays],
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.proteinDiffG).toBeLessThan(0);
    expect(Math.abs(evidence!.calorieDiffPct)).toBeLessThan(10);

    const content = weekdayWeekendPatternCopy(evidence!);
    // Refutes, rather than reinforces, the naive "weekends are the
    // problem" assumption a user would already expect without this data —
    // and (2026-08-10 copy calibration) hedges with "may not be" rather
    // than a flat "aren't", since this is an association, not a certainty.
    expect(content.headline).toMatch(/isn'?t|aren'?t|may not/i);
    expect(evaluateSignalCopy(evidence!, content).passes).toBe(true);
  });
});

describe("Case 4 — early-meal gap", () => {
  it("Input: 5 shortfall days, first meal ~13% of daily protein -> Candidates: protein_meal_position -> Winner: meal-position insight -> PASS", () => {
    const days = daysFrom("2026-07-01", 5);
    const entriesByDay: Record<string, FoodEntryLite[]> = {};
    for (const day of days) {
      entriesByDay[day] = [
        proteinEntry(day, 20, 300),
        { ...proteinEntry(day, 70, 500), logged_at: `${day}T13:00:00Z` },
        { ...proteinEntry(day, 60, 500), logged_at: `${day}T19:00:00Z` },
      ];
    }

    const evidence = detectProteinMealPosition({
      entriesByDay,
      completeDays: days,
      proteinTargetG: 200,
      proteinTargetWindowStartDay: "2026-01-01",
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.avgFirstMealProteinSharePct).toBeLessThan(25);

    const content = proteinMealPositionCopy(evidence!);
    expect(evaluateSignalCopy(evidence!, content).passes).toBe(true);
  });
});

describe("Case 5 — improvement trend", () => {
  it("Input: prior 5 days ~75% attainment, recent 5 days ~95% -> Candidates: trend_shift -> Winner: positive trend insight -> PASS", () => {
    const prior = [110, 115, 105, 120, 112];
    const recent = [140, 145, 135, 150, 142];
    const days = daysFrom("2026-07-01", 10);
    const entriesByDay: Record<string, FoodEntryLite[]> = {};
    [...prior, ...recent].forEach((g, i) => (entriesByDay[days[i]] = [proteinEntry(days[i], g)]));

    const evidence = detectTrendShift({
      entriesByDay,
      completeDays: days,
      proteinTargetG: 150,
      proteinTargetWindowStartDay: "2026-01-01",
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.direction).toBe("positive");

    const content = trendShiftCopy(evidence!);
    expect(evaluateSignalCopy(evidence!, content).passes).toBe(true);
  });
});

describe("Case 6 — food repetition (explicitly out of scope for this pass)", () => {
  it("no food-repetition detector is registered — deferred, not silently missing", () => {
    // Deliberately not implemented in this pass: a "core foods" pattern
    // depends on food_entries.normalized_name being consistent enough
    // across logs to group by, which this codebase has no existing
    // guarantee of (see kain-signal-detector-protein-meal-position.ts and
    // its siblings, which use only numeric/timestamp fields for exactly
    // this reason). Building it on unreliable name-matching risked a
    // spurious "your strongest days share these foods" claim the evidence
    // doesn't actually support — worse than not shipping it. Flagged here,
    // not silently absent: SIGNAL_REGISTRY has no food-repetition module.
    const registeredIds: string[] = SIGNAL_REGISTRY.map((m) => String(m.id));
    expect(registeredIds).not.toContain("food_repetition");
  });
});

describe("Case 7 — obvious data only -> SILENCE", () => {
  it("Input: only a plain logging-consistency streak, nothing relational qualifies -> Candidates: logging_consistency (clear_signal) -> Winner: none (silence), floor-blocked -> PASS", () => {
    const loggingOnly = {
      insightType: "logging_consistency" as const,
      windowDays: 60,
      activeDays: 14,
      consistencyRate: 14 / 60,
      currentStreak: 4,
      longestGapDays: 5,
      evidenceStrength: "clear_signal" as const,
      direction: "positive" as const,
    };
    const ranked = rankInsights([loggingOnly], {});
    expect(ranked).toHaveLength(1); // still recorded for the audit trail
    expect(selectTopInsight(ranked)).toBeNull(); // but never selected as the winner
  });

  it("a SEVERE, highly actionable logging streak (strong_signal) is the one exception that still surfaces", () => {
    const strongLogging = {
      insightType: "logging_consistency" as const,
      windowDays: 60,
      activeDays: 24,
      consistencyRate: 24 / 60,
      currentStreak: 15,
      longestGapDays: 1,
      evidenceStrength: "strong_signal" as const,
      direction: "positive" as const,
    };
    const ranked = rankInsights([strongLogging], {});
    expect(selectTopInsight(ranked)?.insightType).toBe("logging_consistency");
  });
});

describe("Case 8 — multiple valid candidates: novelty + actionability + evidence wins, not sample size alone", () => {
  it("Input: a strong_signal logging streak (low novelty) alongside an early_signal protein-calorie relationship (high novelty/actionability) -> Winner: the relationship candidate", () => {
    const strongLogging = {
      insightType: "logging_consistency" as const,
      windowDays: 60,
      activeDays: 24,
      consistencyRate: 0.4,
      currentStreak: 15,
      longestGapDays: 1,
      evidenceStrength: "strong_signal" as const,
      direction: "positive" as const,
    };
    const relational = {
      insightType: "protein_calorie_relationship" as const,
      daysEvaluated: 12,
      lowerCalorieDayCount: 6,
      higherCalorieDayCount: 6,
      avgCaloriesLowerGroup: 1500,
      avgCaloriesHigherGroup: 2200,
      avgProteinLowerGroup: 90,
      avgProteinHigherGroup: 150,
      proteinGapG: 60,
      evidenceStrength: "early_signal" as const,
    };
    const ranked = rankInsights([strongLogging, relational], {});
    const top = selectTopInsight(ranked);
    expect(top?.insightType).toBe("protein_calorie_relationship");
  });
});
