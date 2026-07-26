import { describe, it, expect } from "vitest";
import { classifyDayCompleteness, computeDaysCompleteness } from "../kain-signal-day-completeness";
import type { FoodEntryLite } from "../kain-signal-types";

function entry(overrides: Partial<FoodEntryLite> = {}): FoodEntryLite {
  return {
    logged_at: "2026-07-20T04:00:00Z",
    calories: 500,
    protein_g: 30,
    carbs_g: 40,
    fat_g: 15,
    data_source: "verified_database",
    is_estimate: false,
    confidence: 0.9,
    ...overrides,
  };
}

describe("classifyDayCompleteness", () => {
  it("OMAD: one 1,800 kcal verified dinner is a complete day", () => {
    const result = classifyDayCompleteness("2026-07-20", [entry({ calories: 1800 })]);
    expect(result).toEqual({
      day: "2026-07-20",
      entryCount: 1,
      totalCalories: 1800,
      lowTrustShare: 0,
      isReasonablyComplete: true,
    });
  });

  it("a single 80 kcal estimated snack is NOT complete (below the calorie floor)", () => {
    const result = classifyDayCompleteness("2026-07-20", [
      entry({ calories: 80, data_source: "estimated", confidence: 0.4 }),
    ]);
    expect(result.totalCalories).toBe(80);
    expect(result.isReasonablyComplete).toBe(false);
  });

  it("3 entries, 2 of 3 Low Trust (share=0.667, over the 0.5 ceiling) -> not complete", () => {
    const result = classifyDayCompleteness("2026-07-20", [
      entry({ calories: 600 }),
      entry({ calories: 600, data_source: "estimated", confidence: 0.3 }),
      entry({ calories: 600, data_source: "estimated", confidence: 0.3 }),
    ]);
    expect(result.entryCount).toBe(3);
    expect(result.lowTrustShare).toBeCloseTo(0.667, 2);
    expect(result.isReasonablyComplete).toBe(false);
  });

  it("low-trust share exactly at the 0.5 boundary is NOT complete (< required, not <=)", () => {
    const result = classifyDayCompleteness("2026-07-20", [
      entry({ calories: 900 }),
      entry({ calories: 900, data_source: "estimated", confidence: 0.3 }),
    ]);
    expect(result.lowTrustShare).toBe(0.5);
    expect(result.isReasonablyComplete).toBe(false);
  });

  it("zero entries is never complete", () => {
    const result = classifyDayCompleteness("2026-07-20", []);
    expect(result.isReasonablyComplete).toBe(false);
    expect(result.lowTrustShare).toBe(0);
  });
});

describe("computeDaysCompleteness", () => {
  it("groups entries by Manila day and classifies each independently", () => {
    const entries = [
      entry({ logged_at: "2026-07-20T04:00:00Z", calories: 1800 }), // 2026-07-20, complete
      entry({ logged_at: "2026-07-21T02:00:00Z", calories: 100 }), // 2026-07-21 (10:00 Manila)
      entry({ logged_at: "2026-07-21T10:00:00Z", calories: 700 }), // still 2026-07-21 (18:00 Manila, within the same UTC+8 day)
    ];
    const result = computeDaysCompleteness(entries);
    expect(Object.keys(result).sort()).toEqual(["2026-07-20", "2026-07-21"]);
    expect(result["2026-07-20"].isReasonablyComplete).toBe(true);
    expect(result["2026-07-21"].entryCount).toBe(2);
    expect(result["2026-07-21"].totalCalories).toBe(800);
    expect(result["2026-07-21"].isReasonablyComplete).toBe(true);
  });
});
