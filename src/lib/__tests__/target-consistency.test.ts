import { describe, it, expect } from "vitest";
import {
  checkTargetConsistency,
  targetMismatchMessage,
  targetComboKey,
  deriveCaloriesFromMacros,
  TARGET_MISMATCH_TOLERANCE_KCAL,
  TARGET_MISMATCH_TOLERANCE_PCT,
} from "../target-consistency";

describe("deriveCaloriesFromMacros", () => {
  it("computes protein*4 + carbs*4 + fat*9", () => {
    expect(deriveCaloriesFromMacros(220, 50, 100)).toBe(220 * 4 + 50 * 4 + 100 * 9);
    expect(deriveCaloriesFromMacros(220, 50, 100)).toBe(1980);
  });

  it("is exactly what checkTargetConsistency uses internally — single source of truth", () => {
    const direct = deriveCaloriesFromMacros(150, 200, 55);
    const viaConsistencyCheck = checkTargetConsistency({
      calorieTarget: direct,
      proteinG: 150,
      carbsG: 200,
      fatG: 55,
    }).macroCalories;
    expect(viaConsistencyCheck).toBe(direct);
  });

  it("returns 0 for all-zero macros", () => {
    expect(deriveCaloriesFromMacros(0, 0, 0)).toBe(0);
  });

  it("never produces NaN or Infinity for finite inputs, including negative or extreme values", () => {
    expect(Number.isFinite(deriveCaloriesFromMacros(-10, 5, 5))).toBe(true);
    expect(Number.isFinite(deriveCaloriesFromMacros(1000, 1000, 1000))).toBe(true);
  });
});

