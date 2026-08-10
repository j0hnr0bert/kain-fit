// Quantitative protein action generator (2026-08-09 recalibration, Task 3).
//
// Problem: the previous negative-direction takeaway was one fixed sentence
// ("A modest, steady increase across your usual meals would close most of
// this gap over time.") regardless of whether the measured shortfall was
// 5g or 90g — for a 58g/day shortfall specifically, "modest" and "steady
// increase" understate what closing that gap actually requires, and for a
// 5g shortfall the same sentence overstates it. This module translates a
// measured averageShortfallG into language proportional to that magnitude,
// using the PROTEIN_ACTION_* bands in kain-signal-config.ts.
//
// This never issues a same-day/real-time instruction (no "today", no "next
// meal", no "your dinner") — that boundary belongs to Coaching Card (see
// kain-signal-copy.ts's copy-ownership comment). It names a magnitude and a
// shape (how many meals, roughly how much), not a specific meal or moment.
//
// Per-meal math for the "large" band: splitting a shortfall across two
// meals means each meal needs roughly shortfall/2 grams. That's rounded to
// the nearest 5g and presented as a small range (that value and 5g below)
// rather than a single falsely-precise number — e.g. a 58g shortfall splits
// to ~29g/meal, rounded to 30, presented as "25-30g".

import {
  PROTEIN_ACTION_LARGE_MAX_G,
  PROTEIN_ACTION_MODEST_MAX_G,
  PROTEIN_ACTION_SMALL_MAX_G,
  PROTEIN_ACTION_SUBSTANTIAL_MAX_G,
} from "./kain-signal-config";

function roundToNearest5(value: number): number {
  return Math.round(value / 5) * 5;
}

export function generateProteinAction(shortfallG: number): string {
  const g = Math.round(shortfallG);

  if (g <= 0) {
    return "You're already averaging at or above target — no gap to close right now.";
  }

  if (g <= PROTEIN_ACTION_SMALL_MAX_G) {
    return `Adding about ${g}g of protein somewhere in your day would usually close the gap.`;
  }

  if (g <= PROTEIN_ACTION_MODEST_MAX_G) {
    return `A single modest addition — roughly ${g}g of protein — would close most of this gap.`;
  }

  if (g <= PROTEIN_ACTION_SUBSTANTIAL_MAX_G) {
    return `Try one substantial protein addition, or split about ${g}g across two meals.`;
  }

  if (g <= PROTEIN_ACTION_LARGE_MAX_G) {
    const perMealHigh = Math.max(5, roundToNearest5(g / 2));
    const perMealLow = Math.max(5, perMealHigh - 5);
    return `Try adding roughly ${perMealLow}-${perMealHigh}g of protein to two meals.`;
  }

  return "Closing a gap this size usually takes a change at the meal level — a dedicated protein-focused meal, or swapping a low-protein one for a higher-protein option — rather than a single addition.";
}
