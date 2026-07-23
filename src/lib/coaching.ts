// Pure coaching decision logic — see .lovable/evidence-engine.md for the
// full spec and the reasoning behind this exact hierarchy. This file only
// decides WHAT to show (a leaf, or nothing); wording/variations live at
// the call site, matching Behavior Engine's separation of logic and voice.
//
// Locked hierarchy (2026-07-23): Recovery > Guide > Celebrate > Reinforce
// > Milestones > Silence, with a short-lived transient override that lets
// a just-completed Celebrate jump ahead of Guide. The override is consumed
// deterministically (see the state machine below), not after a fixed
// number of renders or a timer — see the 2026-07-23 audit note in the
// Sprint 01 summary for why the original setTimeout-based version was
// replaced. Milestones and Monthly Reinforce are out of scope for Sprint
// 01 — see the spec's scope note for why.

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

// ---- Transient-override state machine ----
//
// The override in evaluateCoaching (STEP 0) is armed by `transientCelebrate`
// and must be consumed exactly once, deterministically — not after some
// number of renders or some amount of wall-clock time. These three
// functions are the entire mechanism; the caller (today.tsx) only needs to
// invoke them at the right two moments (a confirmed save, and an observed
// "celebrate" result) and hold the result in one piece of state. Framework-
// agnostic on purpose, so the transition logic is unit-testable without a
// component-rendering harness.

export type CelebrationState = {
  /** Armed for exactly one save's worth of evaluations — cleared the first
   * time a "celebrate" result is actually observed, however many renders
   * that takes, however many unrelated renders happen first. */
  transientCelebrate: boolean;
  /** Persists (via localStorage in the caller) for the rest of the Manila
   * day once any Celebrate — override or steady-state — has been shown. */
  celebratedToday: boolean;
};

export function createInitialCelebrationState(): CelebrationState {
  return { transientCelebrate: false, celebratedToday: false };
}

// Call once, synchronously, right after a save is confirmed to have caused
// a fresh transition into "both macros met" (see saveCausedCelebration).
export function markSaveCompletedCelebrate(state: CelebrationState): CelebrationState {
  return { ...state, transientCelebrate: true };
}

// Call from an effect keyed on the evaluated CoachingResult's kind. Only
// mutates state the first time it observes "celebrate" for a given arming —
// every call after that (whether from an unrelated rerender that still
// computes "celebrate", or a genuine second call after consumption) is a
// no-op that returns the same object reference, so callers can safely call
// this on every render without introducing extra state updates.
export function consumeCelebrateIfShown(
  state: CelebrationState,
  resultKind: CoachingResult["kind"],
): CelebrationState {
  if (resultKind !== "celebrate") return state;
  if (!state.transientCelebrate && state.celebratedToday) return state;
  return { transientCelebrate: false, celebratedToday: true };
}

// Pure transition check for "did this specific save close out both macro
// targets for the first time today?" — kept separate from the React save
// handler so the actual arming condition is unit-testable. A save that
// fails never reaches the call site that feeds this function real deltas,
// so pre === post (no macro change) is the correct model for "failed save"
// here, not a special case.
export function saveCausedCelebration(input: {
  targetsActive: boolean;
  preProteinRemaining: number;
  preCaloriesRemaining: number;
  postProteinRemaining: number;
  postCaloriesRemaining: number;
}): boolean {
  if (!input.targetsActive) return false;
  const preMet = input.preProteinRemaining <= 0 && input.preCaloriesRemaining <= 0;
  const postMet = input.postProteinRemaining <= 0 && input.postCaloriesRemaining <= 0;
  return !preMet && postMet;
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
