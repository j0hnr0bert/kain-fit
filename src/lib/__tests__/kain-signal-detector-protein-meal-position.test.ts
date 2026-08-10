import { describe, it, expect } from "vitest";
import { detectProteinMealPosition } from "../kain-signal-detector-protein-meal-position";
import type { FoodEntryLite } from "../kain-signal-types";

// A day whose first meal (07:00) is small and separated by a >=90-minute
// gap from the rest of the day's entries (13:00, 19:00) — first-meal share
// is 20/150 = ~13.3%, well under the 25% low-share threshold, and the
// day's total (150g) is a real shortfall against a 200g target.
function shortfallDayLowFirstMeal(day: string): FoodEntryLite[] {
  return [
    {
      logged_at: `${day}T07:00:00Z`,
      calories: 300,
      protein_g: 20,
      carbs_g: 0,
      fat_g: 0,
      data_source: "verified_database",
      is_estimate: false,
      confidence: 0.9,
    },
    {
      logged_at: `${day}T13:00:00Z`,
      calories: 500,
      protein_g: 70,
      carbs_g: 0,
      fat_g: 0,
      data_source: "verified_database",
      is_estimate: false,
      confidence: 0.9,
    },
    {
      logged_at: `${day}T19:00:00Z`,
      calories: 500,
      protein_g: 60,
      carbs_g: 0,
      fat_g: 0,
      data_source: "verified_database",
      is_estimate: false,
      confidence: 0.9,
    },
  ];
}

// A day where the first meal carries MOST of the day's protein — the
// opposite pattern; total is still a shortfall (150g vs 200g target).
function shortfallDayHighFirstMeal(day: string): FoodEntryLite[] {
  return [
    {
      logged_at: `${day}T07:00:00Z`,
      calories: 700,
      protein_g: 100,
      carbs_g: 0,
      fat_g: 0,
      data_source: "verified_database",
      is_estimate: false,
      confidence: 0.9,
    },
    {
      logged_at: `${day}T19:00:00Z`,
      calories: 400,
      protein_g: 50,
      carbs_g: 0,
      fat_g: 0,
      data_source: "verified_database",
      is_estimate: false,
      confidence: 0.9,
    },
  ];
}

function build(days: readonly string[], builder: (day: string) => FoodEntryLite[]) {
  const entriesByDay: Record<string, FoodEntryLite[]> = {};
  for (const day of days) entriesByDay[day] = builder(day);
  return { completeDays: [...days], entriesByDay };
}

describe("detectProteinMealPosition", () => {
  it("5 shortfall days (the min floor) with a low first-meal share (~13.3%) -> surfaces", () => {
    const days = Array.from({ length: 5 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const { completeDays, entriesByDay } = build(days, shortfallDayLowFirstMeal);
    const evidence = detectProteinMealPosition({
      entriesByDay,
      completeDays,
      proteinTargetG: 200,
      proteinTargetWindowStartDay: "2026-01-01",
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.shortfallDaysEvaluated).toBe(5);
    expect(evidence!.avgFirstMealProteinSharePct).toBeCloseTo((20 / 150) * 100, 1);
    expect(evidence!.evidenceStrength).toBe("early_signal");
  });

  it("4 shortfall days (below the 5-day floor) -> null", () => {
    const days = Array.from({ length: 4 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const { completeDays, entriesByDay } = build(days, shortfallDayLowFirstMeal);
    const evidence = detectProteinMealPosition({
      entriesByDay,
      completeDays,
      proteinTargetG: 200,
      proteinTargetWindowStartDay: "2026-01-01",
    });
    expect(evidence).toBeNull();
  });

  it("first-meal share ABOVE the low-share threshold -> null (the gap isn't loaded early)", () => {
    const days = Array.from({ length: 5 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const { completeDays, entriesByDay } = build(days, shortfallDayHighFirstMeal);
    const evidence = detectProteinMealPosition({
      entriesByDay,
      completeDays,
      proteinTargetG: 200,
      proteinTargetWindowStartDay: "2026-01-01",
    });
    expect(evidence).toBeNull();
  });

  it("days that already hit target are excluded from the shortfall-day population", () => {
    const shortfallDays = Array.from(
      { length: 5 },
      (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`,
    );
    const hitDays = ["2026-07-06", "2026-07-07"];
    const entriesByDay: Record<string, FoodEntryLite[]> = {};
    for (const day of shortfallDays) entriesByDay[day] = shortfallDayLowFirstMeal(day);
    for (const day of hitDays) {
      entriesByDay[day] = [
        {
          logged_at: `${day}T07:00:00Z`,
          calories: 900,
          protein_g: 5,
          carbs_g: 0,
          fat_g: 0,
          data_source: "verified_database",
          is_estimate: false,
          confidence: 0.9,
        },
        {
          logged_at: `${day}T13:00:00Z`,
          calories: 900,
          protein_g: 200,
          carbs_g: 0,
          fat_g: 0,
          data_source: "verified_database",
          is_estimate: false,
          confidence: 0.9,
        },
      ]; // 205g total, hits the 200g target -> excluded regardless of its own first-meal share
    }
    const completeDays = [...shortfallDays, ...hitDays];
    const evidence = detectProteinMealPosition({
      entriesByDay,
      completeDays,
      proteinTargetG: 200,
      proteinTargetWindowStartDay: "2026-01-01",
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.shortfallDaysEvaluated).toBe(5); // not 7
  });

  it("null target or null window-start day -> null", () => {
    const days = Array.from({ length: 5 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const { completeDays, entriesByDay } = build(days, shortfallDayLowFirstMeal);
    expect(
      detectProteinMealPosition({
        entriesByDay,
        completeDays,
        proteinTargetG: null,
        proteinTargetWindowStartDay: "2026-01-01",
      }),
    ).toBeNull();
    expect(
      detectProteinMealPosition({
        entriesByDay,
        completeDays,
        proteinTargetG: 200,
        proteinTargetWindowStartDay: null,
      }),
    ).toBeNull();
  });

  it("days before the target-window start are excluded, matching protein_adherence's own target-window safety", () => {
    const days = Array.from({ length: 5 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const { completeDays, entriesByDay } = build(days, shortfallDayLowFirstMeal);
    const evidence = detectProteinMealPosition({
      entriesByDay,
      completeDays,
      proteinTargetG: 200,
      proteinTargetWindowStartDay: "2026-07-10", // after all 5 fixture days
    });
    expect(evidence).toBeNull();
  });
});
