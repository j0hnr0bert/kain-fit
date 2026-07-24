// Manual macro-target consistency check (2026-07-24). KainFit displays
// whatever calorie/protein/carb/fat targets the user manually enters — it
// never recommends or silently adjusts them (see profile.tsx's "Enter
// targets you already follow" copy). But the four numbers can disagree
// with each other by simple arithmetic (entered calories vs. what the
// entered macros actually sum to), and a user typing quickly can enter a
// combination like 2400 kcal / 220g protein / 50g carbs / 100g fat without
// noticing the macros only add up to 1,980 kcal. This module only detects
// and reports that mismatch — it never changes any value.

export type TargetConsistency = {
  /** Calories implied by the entered macro grams alone: (protein*4) +
   * (carbs*4) + (fat*9). Not rounded — callers round for display. */
  macroCalories: number;
  /** enteredCalorieTarget - macroCalories. Positive means the macros fall
   * short of the calorie target; negative means the macros exceed it. */
  differenceCalories: number;
  absoluteDifference: number;
  /** absoluteDifference / enteredCalorieTarget. 0 when enteredCalorieTarget
   * is not positive (no valid ratio to report, and mismatched is always
   * false in that case — an invalid calorie target is caught by existing
   * field validation, not this check). */
  percentageDifference: number;
  /** True when absoluteDifference exceeds the tolerance — see
   * TARGET_MISMATCH_TOLERANCE_KCAL / TARGET_MISMATCH_TOLERANCE_PCT below. */
  mismatched: boolean;
};

// No prior tolerance existed for this check anywhere in the codebase (this
// is a new check) — nothing to reconcile. Threshold picked to absorb
// rounding noise (a few kcal from rounding each gram value) while catching
// a meaningful mismatch like 420 kcal on a 2,400 kcal target.
export const TARGET_MISMATCH_TOLERANCE_KCAL = 100;
export const TARGET_MISMATCH_TOLERANCE_PCT = 0.05;

export function checkTargetConsistency(input: {
  calorieTarget: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}): TargetConsistency {
  const macroCalories = input.proteinG * 4 + input.carbsG * 4 + input.fatG * 9;
  const differenceCalories = input.calorieTarget - macroCalories;
  const absoluteDifference = Math.abs(differenceCalories);
  const percentageDifference =
    input.calorieTarget > 0 ? absoluteDifference / input.calorieTarget : 0;
  const threshold =
    input.calorieTarget > 0
      ? Math.max(
          TARGET_MISMATCH_TOLERANCE_KCAL,
          input.calorieTarget * TARGET_MISMATCH_TOLERANCE_PCT,
        )
      : TARGET_MISMATCH_TOLERANCE_KCAL;
  const mismatched = input.calorieTarget > 0 && absoluteDifference > threshold;
  return {
    macroCalories,
    differenceCalories,
    absoluteDifference,
    percentageDifference,
    mismatched,
  };
}

export type TargetMismatchCopy = { headline: string; body: string };

/**
 * Copy for the mismatch-warning dialog. Only meaningful when
 * consistency.mismatched is true — callers should not render this
 * otherwise. Numbers are rounded and thousands-formatted for display only;
 * the underlying stored values are never touched by this module.
 */
export function targetMismatchMessage(
  consistency: TargetConsistency,
  calorieTarget: number,
): TargetMismatchCopy {
  const macroRounded = Math.round(consistency.macroCalories).toLocaleString("en-US");
  const diffRounded = Math.round(consistency.absoluteDifference).toLocaleString("en-US");
  const targetRounded = Math.round(calorieTarget).toLocaleString("en-US");
  const direction = consistency.differenceCalories > 0 ? "below" : "above";
  return {
    headline: "Your targets don't fully match.",
    body: `These macros equal approximately ${macroRounded} calories—${diffRounded} ${direction} your ${targetRounded}-calorie target.`,
  };
}

/** Stable key for "has the user already confirmed this exact combination
 * of values" — used to avoid re-showing the same warning for values that
 * were already explicitly kept, without persisting anything server-side.
 * Purely a display convenience; re-entering the identical numbers later
 * (even after navigating away) will show the warning again, which is
 * correct and matches "if any target changes, recalculate." */
export function targetComboKey(input: {
  calorieTarget: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}): string {
  return `${input.calorieTarget}|${input.proteinG}|${input.carbsG}|${input.fatG}`;
}
