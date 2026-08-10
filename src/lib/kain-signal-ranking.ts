// Picks which candidate insight matters most today — or confirms nothing
// does, which is a valid, intentional outcome (the doctrine's "silence
// state"), never filled with generic filler copy.
//
// rankScore = (evidenceStrengthBaseScore * insightValueMultiplier)
//           + insightTypePriorityTiebreak
//           - (NOT_QUITE_PENALTY_PER_OCCURRENCE * recentNotQuiteCount)
//
// 2026-08-10 insight-quality upgrade: evidenceStrengthBaseScore alone used
// to BE rankScore's dominant term (see the tie/suppression/downweight
// examples below, all still true) — but sample size and "is this actually
// worth saying" are different questions (see kain-signal-insight-value.ts).
// insightValueMultiplier (novelty x actionability) now scales the base
// score instead of sitting alongside it, so a high-novelty early_signal
// candidate can genuinely outrank a low-novelty strong_signal one, not just
// nudge a tie — see kain-signal-ranking.test.ts's Case 8-style multi-
// candidate test. It's still a multiplier, not a replacement: zero
// evidence is still zero rankScore regardless of novelty, and it never
// touches the suppression or not-quite-penalty logic below.
//
// A permanent "don't use this" marks a candidate suppressed — it's still
// returned (for audit/debugging visibility) but selectTopInsight always
// skips it, never just for today.
//
// Worked examples (used verbatim in the test suite):
//   (a) tie: both clear_signal (base 2), same insight-value multiplier ->
//       protein 2.1x beats logging 2.0x via the type tiebreak alone.
//   (b) permanent suppression: protein has a "dont_use_this" -> excluded
//       entirely; logging (strong_signal, 3.0x) wins alone.
//   (c) downweight flips the winner: logging is strong_signal (3.0) but
//       has two recent "not_quite" (3.0 - 1.5*2 = 0.0); protein is only
//       clear_signal (2.1) but has none -> protein wins despite the lower
//       raw evidence strength.
//   (d) novelty flips a sample-size-only comparison: a high-novelty,
//       high-actionability early_signal candidate (1 * 1.5 * 1.3 = 1.95)
//       outranks a low-novelty, low-actionability strong_signal candidate
//       (3 * 0.6 * 0.8 = 1.44) — sample size alone no longer wins.

import {
  EVIDENCE_STRENGTH_BASE_SCORE,
  INSIGHT_TYPE_PRIORITY_TIEBREAK,
  NOT_QUITE_PENALTY_PER_OCCURRENCE,
} from "./kain-signal-config";
import { insightValueMultiplier, passesInsightValueFloor } from "./kain-signal-insight-value";
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
      EVIDENCE_STRENGTH_BASE_SCORE[evidence.evidenceStrength] * insightValueMultiplier(evidence) +
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

// Phase 12 ("Don't force a signal"): a candidate can be ranked, unsuppressed
// by feedback, and still not be worth showing — see
// kain-signal-insight-value.ts's passesInsightValueFloor. A low-novelty
// candidate below strong_signal evidence is filtered out here exactly like
// a suppressed one, which is what makes "silence beats a mediocre insight"
// an enforced outcome rather than a design intention: if every remaining
// candidate is boring, this returns null, same as an empty ranked list.
export function selectTopInsight(ranked: readonly RankedCandidate[]): RankedCandidate | null {
  const eligible = ranked.filter((c) => !c.suppressed && passesInsightValueFloor(c.evidence));
  return eligible.length > 0 ? eligible[0] : null;
}
