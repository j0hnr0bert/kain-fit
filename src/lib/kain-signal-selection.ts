// Deterministic beta-safe selection policy (§8, 2026-07-27 correction):
//
//   1. newly crossed milestone
//   2. newly detected high-confidence behavioral pattern
//   3. materially changed existing pattern
//   4. meaningful improvement or regression
//   5. otherwise silence
//
// Tiers 2-5 are exactly what kain-signal-ranking.ts's rankInsights /
// selectTopInsight already compute (evidence-strength base score + the
// type tiebreak + not-quite feedback penalty) — that engine is unchanged
// by this correction. This module adds only tier 1: a present, newly-
// qualified milestone candidate (buildCandidate already excludes any
// milestone that's ever been recorded before — see
// kain-signal-detector-milestone.ts) always outranks every reveal/protect
// candidate, regardless of evidence-strength score. No randomization, no
// rotation for variety, no wording-only refresh of unchanged evidence.

import { selectTopInsight, type RankedCandidate } from "./kain-signal-ranking";
import type { EvidenceStrength, InsightEvidence } from "./kain-signal-types";

export function selectWinner(ranked: readonly RankedCandidate[]): RankedCandidate | null {
  const milestone = ranked.find((r) => r.insightType === "behavior_milestone" && !r.suppressed);
  if (milestone) return milestone;
  return selectTopInsight(ranked.filter((r) => r.insightType !== "behavior_milestone"));
}

// Module-level readiness (2026-07-27 correction): the count-gate trust bar
// (kain-signal-readiness.ts's finalizeReadiness) exists to protect PATTERN
// modules (protein_adherence, logging_consistency) from claiming a trend
// before the user has given KainFit enough overall usage to back it. It
// was never meant to gate milestones — an independently-certain lifetime
// fact, not a confidence-graded pattern — in either direction: a milestone
// must never be blocked by pattern-readiness, and must never inflate it
// either. Both callers below (kain-signal-generate.server.ts) exist so
// that boundary is enforced in one pure, testable place rather than inline
// in the orchestrator.

// Feed into finalizeReadiness's hasRepeatedPattern check — excludes
// milestone evidence so a milestone alone can never satisfy (or be
// required by) pattern-module readiness.
export function patternOnlyEvidenceStrengths(
  candidates: readonly (InsightEvidence | null)[],
): (EvidenceStrength | null)[] {
  return candidates
    .filter((c) => c?.insightType !== "behavior_milestone")
    .map((c) => c?.evidenceStrength ?? null);
}

// The pattern-only winner, used solely to decide the "connected" state
// transition — kept separate from selectWinner's milestone-first result,
// which governs today's DISPLAY/PERSISTENCE, not the lifetime state.
export function selectPatternTop(ranked: readonly RankedCandidate[]): RankedCandidate | null {
  return selectTopInsight(ranked.filter((r) => r.insightType !== "behavior_milestone"));
}
