import { describe, it, expect } from "vitest";
import {
  evaluateCoaching,
  daysSinceLastActive,
  weeklyLoggedDayCounts,
  type CoachingInput,
} from "../coaching";

function base(overrides: Partial<CoachingInput> = {}): CoachingInput {
  return {
    gapDays: 0,
    hasLoggedToday: true,
    targetsActive: true,
    proteinRemaining: 0,
    caloriesRemaining: 0,
    calorieNearMarginKcal: 200,
    celebratedTodayAlready: false,
    weekly: { thisWeekDays: 1, lastWeekDays: 3 },
    justCompletedCelebrate: false,
    ...overrides,
  };
}

describe("evaluateCoaching — hierarchy order", () => {
  it("Recovery outranks everything, including an unlogged first meal", () => {
    const r = evaluateCoaching(base({ gapDays: 10, hasLoggedToday: false }));
    expect(r).toEqual({ kind: "recover", tier: "7-29" });
  });

  it("Guide (first meal) outranks steady-state Celebrate and Reinforce", () => {
    const r = evaluateCoaching(
      base({
        hasLoggedToday: false,
        proteinRemaining: 0,
        caloriesRemaining: 0,
        weekly: { thisWeekDays: 5, lastWeekDays: 1 },
      }),
    );
    expect(r).toEqual({ kind: "guide", reason: "first-meal" });
  });

  it("Guide (protein remaining) outranks Celebrate and Reinforce", () => {
    const r = evaluateCoaching(
      base({ proteinRemaining: 20, weekly: { thisWeekDays: 5, lastWeekDays: 1 } }),
    );
    expect(r).toEqual({ kind: "guide", reason: "protein-remaining" });
  });

  it("Celebrate (steady-state) outranks Reinforce", () => {
    const r = evaluateCoaching(
      base({
        proteinRemaining: 0,
        caloriesRemaining: 0,
        weekly: { thisWeekDays: 5, lastWeekDays: 1 },
      }),
    );
    expect(r).toEqual({ kind: "celebrate", reason: "same-day-complete" });
  });

  it("falls through to Reinforce only when nothing above applies", () => {
    const r = evaluateCoaching(
      base({
        proteinRemaining: 0,
        caloriesRemaining: 0,
        celebratedTodayAlready: true,
        weekly: { thisWeekDays: 5, lastWeekDays: 1 },
      }),
    );
    expect(r).toEqual({ kind: "reinforce", reason: "weekly-improved" });
  });

  it("falls all the way to Silence when nothing meaningful applies", () => {
    const r = evaluateCoaching(
      base({
        targetsActive: false,
        celebratedTodayAlready: true,
        weekly: { thisWeekDays: 2, lastWeekDays: 5 },
      }),
    );
    expect(r).toEqual({ kind: "silence" });
  });
});

describe("evaluateCoaching — transient Celebrate override", () => {
  it("jumps ahead of Guide-worthy protein-remaining state when justCompletedCelebrate fires", () => {
    // Contradictory on purpose: proteinRemaining <=0 is required for
    // "both macros met", so this models the exact instant a save closes
    // out the last remaining gram.
    const r = evaluateCoaching(
      base({ proteinRemaining: 0, caloriesRemaining: 0, justCompletedCelebrate: true }),
    );
    expect(r).toEqual({ kind: "celebrate", reason: "same-day-complete" });
  });

  it("does nothing if the flag is set but macros are not actually both met", () => {
    const r = evaluateCoaching(base({ proteinRemaining: 15, justCompletedCelebrate: true }));
    expect(r).toEqual({ kind: "guide", reason: "protein-remaining" });
  });

  it("never fires on its own without the flag, even in an identical macro state", () => {
    const r = evaluateCoaching(
      base({ proteinRemaining: 0, caloriesRemaining: 0, justCompletedCelebrate: false }),
    );
    expect(r.kind).toBe("celebrate"); // steady-state path, not the override — same result, different reason it fired
  });
});

describe("evaluateCoaching — Recovery tiers", () => {
  it.each([
    [2, null], // below the 3-day threshold — not Recovery at all
    [3, "3-6"],
    [6, "3-6"],
    [7, "7-29"],
    [29, "7-29"],
    [30, "30+"],
    [90, "30+"],
  ] as const)("gapDays=%s -> tier %s", (gapDays, expected) => {
    const r = evaluateCoaching(base({ gapDays, hasLoggedToday: false }));
    if (expected === null) {
      expect(r.kind).not.toBe("recover");
    } else {
      expect(r).toEqual({ kind: "recover", tier: expected });
    }
  });

  it("null gapDays (no prior day in window) is never treated as Recovery", () => {
    const r = evaluateCoaching(base({ gapDays: null, hasLoggedToday: false }));
    expect(r).toEqual({ kind: "guide", reason: "first-meal" });
  });
});

describe("evaluateCoaching — Celebrate repetition guard", () => {
  it("does not re-fire steady-state Celebrate once already shown today", () => {
    const r = evaluateCoaching(
      base({ proteinRemaining: 0, caloriesRemaining: 0, celebratedTodayAlready: true }),
    );
    expect(r.kind).not.toBe("celebrate");
  });
});

describe("evaluateCoaching — calories-near Guide branch", () => {
  it("fires only when protein is met and calories are close but not reached", () => {
    const r = evaluateCoaching(base({ proteinRemaining: 0, caloriesRemaining: 150 }));
    expect(r).toEqual({ kind: "guide", reason: "calories-near" });
  });

  it("does not fire when calories remaining exceeds the near-margin", () => {
    const r = evaluateCoaching(
      base({
        proteinRemaining: 0,
        caloriesRemaining: 500,
        weekly: { thisWeekDays: 1, lastWeekDays: 5 },
      }),
    );
    expect(r.kind).not.toBe("guide");
  });
});

describe("daysSinceLastActive", () => {
  it("returns null when there is no prior active day in the window", () => {
    expect(daysSinceLastActive([], "2026-07-23")).toBeNull();
    expect(daysSinceLastActive(["2026-07-23"], "2026-07-23")).toBeNull(); // only today itself
  });

  it("computes the gap correctly, excluding today", () => {
    expect(daysSinceLastActive(["2026-07-20", "2026-07-23"], "2026-07-23")).toBe(3);
  });

  it("uses the most recent prior day when multiple exist", () => {
    expect(daysSinceLastActive(["2026-07-01", "2026-07-15", "2026-07-20"], "2026-07-23")).toBe(3);
  });
});

describe("weeklyLoggedDayCounts", () => {
  it("buckets days into this-week (Mon-start, inclusive of today) vs last-week", () => {
    // 2026-07-23 is a Thursday; week start (Monday) is 2026-07-20.
    const days = [
      "2026-07-20",
      "2026-07-21", // this week
      "2026-07-13",
      "2026-07-14",
      "2026-07-15", // last week
      "2026-06-01", // neither
    ];
    const result = weeklyLoggedDayCounts(days, "2026-07-23");
    expect(result).toEqual({ thisWeekDays: 2, lastWeekDays: 3 });
  });

  it("de-duplicates repeated day strings", () => {
    const result = weeklyLoggedDayCounts(["2026-07-20", "2026-07-20"], "2026-07-23");
    expect(result.thisWeekDays).toBe(1);
  });
});
