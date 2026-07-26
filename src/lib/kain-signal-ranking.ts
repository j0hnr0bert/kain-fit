// Picks which of the (at most two, in Phase 1) candidate insights matters
// most today — or confirms nothing does, which is a valid, intentional
// outcome (the doctrine's "silence state"), never filled with generic
// filler copy.
//
// rankScore = evidenceStrengthBaseScore + insightTypePriorityTiebreak
//           - (NOT_QUITE_PENALTY_PER_OCCURRENCE * recentNotQuiteCount)
//
// A permanent "don't use this" marks a candidate suppressed — it's still
// returned (for audit/debugging visibility) but selectTopInsight always
// skips it, never just for today.
//
// Worked examples (used verbatim in the test suite):
//   (a) tie: both clear_signal (base 2) -> protein 2.1 beats logging 2.0
//       via the type tiebreak alone.
//   (b) permanent suppression: protein has a "dont_use_this" -> excluded
//       entirely; logging (strong_signal, 3.0) wins alone.
//   (c) downweight flips the winner: logging is strong_signal (3.0) but
//       has two recent "not_quite" (3.0 - 1.5*2 = 0.0); protein is only
//       clear_signal (2.1) but has none -> protein wins despite the lower
//       raw evidence strength.

import {
  EVIDENCE_STRENGTH_BASE_SCORE,
  INSIGHT_TYPE_PRIORITY_TIEBREAK,
  NOT_QUITE_PENALTY_PER_OCCURRENCE,
} from "./kain-signal-config";
import type { InsightEvidence, InsightType } from "./kain-signal-types";

export type FeedbackSummary = { notQuiteCount: number; dontUseThisEver: boolean };

export type RankedCandidate = {
  insightType: InsightType;
  evidence: InsightEvidence;
  rankScore: number;
  suppressed: boolean;
};

export function rankInsights(
  candidates: readonly (InsightEvidence | null)[],
  feedback: Readonly<Partial<Record<InsightType, FeedbackSummary>>>,
): RankedCandidate[] {
  const ranked: RankedCandidate[] = [];
  for (const evidence of candidates) {
    if (evidence === null) continue;
    const fb = feedback[evidence.insightType] ?? { notQuiteCount: 0, dontUseThisEver: false };
    const rankScore =
      EVIDENCE_STRENGTH_BASE_SCORE[evidence.evidenceStrength] +
      INSIGHT_TYPE_PRIORITY_TIEBREAK[evidence.insightType] -
      NOT_QUITE_PENALTY_PER_OCCURRENCE * fb.notQuiteCount;
    ranked.push({
      insightType: evidence.insightType,
      evidence,
      rankScore,
      suppressed: fb.dontUseThisEver,
    });
  }
  return ranked.sort((a, b) => b.rankScore - a.rankScore);
}

export function selectTopInsight(ranked: readonly RankedCandidate[]): RankedCandidate | null {
  const eligible = ranked.filter((c) => !c.suppressed);
  return eligible.length > 0 ? eligible[0] : null;
}
