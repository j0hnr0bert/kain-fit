import { describe, it, expect } from "vitest";
import { detectProteinCalorieRelationship } from "../kain-signal-detector-protein-calorie";
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

function build(days: readonly { day: string; calories: number; protein: number }[]) {
  const completeDays = days.map((d) => d.day);
  const entriesByDay: Record<string, FoodEntryLite[]> = {};
  for (const d of days) entriesByDay[d.day] = [entry(d.day, d.calories, d.protein)];
  return { completeDays, entriesByDay };
}

const LOWER: { calories: number; protein: number } = { calories: 1500, protein: 90 };
const HIGHER: { calories: number; protein: number } = { calories: 2200, protein: 150 };

function twelveDayFixture() {
  const days = Array.from({ length: 12 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
  return build(days.map((day, i) => ({ day, ...(i < 6 ? LOWER : HIGHER) })));
}

describe("detectProteinCalorieRelationship", () => {
  it("the worked 12-day example: 6 days at 1500kcal/90g protein vs 6 days at 2200kcal/150g protein -> a 60g gap, exactly at the day-count floor", () => {
    const { completeDays, entriesByDay } = twelveDayFixture();
    const evidence = detectProteinCalorieRelationship({ entriesByDay, completeDays });
    expect(evidence).not.toBeNull();
    expect(evidence!.daysEvaluated).toBe(12);
    expect(evidence!.lowerCalorieDayCount).toBe(6);
    expect(evidence!.higherCalorieDayCount).toBe(6);
    expect(evidence!.avgProteinLowerGroup).toBeCloseTo(90, 5);
    expect(evidence!.avgProteinHigherGroup).toBeCloseTo(150, 5);
    expect(evidence!.proteinGapG).toBeCloseTo(60, 5);
    expect(evidence!.evidenceStrength).toBe("early_signal"); // 12 >= early(12), < clear(18)
  });

  it("fewer than 12 complete days -> null, even with a large gap", () => {
    const days = Array.from({ length: 11 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const { completeDays, entriesByDay } = build(
      days.map((day, i) => ({ day, ...(i < 5 ? LOWER : HIGHER) })),
    );
    expect(detectProteinCalorieRelationship({ entriesByDay, completeDays })).toBeNull();
  });

  it("a real but small gap (below PROTEIN_CALORIE_MIN_GAP_G) -> null, not worth a sentence", () => {
    const days = Array.from({ length: 12 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const { completeDays, entriesByDay } = build(
      days.map((day, i) => ({
        day,
        calories: i < 6 ? 1500 : 2200,
        protein: i < 6 ? 140 : 145, // 5g gap, below the 15g floor
      })),
    );
    expect(detectProteinCalorieRelationship({ entriesByDay, completeDays })).toBeNull();
  });

  it("protein HIGHER on lower-calorie days (the reverse pattern) is not surfaced by this detector", () => {
    const days = Array.from({ length: 12 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const { completeDays, entriesByDay } = build(
      days.map((day, i) => ({
        day,
        calories: i < 6 ? 1500 : 2200,
        protein: i < 6 ? 150 : 90, // protein is HIGHER on the lower-calorie days
      })),
    );
    expect(detectProteinCalorieRelationship({ entriesByDay, completeDays })).toBeNull();
  });

  it("identical calories every day -> degenerate split (one group empty) -> null", () => {
    const days = Array.from({ length: 14 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const { completeDays, entriesByDay } = build(
      days.map((day) => ({ day, calories: 1800, protein: 120 })),
    );
    expect(detectProteinCalorieRelationship({ entriesByDay, completeDays })).toBeNull();
  });

  it("18 days (the clear_signal boundary) with the same 60g gap -> clear_signal", () => {
    const days = Array.from({ length: 18 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const { completeDays, entriesByDay } = build(
      days.map((day, i) => ({ day, ...(i < 9 ? LOWER : HIGHER) })),
    );
    const evidence = detectProteinCalorieRelationship({ entriesByDay, completeDays });
    expect(evidence!.evidenceStrength).toBe("clear_signal");
  });
});
