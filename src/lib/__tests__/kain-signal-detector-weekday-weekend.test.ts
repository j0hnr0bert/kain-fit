import { describe, it, expect } from "vitest";
import { detectWeekdayWeekendPattern } from "../kain-signal-detector-weekday-weekend";
import type { FoodEntryLite } from "../kain-signal-types";

function entry(day: string, calories: number, proteinG: number): FoodEntryLite {
  return {
    logged_at: `${day}T12:00:00Z`,
    calories,
    protein_g: proteinG,
    carbs_g: 0,
    fat_g: 0,
    data_source: "verified_database",
    is_estimate: false,
    confidence: 0.9,
  };
}

// 2026-08-01/02/08/09/15/16 are Sat/Sun/Sat/Sun/Sat/Sun (verified via
// `date`); 2026-08-03..07 and 10..14 are the 10 weekdays in between.
const WEEKEND_DAYS = [
  "2026-08-01",
  "2026-08-02",
  "2026-08-08",
  "2026-08-09",
  "2026-08-15",
  "2026-08-16",
];
const WEEKDAY_DAYS = [
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

function build(
  weekdayVals: { calories: number; protein: number },
  weekendVals: { calories: number; protein: number },
) {
  const entriesByDay: Record<string, FoodEntryLite[]> = {};
  for (const day of WEEKDAY_DAYS)
    entriesByDay[day] = [entry(day, weekdayVals.calories, weekdayVals.protein)];
  for (const day of WEEKEND_DAYS)
    entriesByDay[day] = [entry(day, weekendVals.calories, weekendVals.protein)];
  return { completeDays: [...WEEKDAY_DAYS, ...WEEKEND_DAYS], entriesByDay };
}

describe("detectWeekdayWeekendPattern", () => {
  it("calories flat (~2.6% diff) but protein drops 25g on weekends -> surfaces", () => {
    const { completeDays, entriesByDay } = build(
      { calories: 1900, protein: 140 },
      { calories: 1950, protein: 115 },
    );
    const evidence = detectWeekdayWeekendPattern({ entriesByDay, completeDays });
    expect(evidence).not.toBeNull();
    expect(evidence!.weekdayCount).toBe(10);
    expect(evidence!.weekendCount).toBe(6);
    expect(evidence!.calorieDiffPct).toBeCloseTo(2.6316, 2);
    expect(evidence!.proteinDiffG).toBeCloseTo(-25, 5);
    expect(evidence!.evidenceStrength).toBe("clear_signal"); // 16 total >= clear(14), < strong(24)
  });

  it("calories flat AND protein flat too -> null (the unsurprising, obvious story)", () => {
    const { completeDays, entriesByDay } = build(
      { calories: 1900, protein: 140 },
      { calories: 1950, protein: 138 }, // 2g diff, well under the 15g floor
    );
    expect(detectWeekdayWeekendPattern({ entriesByDay, completeDays })).toBeNull();
  });

  it("calories move a lot too (not 'flat') even with a real protein gap -> null (not the narrow pattern this detector looks for)", () => {
    const { completeDays, entriesByDay } = build(
      { calories: 1900, protein: 140 },
      { calories: 2500, protein: 110 }, // 31.6% calorie swing, well over the 10% stability band
    );
    expect(detectWeekdayWeekendPattern({ entriesByDay, completeDays })).toBeNull();
  });

  it("weekend protein HIGHER (not lower) with flat calories also surfaces — either direction is non-obvious", () => {
    const { completeDays, entriesByDay } = build(
      { calories: 1900, protein: 130 },
      { calories: 1930, protein: 155 },
    );
    const evidence = detectWeekdayWeekendPattern({ entriesByDay, completeDays });
    expect(evidence).not.toBeNull();
    expect(evidence!.proteinDiffG).toBeGreaterThan(0);
  });

  it("too few weekend days (only 2 in the window) -> null even with a real pattern", () => {
    const shortWeekendDays = WEEKEND_DAYS.slice(0, 2);
    const entriesByDay: Record<string, FoodEntryLite[]> = {};
    for (const day of WEEKDAY_DAYS) entriesByDay[day] = [entry(day, 1900, 140)];
    for (const day of shortWeekendDays) entriesByDay[day] = [entry(day, 1950, 115)];
    const evidence = detectWeekdayWeekendPattern({
      entriesByDay,
      completeDays: [...WEEKDAY_DAYS, ...shortWeekendDays],
    });
    expect(evidence).toBeNull();
  });
});
