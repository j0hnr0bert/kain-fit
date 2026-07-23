// Shared deterministic nutrient totaling.
//
// Every surface that shows daily calories/protein/carbs/fat MUST use this
// function so Today, History, and any future report cannot disagree with
// each other. The math is a straight sum over stored per-entry values —
// no AI, no rounding drift, no floating-point re-derivation from per-100g.

export type NutrientEntry = {
  calories: number | string | null | undefined;
  protein_g: number | string | null | undefined;
  carbs_g: number | string | null | undefined;
  fat_g: number | string | null | undefined;
};

export type NutrientTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function sumNutrients(entries: readonly NutrientEntry[]): NutrientTotals {
  return entries.reduce<NutrientTotals>(
    (acc, e) => ({
      calories: acc.calories + num(e.calories),
      protein: acc.protein + num(e.protein_g),
      carbs: acc.carbs + num(e.carbs_g),
      fat: acc.fat + num(e.fat_g),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}
