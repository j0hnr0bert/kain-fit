// Pure coaching decision logic — see .lovable/evidence-engine.md for the
// full spec and the reasoning behind this exact hierarchy. This file only
// decides WHAT to show (a leaf, or nothing); wording/variations live at
// the call site, matching Behavior Engine's separation of logic and voice.
//
// Locked hierarchy (2026-07-23): Recovery > Guide > Celebrate > Reinforce
// > Milestones > Silence, with a short-lived transient override that lets
// a just-completed Celebrate jump ahead of Guide for one render only.
// Milestones and Monthly Reinforce are out of scope for Sprint 01 — see
// the spec's scope note for why.

import { addDaysISO, weekStart } from "./retention";

export type CoachingResult =
  | { kind: "recover"; tier: "3-6" | "7-29" | "30+" }
  | { kind: "guide"; reason: "first-meal" | "protein-remaining" | "calories-near" }
  | { kind: "celebrate"; reason: "same-day-complete" }
  | { kind: "reinforce"; reason: "weekly-improved" }
  | { kind: "silence" };

export type CoachingInput = {
  /** Days since the most recent logged day before today. null = no prior
   * logged day within the lookback window (either genuinely new, or a
   * gap wider than the window — see the known Sprint 01 limitation in
   * the implementation summary). */
  gapDays: number | null;
  hasLoggedToday: boolean;
  targetsActive: boolean;
  /** Grams still needed to reach the protein target; <=0 means met. */
  proteinRemaining: number;
  /** kcal still needed to reach the calorie target; <=0 means met. */
  caloriesRemaining: number;
  /** "Nearly full" margin in kcal — a positive remaining amount at or
   * below this counts as "near", not "remaining". */
  calorieNearMarginKcal: number;
  /** Has the same-day-completion Celebrate already been shown once today? */
  celebratedTodayAlready: boolean;
  weekly: { thisWeekDays: number; lastWeekDays: number };
  /** True only in the render immediately following a save that caused
   * both targets to become met for the first time today. Never persisted
   * — that's what makes the override short-lived by construction. */
  justCompletedCelebrate: boolean;
};

function bothMacrosMet(input: CoachingInput): boolean {
  return input.targetsActive && input.proteinRemaining <= 0 && input.caloriesRemaining <= 0;
}

export function evaluateCoaching(input: CoachingInput): CoachingResult {
  // Transient override — scoped exception, not a reordering of the
  // standing hierarchy below. See evidence-engine.md.
  if (input.justCompletedCelebrate && bothMacrosMet(input)) {
    return { kind: "celebrate", reason: "same-day-complete" };
  }

  // 1. Recovery
  if (input.gapDays !== null && input.gapDays >= 3) {
    const tier = input.gapDays >= 30 ? "30+" : input.gapDays >= 7 ? "7-29" : "3-6";
    return { kind: "recover", tier };
  }

  // 2/3. Guide
  if (!input.hasLoggedToday) {
    return { kind: "guide", reason: "first-meal" };
  }
  if (input.targetsActive && input.proteinRemaining > 0) {
    return { kind: "guide", reason: "protein-remaining" };
  }
  if (
    input.targetsActive &&
    input.proteinRemaining <= 0 &&
    input.caloriesRemaining > 0 &&
    input.caloriesRemaining <= input.calorieNearMarginKcal
  ) {
    return { kind: "guide", reason: "calories-near" };
  }

  // 4. Celebrate (steady-state, once per day)
  if (bothMacrosMet(input) && !input.celebratedTodayAlready) {
    return { kind: "celebrate", reason: "same-day-complete" };
  }

  // 5. Reinforce (weekly only — Sprint 01 scope)
  if (input.weekly.thisWeekDays > input.weekly.lastWeekDays) {
    return { kind: "reinforce", reason: "weekly-improved" };
  }

  // Milestones: not implemented in Sprint 01.

  return { kind: "silence" };
}

// ---- Data-shaping helpers, reusing the same 60-day activeDays set the
// streak feature already fetches — no new query for gap/weekly math. ----

export function daysSinceLastActive(
  activeDays: readonly string[],
  todayManila: string,
): number | null {
  const priorDays = Array.from(new Set(activeDays)).filter((d) => d !== todayManila);
  if (priorDays.length === 0) return null;
  const mostRecent = priorDays.sort().at(-1)!;
  const todayMs = Date.parse(`${todayManila}T00:00:00Z`);
  const recentMs = Date.parse(`${mostRecent}T00:00:00Z`);
  return Math.round((todayMs - recentMs) / (24 * 60 * 60 * 1000));
}

export function weeklyLoggedDayCounts(
  activeDays: readonly string[],
  todayManila: string,
): { thisWeekDays: number; lastWeekDays: number } {
  const thisWeekStart = weekStart(todayManila);
  const lastWeekStart = addDaysISO(thisWeekStart, -7);
  let thisWeekDays = 0;
  let lastWeekDays = 0;
  for (const d of new Set(activeDays)) {
    if (d >= thisWeekStart && d <= todayManila) thisWeekDays += 1;
    else if (d >= lastWeekStart && d < thisWeekStart) lastWeekDays += 1;
  }
  return { thisWeekDays, lastWeekDays };
}
