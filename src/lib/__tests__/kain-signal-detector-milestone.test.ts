import { describe, it, expect } from "vitest";
import {
  detectBehaviorMilestone,
  milestoneKey,
  MILESTONE_TYPE_PRIORITY,
} from "../kain-signal-detector-milestone";

describe("detectBehaviorMilestone — crossing rule", () => {
  it("24 -> 25 meals emits meal-count 25 once (10 already recorded)", () => {
    const result = detectBehaviorMilestone({
      lifetimeMealCount: 25,
      lifetimeDistinctLoggingDays: 0,
      recordedMilestoneKeys: new Set([milestoneKey("meal_count", 10)]),
    });
    expect(result.surfaced).toMatchObject({ milestoneType: "meal_count", threshold: 25 });
    expect(result.completedSilently).toEqual([]);
  });

  it("25 -> 26 meals does not re-emit 25 (already recorded)", () => {
    const result = detectBehaviorMilestone({
      lifetimeMealCount: 26,
      lifetimeDistinctLoggingDays: 0,
      recordedMilestoneKeys: new Set([
        milestoneKey("meal_count", 10),
        milestoneKey("meal_count", 25),
      ]),
    });
    expect(result.surfaced).toBeNull();
    expect(result.completedSilently).toEqual([]);
  });
});

describe("detectBehaviorMilestone — bootstrap policy", () => {
  it("an existing user first seen at 63 meals surfaces only the highest threshold, completing the rest silently", () => {
    const result = detectBehaviorMilestone({
      lifetimeMealCount: 63,
      lifetimeDistinctLoggingDays: 0,
      recordedMilestoneKeys: new Set(),
    });
    expect(result.surfaced).toMatchObject({ milestoneType: "meal_count", threshold: 50 });
    expect(result.completedSilently.sort((a, b) => a.threshold - b.threshold)).toEqual([
      { milestoneType: "meal_count", threshold: 10, observedValue: 63 },
      { milestoneType: "meal_count", threshold: 25, observedValue: 63 },
    ]);
  });

  it("does not cascade on a second call after the bootstrap completions are recorded", () => {
    const bootstrapped = new Set([
      milestoneKey("meal_count", 10),
      milestoneKey("meal_count", 25),
      milestoneKey("meal_count", 50),
    ]);
    const result = detectBehaviorMilestone({
      lifetimeMealCount: 63,
      lifetimeDistinctLoggingDays: 0,
      recordedMilestoneKeys: bootstrapped,
    });
    expect(result.surfaced).toBeNull();
    expect(result.completedSilently).toEqual([]);
  });
});

describe("detectBehaviorMilestone — multi-threshold crossing in one mutation", () => {
  it("9 -> 26 meals in one jump surfaces 25 and silently completes 10 (never shown later)", () => {
    const result = detectBehaviorMilestone({
      lifetimeMealCount: 26,
      lifetimeDistinctLoggingDays: 0,
      recordedMilestoneKeys: new Set(),
    });
    expect(result.surfaced).toMatchObject({ milestoneType: "meal_count", threshold: 25 });
    expect(result.completedSilently).toEqual([
      { milestoneType: "meal_count", threshold: 10, observedValue: 26 },
    ]);

    // The next call must never surface 10 — it was completed silently, not left pending.
    const recordedAfter = new Set([milestoneKey("meal_count", 10), milestoneKey("meal_count", 25)]);
    const next = detectBehaviorMilestone({
      lifetimeMealCount: 26,
      lifetimeDistinctLoggingDays: 0,
      recordedMilestoneKeys: recordedAfter,
    });
    expect(next.surfaced).toBeNull();
  });
});

describe("detectBehaviorMilestone — cross-type priority", () => {
  it("documents an explicit, non-numeric type priority (meal_count before distinct_logging_days)", () => {
    expect(MILESTONE_TYPE_PRIORITY.meal_count).toBeLessThan(
      MILESTONE_TYPE_PRIORITY.distinct_logging_days,
    );
  });

  it("meal_count:10 outranks distinct_logging_days:30 despite the smaller raw threshold number", () => {
    // Isolate distinct_logging_days to exactly the 30 threshold (7 and 14
    // already recorded) so the only two live candidates are meal_count:10
    // and distinct_logging_days:30 — a case where "largest number wins"
    // would (wrongly) pick 30.
    const result = detectBehaviorMilestone({
      lifetimeMealCount: 10,
      lifetimeDistinctLoggingDays: 30,
      recordedMilestoneKeys: new Set([
        milestoneKey("distinct_logging_days", 7),
        milestoneKey("distinct_logging_days", 14),
      ]),
    });
    expect(result.surfaced).toMatchObject({ milestoneType: "meal_count", threshold: 10 });
    expect(result.completedSilently).toEqual([
      { milestoneType: "distinct_logging_days", threshold: 30, observedValue: 30 },
    ]);
  });
});

describe("detectBehaviorMilestone — no candidates", () => {
  it("returns {surfaced: null, completedSilently: []} when nothing is crossed", () => {
    const result = detectBehaviorMilestone({
      lifetimeMealCount: 3,
      lifetimeDistinctLoggingDays: 2,
      recordedMilestoneKeys: new Set(),
    });
    expect(result).toEqual({ surfaced: null, completedSilently: [] });
  });
});
