// Phase-1 detector #2 (the doctrine's own #2 opening domain): how often
// does the user log, over the lookback window? Reuses computeCurrentStreak
// from retention.ts directly rather than reimplementing streak math — this
// module only adds the window-level consistency rate and longest-gap
// measurement on top of it.
//
// Worked example (used verbatim in the test suite): windowDays=60,
// 22 distinct active days in that window -> consistencyRate=22/60≈0.367,
// 22 >= strong:21 -> evidenceStrength='strong_signal'.

import { addDaysISO, computeCurrentStreak } from "./retention";
import { classifyEvidenceStrength } from "./kain-signal-evidence-strength";
import type { LoggingConsistencyEvidence } from "./kain-signal-types";

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86_400_000);
}

// Longest run of consecutive inactive days inside [windowStart, windowEnd],
// including the leading/trailing gaps before the first and after the last
// active day in the window. A day is a "gap day" only if it falls strictly
// between two dated boundaries — e.g. active on day X, next active X+3 ->
// gap=2 (X+1 and X+2 are the inactive days in between).
function longestGapDays(
  activeDaysInWindow: readonly string[],
  windowStart: string,
  windowEnd: string,
): number {
  const sorted = [...activeDaysInWindow].sort();
  if (sorted.length === 0) return daysBetween(windowStart, windowEnd);
  let maxGap = daysBetween(windowStart, sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    maxGap = Math.max(maxGap, daysBetween(sorted[i - 1], sorted[i]) - 1);
  }
  maxGap = Math.max(maxGap, daysBetween(sorted[sorted.length - 1], windowEnd));
  return maxGap;
}

export function detectLoggingConsistency(input: {
  activeDays: readonly string[];
  todayManila: string;
  windowDays: number;
}): LoggingConsistencyEvidence | null {
  const windowStart = addDaysISO(input.todayManila, -(input.windowDays - 1));
  const uniqueActiveInWindow = Array.from(new Set(input.activeDays)).filter(
    (d) => d >= windowStart && d <= input.todayManila,
  );
  const activeDaysCount = uniqueActiveInWindow.length;

  const evidenceStrength = classifyEvidenceStrength("logging_consistency", activeDaysCount);
  if (evidenceStrength === null) return null;

  return {
    insightType: "logging_consistency",
    windowDays: input.windowDays,
    activeDays: activeDaysCount,
    consistencyRate: input.windowDays > 0 ? activeDaysCount / input.windowDays : 0,
    currentStreak: computeCurrentStreak(input.activeDays, input.todayManila),
    longestGapDays: longestGapDays(uniqueActiveInWindow, windowStart, input.todayManila),
    evidenceStrength,
  };
}