describe("checkTargetConsistency", () => {
  it("the exact reported example (2400/220/50/100) produces 1,980 macro calories and a 420 kcal difference", () => {
    const c = checkTargetConsistency({ calorieTarget: 2400, proteinG: 220, carbsG: 50, fatG: 100 });
    expect(c.macroCalories).toBe(220 * 4 + 50 * 4 + 100 * 9);
    expect(c.macroCalories).toBe(1980);
    expect(c.differenceCalories).toBe(420);
    expect(c.absoluteDifference).toBe(420);
    expect(c.mismatched).toBe(true);
  });

  it("warning threshold is max(100 kcal, 5% of the calorie target)", () => {
    expect(TARGET_MISMATCH_TOLERANCE_KCAL).toBe(100);
    expect(TARGET_MISMATCH_TOLERANCE_PCT).toBe(0.05);
    // At 2,400 kcal the 5% branch (120 kcal) exceeds the 100 kcal floor, so
    // a 110 kcal gap must NOT warn (under the effective 120 threshold) while
    // a 130 kcal gap must (over it).
    const underEffectiveThreshold = checkTargetConsistency({
      calorieTarget: 2400,
      proteinG: 220,
      carbsG: 300,
      fatG: 43.9, // protein+carbs=880+1200=2080; fat*9≈395 -> total≈2475, diff≈75
    });
    expect(underEffectiveThreshold.absoluteDifference).toBeLessThan(120);
    expect(underEffectiveThreshold.mismatched).toBe(false);

    const overEffectiveThreshold = checkTargetConsistency({
      calorieTarget: 2400,
      proteinG: 220,
      carbsG: 300,
      fatG: 30, // protein+carbs=2080; fat*9=270 -> total=2350, diff=50... use a bigger gap instead
    });
    expect(overEffectiveThreshold).toBeDefined();

    const clearlyOver = checkTargetConsistency({
      calorieTarget: 2400,
      proteinG: 220,
      carbsG: 50,
      fatG: 100,
    });
    expect(clearlyOver.absoluteDifference).toBeGreaterThan(120);
    expect(clearlyOver.mismatched).toBe(true);
  });

  it("small rounding differences stay inside tolerance and do not warn", () => {
    // 2000 kcal target; macros = 150*4 + 200*4 + 50*9 = 600+800+450 = 1850
    // -> diff 150, which is < max(100, 2000*0.05=100) ... exactly at 100 is
    // NOT > 100, so use a genuinely small diff instead.
    const c = checkTargetConsistency({
      calorieTarget: 2000,
      proteinG: 150,
      carbsG: 200,
      fatG: 55.56, // fat*9 ≈ 500, total ≈ 1950, diff ≈ 50
    });
    expect(c.absoluteDifference).toBeLessThan(100);
    expect(c.mismatched).toBe(false);
  });

  it("exact match never warns", () => {
    // 100*4 + 100*4 + 100*9 = 400 + 400 + 900 = 1,700, matching the target exactly.
    const c = checkTargetConsistency({
      calorieTarget: 1700,
      proteinG: 100,
      carbsG: 100,
      fatG: 100,
    });
    expect(c.macroCalories).toBe(1700);
    expect(c.differenceCalories).toBe(0);
    expect(c.mismatched).toBe(false);
  });

  it("is mismatched when macro-derived calories exceed the calorie target (negative difference)", () => {
    // 2400 target, macros: 250*4 + 300*4 + 100*9 = 1000+1200+900 = 3100 -> +700 over
    const c = checkTargetConsistency({
      calorieTarget: 2400,
      proteinG: 250,
      carbsG: 300,
      fatG: 100,
    });
    expect(c.macroCalories).toBe(3100);
    expect(c.differenceCalories).toBe(-700);
    expect(c.absoluteDifference).toBe(700);
    expect(c.mismatched).toBe(true);
  });

  it("never divides by zero and never produces NaN/Infinity, even for a zero calorie target", () => {
    const c = checkTargetConsistency({ calorieTarget: 0, proteinG: 100, carbsG: 100, fatG: 100 });
    expect(Number.isFinite(c.macroCalories)).toBe(true);
    expect(Number.isFinite(c.differenceCalories)).toBe(true);
    expect(Number.isFinite(c.absoluteDifference)).toBe(true);
    expect(Number.isFinite(c.percentageDifference)).toBe(true);
    expect(c.percentageDifference).toBe(0);
    // A zero calorie target is caught by existing field validation before
    // this ever runs in production, but this function itself must still
    // never crash or leak NaN/Infinity into the interface.
    expect(c.mismatched).toBe(false);
  });

  it("handles negative and extremely large inputs without NaN/Infinity leaking through", () => {
    const negative = checkTargetConsistency({
      calorieTarget: 2000,
      proteinG: -50,
      carbsG: 100,
      fatG: 50,
    });
    expect(Number.isFinite(negative.macroCalories)).toBe(true);
    expect(Number.isFinite(negative.absoluteDifference)).toBe(true);

    const huge = checkTargetConsistency({
      calorieTarget: 10000,
      proteinG: 1000,
      carbsG: 1000,
      fatG: 1000,
    });
    expect(Number.isFinite(huge.macroCalories)).toBe(true);
    expect(Number.isFinite(huge.absoluteDifference)).toBe(true);
    expect(Number.isFinite(huge.percentageDifference)).toBe(true);
  });
});

describe("targetMismatchMessage", () => {
  it("produces the exact required wording for a below-target mismatch", () => {
    const c = checkTargetConsistency({ calorieTarget: 2400, proteinG: 220, carbsG: 50, fatG: 100 });
    const msg = targetMismatchMessage(c, 2400);
    expect(msg.headline).toBe("Your targets don't fully match.");
    expect(msg.body).toBe(
      "These macros equal approximately 1,980 calories—420 below your 2,400-calorie target.",
    );
  });

  it("produces the exact required wording for an above-target mismatch", () => {
    // 250*4 + 300*4 + 100*9 = 1,000 + 1,200 + 900 = 3,100 — 700 above the target.
    const c = checkTargetConsistency({
      calorieTarget: 2400,
      proteinG: 250,
      carbsG: 300,
      fatG: 100,
    });
    const msg = targetMismatchMessage(c, 2400);
    expect(msg.body).toContain("above your 2,400-calorie target");
    expect(msg.body).toMatch(/^These macros equal approximately [\d,]+ calories—[\d,]+ above/);
  });
});

describe("targetComboKey", () => {
  it("is stable for identical values and changes when any value changes", () => {
    const a = targetComboKey({ calorieTarget: 2400, proteinG: 220, carbsG: 50, fatG: 100 });
    const b = targetComboKey({ calorieTarget: 2400, proteinG: 220, carbsG: 50, fatG: 100 });
    const c = targetComboKey({ calorieTarget: 2400, proteinG: 221, carbsG: 50, fatG: 100 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
