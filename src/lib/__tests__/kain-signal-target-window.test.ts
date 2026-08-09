// Target-window safety regression tests (2026-08-09 recalibration, Task 5).
// Cases I-M, per the recalibration spec's required test matrix. Each case
// exercises detectProteinAdherence directly with a proteinTargetWindowStartDay
// that models one of the five target-update semantics implemented by the
// 20260809140627 migration's trigger (touch_protein_target_updated_at):
//   same value resaved      -> window unchanged (Case K)
//   real value change       -> window resets to the change day (Cases I, J)
//   null -> non-null        -> window starts now, no prior history (Case L)
//   non-null -> null        -> detector returns null / SILENCE (Case M)
// The trigger itself (the DB-level half of this guarantee) was verified
// directly against local Supabase via isolated docker exec/psql runs during
// this recalibration — see the migration file's header comment. These tests
// cover the other half: given a correct window-start day, the detector
// itself must actually honor it.

import { describe, it, expect } from "vitest";
import { detectProteinAdherence } from "../kain-signal-detector-protein";
import type { FoodEntryLite } from "../kain-signal-types";

function proteinEntry(day: string, proteinG: number): FoodEntryLite {
  return {
    logged_at: `${day}T04:00:00Z`,
    calories: Math.max(proteinG * 4, 400),
    protein_g: proteinG,
    carbs_g: 0,
    fat_g: 0,
    data_source: "verified_database",
    is_estimate: false,
    confidence: 0.9,
  };
}

function buildDays(dailyGrams: readonly number[], days: readonly string[]) {
  const entriesByDay: Record<string, FoodEntryLite[]> = {};
  days.forEach((day, i) => {
    entriesByDay[day] = [proteinEntry(day, dailyGrams[i])];
  });
  return entriesByDay;
}

describe("Case I — target increase mid-history: old-target days excluded from new-target evaluation", () => {
  it("10 days logged at ~150g against an old 150g target, then target raised to 220g on 2026-08-01 -> only post-change days qualify", () => {
    // Old-target days: 2026-07-01..10, all comfortably hit the OLD 150g
    // target. If these were judged against the NEW 220g target they'd read
    // as a strong shortfall that never actually happened under the target
    // the user had at the time.
    const oldDays = Array.from(
      { length: 10 },
      (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`,
    );
    const oldGrams = oldDays.map(() => 155);
    // New-target days: 2026-08-01..08, genuinely evaluated against 220g.
    const newDays = Array.from(
      { length: 8 },
      (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`,
    );
    const newGrams = [210, 215, 205, 225, 212, 218, 208, 220];

    const completeDays = [...oldDays, ...newDays];
    const entriesByDay = {
      ...buildDays(oldGrams, oldDays),
      ...buildDays(newGrams, newDays),
    };

    const evidence = detectProteinAdherence({
      entriesByDay,
      completeDays,
      proteinTargetG: 220,
      proteinTargetWindowStartDay: "2026-08-01", // target changed here
    });

    expect(evidence).not.toBeNull();
    // Only the 8 post-change days are evaluated — the 10 pre-change days
    // (which would read as a severe 220g shortfall) are excluded entirely.
    expect(evidence!.daysEvaluated).toBe(8);
    expect(evidence!.direction).not.toBe("negative");
  });
});

describe("Case J — target decrease mid-history: same exclusion logic, no retroactive praise", () => {
  it("10 days logged at ~150g against an old 220g target (a real shortfall), then target lowered to 150g on 2026-08-01 -> old shortfall days never retroactively read as a hit", () => {
    const oldDays = Array.from(
      { length: 10 },
      (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`,
    );
    const oldGrams = oldDays.map(() => 150); // a real shortfall against the OLD 220g target
    const newDays = Array.from(
      { length: 8 },
      (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`,
    );
    const newGrams = [150, 152, 148, 155, 151, 149, 153, 150]; // right at the NEW 150g target

    const completeDays = [...oldDays, ...newDays];
    const entriesByDay = {
      ...buildDays(oldGrams, oldDays),
      ...buildDays(newGrams, newDays),
    };

    const evidence = detectProteinAdherence({
      entriesByDay,
      completeDays,
      proteinTargetG: 150,
      proteinTargetWindowStartDay: "2026-08-01",
    });

    expect(evidence).not.toBeNull();
    expect(evidence!.daysEvaluated).toBe(8);
    // Evaluated only against the new 150g target, on new-window days only —
    // not diluted or inflated by the 10 old days that were a real shortfall
    // against a target that no longer applies.
    expect(evidence!.direction).toBe("positive");
  });
});

describe("Case K — target resaved at the same value: window does not reset, existing evidence remains valid", () => {
  it("resaving the same target value produces an unchanged windowStartDay (trigger uses IS DISTINCT FROM) -> the detector evaluates the exact same qualified days as before the resave", () => {
    const days = Array.from({ length: 10 }, (_, i) => `2026-07-${String(i + 11).padStart(2, "0")}`);
    const grams = [140, 150, 120, 135, 100, 145, 160, 90, 130, 155];
    const entriesByDay = buildDays(grams, days);

    // Because the trigger only touches protein_target_updated_at when
    // target_protein_g IS DISTINCT FROM the old value, resaving the same
    // 130g target leaves proteinTargetWindowStartDay unchanged (still an
    // early date) -- so the same 10 days remain qualified.
    const before = detectProteinAdherence({
      entriesByDay,
      completeDays: days,
      proteinTargetG: 130,
      proteinTargetWindowStartDay: "2026-01-01",
    });
    const afterResave = detectProteinAdherence({
      entriesByDay,
      completeDays: days,
      proteinTargetG: 130,
      proteinTargetWindowStartDay: "2026-01-01", // unchanged — the resave was a no-op for this column
    });

    expect(before).not.toBeNull();
    expect(afterResave).toEqual(before);
  });
});

describe("Case L — target first created (null -> non-null): window starts now, no historical signal until evidence rebuilds", () => {
  it("a user with 20 days of food logs but no target at all, who then sets a target today -> only days from today forward can ever qualify, so pre-existing history is invisible to this detector", () => {
    const historicalDays = Array.from(
      { length: 20 },
      (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`,
    );
    const historicalGrams = historicalDays.map(() => 200); // plenty of prior logging, but under no target
    const entriesByDay = buildDays(historicalGrams, historicalDays);

    // Target first set on 2026-08-01 -> window starts there. None of the 20
    // pre-existing days qualify, regardless of how much protein they logged.
    const evidence = detectProteinAdherence({
      entriesByDay,
      completeDays: historicalDays,
      proteinTargetG: 220,
      proteinTargetWindowStartDay: "2026-08-01",
    });

    expect(evidence).toBeNull(); // zero qualified days -> below the early-signal floor
  });
});

describe("Case M — target removed (non-null -> null): protein-adherence produces silence", () => {
  it("proteinTargetG null (target cleared) -> null regardless of window-start day or logging history", () => {
    const days = Array.from({ length: 15 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const grams = days.map(() => 200);
    const entriesByDay = buildDays(grams, days);

    const evidence = detectProteinAdherence({
      entriesByDay,
      completeDays: days,
      proteinTargetG: null,
      proteinTargetWindowStartDay: "2026-01-01",
    });

    expect(evidence).toBeNull();
  });
});
