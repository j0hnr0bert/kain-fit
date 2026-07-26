// "Reasonably complete day" heuristic. Deliberately NOT a meal-count model
// — KainFit users may eat one large meal, two meals, several small ones, or
// follow a restricted eating window, and this must not incorrectly
// penalize any of them. A day counts as reasonably complete when it has at
// least one entry, the day's total calories clear a plausibility floor
// (rules out a single stray low-calorie snack being mistaken for the whole
// day), and most of that day's entries are trustworthy enough to reason
// about.
//
// Worked examples:
//   OMAD: one 1,800 kcal verified dinner, nothing else
//     -> entryCount=1, totalCalories=1800 (>=300), lowTrustShare=0 -> complete
//   One 80 kcal "estimated" snack, nothing else
//     -> totalCalories=80 (<300) -> not complete (below the calorie floor)
//   3 entries, 2 of them Low Trust (lowTrustShare=0.667, >=0.5)
//     -> not complete (below the trust floor), even though entryCount=3

import { sumNutrients } from "./nutrient-totals";
import { manilaDay } from "./retention";
import { classifyEntryConfidence } from "./kain-signal-confidence";
import {
  MAX_LOW_TRUST_SHARE_FOR_COMPLETE_DAY,
  MIN_CALORIES_FOR_COMPLETE_DAY,
} from "./kain-signal-config";
import type { FoodEntryLite } from "./kain-signal-types";

export type DayCompleteness = {
  day: string;
  entryCount: number;
  totalCalories: number;
  lowTrustShare: number;
  isReasonablyComplete: boolean;
};

export function classifyDayCompleteness(
  day: string,
  entriesForDay: readonly FoodEntryLite[],
): DayCompleteness {
  const totals = sumNutrients(entriesForDay);
  const entryCount = entriesForDay.length;
  const lowTrustCount = entriesForDay.filter(
    (e) => classifyEntryConfidence(e) === "low_trust",
  ).length;
  const lowTrustShare = entryCount > 0 ? lowTrustCount / entryCount : 0;
  const isReasonablyComplete =
    entryCount >= 1 &&
    totals.calories >= MIN_CALORIES_FOR_COMPLETE_DAY &&
    lowTrustShare < MAX_LOW_TRUST_SHARE_FOR_COMPLETE_DAY;
  return { day, entryCount, totalCalories: totals.calories, lowTrustShare, isReasonablyComplete };
}

export function computeDaysCompleteness(
  entries: readonly FoodEntryLite[],
): Record<string, DayCompleteness> {
  const byDay = new Map<string, FoodEntryLite[]>();
  for (const entry of entries) {
    const day = manilaDay(entry.logged_at);
    const existing = byDay.get(day);
    if (existing) {
      existing.push(entry);
    } else {
      byDay.set(day, [entry]);
    }
  }
  const result: Record<string, DayCompleteness> = {};
  for (const [day, dayEntries] of byDay) {
    result[day] = classifyDayCompleteness(day, dayEntries);
  }
  return result;
}
