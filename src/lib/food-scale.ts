// Client-safe helper for scaling per-100g nutrition to an arbitrary gram amount
// or common-serving multiplier. Kept dependency-free so it works in both the
// browser log UI and server functions.

export type Per100g = {
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g?: number | null;
  sodium_mg_per_100g?: number | null;
};

export type ScaledMacros = {
  grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  sodium_mg: number | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Scale a per-100 g nutrient row to an arbitrary gram amount. */
export function scaleMacros(record: Per100g, grams: number): ScaledMacros {
  const g = Number.isFinite(grams) && grams > 0 ? grams : 0;
  const factor = g / 100;
  return {
    grams: g,
    calories: Math.round(Number(record.calories_per_100g) * factor),
    protein_g: round1(Number(record.protein_per_100g) * factor),
    carbs_g: round1(Number(record.carbs_per_100g) * factor),
    fat_g: round1(Number(record.fat_per_100g) * factor),
    fiber_g:
      record.fiber_per_100g == null ? null : round1(Number(record.fiber_per_100g) * factor),
    sodium_mg:
      record.sodium_mg_per_100g == null
        ? null
        : Math.round(Number(record.sodium_mg_per_100g) * factor),
  };
}

/**
 * Given a common-serving label + grams, scale by N servings. Falls back to
 * `default_serving_grams` when common_serving_grams is missing.
 */
export function scaleByServings(
  record: Per100g,
  servings: number,
  gramsPerServing: number | null | undefined,
  fallbackGrams?: number | null,
): ScaledMacros {
  const per = Number(gramsPerServing ?? fallbackGrams ?? 100);
  return scaleMacros(record, per * servings);
}