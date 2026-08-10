import { describe, it, expect } from "vitest";
import { detectTrendShift } from "../kain-signal-detector-trend-shift";
import type { FoodEntryLite } from "../kain-signal-types";

function entry(day: string, proteinG: number): FoodEntryLite {
  return {
    logged_at: `${day}T12:00:00Z`,
    calories: Math.max(proteinG * 4, 400),
    protein_g: proteinG,
    carbs_g: 0,
    fat_g: 0,
    data_source: "verified_database",
    is_estimate: false,
    confidence: 0.9,
  };
}

function build(dailyGrams: readonly number[], startDay = "2026-07-01") {
  const completeDays = dailyGrams.map((_, i) => {
    const d = new Date(`${startDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const entriesByDay: Record<string, FoodEntryLite[]> = {};
  completeDays.forEach((day, i) => (entriesByDay[day] = [entry(day, dailyGrams[i])]));
  return { completeDays, entriesByDay };
}

const TARGET = 150;

describe("detectTrendShift", () => {
  it("the worked example: prior 5 days ~74.9% attainment, recent 5 days ~94.9% -> a 20pp positive shift", () => {
    const prior = [110, 115, 105, 120, 112];
    const recent = [140, 145, 135, 150, 142];
    const { completeDays, entriesByDay } = build([...prior, ...recent]);
    const evidence = detectTrendShift({
      entriesByDay,
      completeDays,
      proteinTargetG: TARGET,
      proteinTargetWindowStartDay: "2026-01-01",
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.direction).toBe("positive");
    expect(evidence!.avgAttainmentPctPrior).toBeCloseTo(74.93, 1);
    expect(evidence!.avgAttainmentPctRecent).toBeCloseTo(94.93, 1);
    expect(evidence!.deltaPct).toBeCloseTo(20, 1);
    expect(evidence!.evidenceStrength).toBe("early_signal"); // 10 total >= early(10), < clear(15)
  });

  it("a decline (recent worse than prior) -> direction negative", () => {
    const prior = [140, 145, 135, 150, 142]; // ~94.9%
    const recent = [110, 115, 105, 120, 112]; // ~74.9%
    const { completeDays, entriesByDay } = build([...prior, ...recent]);
    const evidence = detectTrendShift({
      entriesByDay,
      completeDays,
      proteinTargetG: TARGET,
      proteinTargetWindowStartDay: "2026-01-01",
    });
    expect(evidence!.direction).toBe("negative");
    expect(evidence!.deltaPct).toBeLessThan(0);
  });

  it("a small shift below TREND_SHIFT_MIN_DELTA_PCT -> null (not worth noticing)", () => {
    const prior = [130, 132, 128, 131, 129]; // ~86.7%
    const recent = [133, 135, 131, 134, 132]; // ~88.7%, only ~2pp higher
    const { completeDays, entriesByDay } = build([...prior, ...recent]);
    const evidence = detectTrendShift({
      entriesByDay,
      completeDays,
      proteinTargetG: TARGET,
      proteinTargetWindowStartDay: "2026-01-01",
    });
    expect(evidence).toBeNull();
  });

  it("fewer than 10 qualified days -> null", () => {
    const dailyGrams = [140, 145, 135, 150, 142, 110, 115, 105, 120]; // 9 days
    const { completeDays, entriesByDay } = build(dailyGrams);
    const evidence = detectTrendShift({
      entriesByDay,
      completeDays,
      proteinTargetG: TARGET,
      proteinTargetWindowStartDay: "2026-01-01",
    });
    expect(evidence).toBeNull();
  });

  it("null target or null window-start day -> null", () => {
    const dailyGrams = [110, 115, 105, 120, 112, 140, 145, 135, 150, 142];
    const { completeDays, entriesByDay } = build(dailyGrams);
    expect(
      detectTrendShift({
        entriesByDay,
        completeDays,
        proteinTargetG: null,
        proteinTargetWindowStartDay: "2026-01-01",
      }),
    ).toBeNull();
    expect(
      detectTrendShift({
        entriesByDay,
        completeDays,
        proteinTargetG: TARGET,
        proteinTargetWindowStartDay: null,
      }),
    ).toBeNull();
  });

  it("only compares the two most recent qualified windows — an earlier target-window day never leaks into the comparison", () => {
    // 5 "old" pre-window days that would otherwise sit right before the
    // prior window and change its average — excluded by windowStart.
    const oldDays = [60, 65, 55, 62, 58];
    const prior = [110, 115, 105, 120, 112];
    const recent = [140, 145, 135, 150, 142];
    const { completeDays, entriesByDay } = build([...oldDays, ...prior, ...recent], "2026-06-20");
    // windowStart is exactly the first day of `prior` (index 5 of the
    // 15-day run starting 2026-06-20 -> 2026-06-25).
    const evidence = detectTrendShift({
      entriesByDay,
      completeDays,
      proteinTargetG: TARGET,
      proteinTargetWindowStartDay: "2026-06-25",
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.avgAttainmentPctPrior).toBeCloseTo(74.93, 1); // unaffected by the 5 old days
  });
});
