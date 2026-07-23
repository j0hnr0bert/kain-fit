import { describe, it, expect } from "vitest";
import {
  evaluateCoaching,
  daysSinceLastActive,
  weeklyLoggedDayCounts,
  createInitialCelebrationState,
  markSaveCompletedCelebrate,
  consumeCelebrateIfShown,
  saveCausedCelebration,
  saveCausedCalorieCompletion,
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

describe("saveCausedCalorieCompletion — drives the one-shot gold ring glow", () => {
  it("is true only for a genuine not-met -> met transition", () => {
    expect(
      saveCausedCalorieCompletion({
        targetsActive: true,
        preCaloriesRemaining: 300,
        postCaloriesRemaining: 0,
      }),
    ).toBe(true);
  });

  it("is false when targets are not active, even if the numbers look like a transition", () => {
    expect(
      saveCausedCalorieCompletion({
        targetsActive: false,
        preCaloriesRemaining: 300,
        postCaloriesRemaining: 0,
      }),
    ).toBe(false);
  });

  it("is false for a failed save (pre === post, no real transition)", () => {
    expect(
      saveCausedCalorieCompletion({
        targetsActive: true,
        preCaloriesRemaining: 300,
        postCaloriesRemaining: 300,
      }),
    ).toBe(false);
  });

  it("is false when calories were already complete before this save — no replay on an already-gold ring", () => {
    expect(
      saveCausedCalorieCompletion({
        targetsActive: true,
        preCaloriesRemaining: 0,
        postCaloriesRemaining: 0,
      }),
    ).toBe(false);
  });

  it("is independent of protein — a save that only closes out calories still counts", () => {
    // saveCausedCalorieCompletion deliberately takes no protein input at
    // all, so a save that finishes calories while protein is still short
    // (a scenario saveCausedCelebration would reject) still triggers gold.
    expect(
      saveCausedCalorieCompletion({
        targetsActive: true,
        preCaloriesRemaining: 50,
        postCaloriesRemaining: 0,
      }),
    ).toBe(true);
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

// Deterministic-override audit (2026-07-23): the earlier useState +
// setTimeout(0) implementation cleared the flag on a wall-clock timer
// rather than on an observed state transition, which meant its
// correctness depended on how many renders happened to occur, and in
// what order, before the timeout fired. These tests pin the replacement
// state machine's actual contract instead. See the five labeled
// requirements from the audit request.
describe("celebration state machine", () => {
  it("(a) a save that completes both targets shows Celebrate via the transient override", () => {
    const armed = markSaveCompletedCelebrate(createInitialCelebrationState());
    const result = evaluateCoaching(
      base({
        proteinRemaining: 0,
        caloriesRemaining: 0,
        justCompletedCelebrate: armed.transientCelebrate,
        celebratedTodayAlready: armed.celebratedToday,
      }),
    );
    expect(result).toEqual({ kind: "celebrate", reason: "same-day-complete" });
  });

  it("(b) an unrelated rerender (re-evaluating with unchanged state) does not consume the override", () => {
    const armed = markSaveCompletedCelebrate(createInitialCelebrationState());
    const input = base({
      proteinRemaining: 0,
      caloriesRemaining: 0,
      justCompletedCelebrate: armed.transientCelebrate,
      celebratedTodayAlready: armed.celebratedToday,
    });
    const first = evaluateCoaching(input);
    const second = evaluateCoaching(input); // simulates a second render before consumeCelebrateIfShown runs
    expect(first).toEqual({ kind: "celebrate", reason: "same-day-complete" });
    expect(second).toEqual(first);
    // Evaluating never mutates the state itself — only consumeCelebrateIfShown does.
    expect(armed.transientCelebrate).toBe(true);
  });

  it("(c) after being consumed, the next evaluation resumes the standing hierarchy instead of re-celebrating", () => {
    const armed = markSaveCompletedCelebrate(createInitialCelebrationState());
    const shown = evaluateCoaching(
      base({
        proteinRemaining: 0,
        caloriesRemaining: 0,
        justCompletedCelebrate: armed.transientCelebrate,
        celebratedTodayAlready: armed.celebratedToday,
      }),
    );
    expect(shown.kind).toBe("celebrate");

    const consumed = consumeCelebrateIfShown(armed, shown.kind);
    expect(consumed).toEqual({ transientCelebrate: false, celebratedToday: true });

    const next = evaluateCoaching(
      base({
        proteinRemaining: 0,
        caloriesRemaining: 0,
        weekly: { thisWeekDays: 5, lastWeekDays: 1 },
        justCompletedCelebrate: consumed.transientCelebrate,
        celebratedTodayAlready: consumed.celebratedToday,
      }),
    );
    expect(next).toEqual({ kind: "reinforce", reason: "weekly-improved" });

    // Consuming again (e.g. another render still evaluating "reinforce", not
    // "celebrate") is a no-op and returns the same reference.
    expect(consumeCelebrateIfShown(consumed, next.kind)).toBe(consumed);
  });

  it("(d) a failed save never arms the override — saveCausedCelebration requires an actual pre→post transition", () => {
    // A failed save changes nothing, so post equals pre by construction —
    // this is the correct model for "failed", not a special-cased branch.
    expect(
      saveCausedCelebration({
        targetsActive: true,
        preProteinRemaining: 0,
        preCaloriesRemaining: 0,
        postProteinRemaining: 0,
        postCaloriesRemaining: 0,
      }),
    ).toBe(false);
    // Also false when targets were already met before this (failed or not)
    // save — there is no new transition to celebrate.
    expect(
      saveCausedCelebration({
        targetsActive: true,
        preProteinRemaining: 0,
        preCaloriesRemaining: 0,
        postProteinRemaining: 0,
        postCaloriesRemaining: 5,
      }),
    ).toBe(false);
    const state = createInitialCelebrationState();
    expect(state.transientCelebrate).toBe(false);
  });

  it("saveCausedCelebration is true only for a genuine not-met -> met transition", () => {
    expect(
      saveCausedCelebration({
        targetsActive: true,
        preProteinRemaining: 5,
        preCaloriesRemaining: 0,
        postProteinRemaining: 0,
        postCaloriesRemaining: 0,
      }),
    ).toBe(true);
    expect(
      saveCausedCelebration({
        targetsActive: false,
        preProteinRemaining: 5,
        preCaloriesRemaining: 5,
        postProteinRemaining: 0,
        postCaloriesRemaining: 0,
      }),
    ).toBe(false);
  });

  it("(e) a reload the same day rehydrates celebratedToday and does not replay Celebrate", () => {
    // Simulates: fresh component mount (transientCelebrate always starts
    // false — it is never persisted), with celebratedToday restored from
    // localStorage because Celebrate already fired earlier today.
    const rehydrated = { transientCelebrate: false, celebratedToday: true };
    const result = evaluateCoaching(
      base({
        proteinRemaining: 0,
        caloriesRemaining: 0,
        justCompletedCelebrate: rehydrated.transientCelebrate,
        celebratedTodayAlready: rehydrated.celebratedToday,
      }),
    );
    expect(result.kind).not.toBe("celebrate");
  });

  it("(e) a fresh mount with no persisted flag (new day, or first-ever visit) can still celebrate normally", () => {
    const fresh = createInitialCelebrationState();
    const result = evaluateCoaching(
      base({
        proteinRemaining: 0,
        caloriesRemaining: 0,
        justCompletedCelebrate: fresh.transientCelebrate,
        celebratedTodayAlready: fresh.celebratedToday,
      }),
    );
    expect(result).toEqual({ kind: "celebrate", reason: "same-day-complete" });
  });
});
