import { describe, it, expect } from "vitest";
import { detectProteinAdherence } from "../kain-signal-detector-protein";
import type { FoodEntryLite } from "../kain-signal-types";

function proteinEntry(day: string, proteinG: number): FoodEntryLite {
  return {
    logged_at: `${day}T04:00:00Z`,
    calories: proteinG * 4,
    protein_g: proteinG,
    carbs_g: 0,
    fat_g: 0,
    data_source: "verified_database",
    is_estimate: false,
    confidence: 0.9,
  };
}

describe("detectProteinAdherence", () => {
  it("returns null when no protein target is set (most users)", () => {
    const result = detectProteinAdherence({
      entriesByDay: {},
      completeDays: ["2026-07-01", "2026-07-02"],
      proteinTargetG: null,
    });
    expect(result).toBeNull();
  });

  it("returns null when the target is zero or negative", () => {
    expect(
      detectProteinAdherence({ entriesByDay: {}, completeDays: [], proteinTargetG: 0 }),
    ).toBeNull();
  });

  it("the worked 8-day / 130g example: [140,150,120,135,100,145,160,90] -> 5/8 adherence, clear_signal", () => {
    const dailyTotals = [140, 150, 120, 135, 100, 145, 160, 90];
    const completeDays = dailyTotals.map((_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const entriesByDay: Record<string, FoodEntryLite[]> = {};
    completeDays.forEach((day, i) => {
      entriesByDay[day] = [proteinEntry(day, dailyTotals[i])];
    });

    const result = detectProteinAdherence({
      entriesByDay,
      completeDays,
      proteinTargetG: 130,
    });

    expect(result).not.toBeNull();
    expect(result!.daysEvaluated).toBe(8);
    expect(result!.daysAtOrAboveTarget).toBe(5);
    expect(result!.adherenceRate).toBeCloseTo(0.625, 5);
    expect(result!.proteinTargetG).toBe(130);
    expect(result!.evidenceStrength).toBe("clear_signal");
  });

  it("a single isolated day (today-only totals) cannot qualify as a trend, however far below target", () => {
    const completeDays = ["2026-07-01"];
    const entriesByDay: Record<string, FoodEntryLite[]> = {
      "2026-07-01": [proteinEntry("2026-07-01", 20)], // one isolated low-protein day
    };
    const result = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG: 130 });
    expect(result).toBeNull();
  });

  it("too few complete days for the early-signal floor (4 days, floor is 5) -> null", () => {
    const completeDays = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"];
    const entriesByDay: Record<string, FoodEntryLite[]> = {};
    for (const day of completeDays) entriesByDay[day] = [proteinEntry(day, 200)];

    const result = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG: 130 });
    expect(result).toBeNull();
  });

  it("a day with no entries in entriesByDay counts as 0g protein, not a crash", () => {
    const completeDays = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"];
    const entriesByDay: Record<string, FoodEntryLite[]> = {
      "2026-07-01": [proteinEntry("2026-07-01", 200)],
      // 2026-07-02..05 intentionally missing from entriesByDay
    };
    const result = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG: 130 });
    expect(result).not.toBeNull();
    expect(result!.daysEvaluated).toBe(5);
    expect(result!.daysAtOrAboveTarget).toBe(1);
  });
});
