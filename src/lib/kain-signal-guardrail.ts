// Contradiction guardrail (2026-08-08 recalibration, Phase 11). A final
// validation layer that runs AFTER evidence is computed and copy is
// rendered, comparing the two directly — this is defense in depth, not the
// primary fix. The primary fix is that detectProteinAdherence now computes
// an explicit direction/directionTier from attainment percentage
// (kain-signal-detector-protein.ts) and proteinAdherenceCopy branches on it
// (kain-signal-copy.ts), so under normal operation this guardrail should
// never actually reject anything. It exists because upstream logic being
// correct today doesn't guarantee it stays correct — a future edit to the
// copy templates, a bug in the direction classifier, or a legacy row
// persisted before this recalibration could all reintroduce the exact
// production bug this module is named after (a 2-of-15-days / ~13%
// hit-rate pattern rendered as "one of your strongest nutrition patterns").
//
// Scope: only protein_adherence can currently produce a contradiction —
// logging_consistency's evidence is structurally always positive (see its
// type comment) and milestone copy is a fixed lookup table with no
// evidence-driven sentiment, so there's nothing for this guardrail to
// catch for either. validateSignalCopy still runs for all insight types so
// a future insight type with a real direction axis is covered
// automatically rather than needing this file edited again.

import type { InsightEvidence } from "./kain-signal-types";
import type { SignalCardContent } from "./kain-signal-copy";

// Phrases that assert a strong, positive, established habit. These may
// only appear in copy generated from direction === "positive" evidence.
const POSITIVE_HABIT_PHRASES = [
  "strongest nutrition pattern",
  "strongest positive pattern",
  "strong habit",
  "workable habit",
  "consistently hitting",
  "consistent habit",
  "mastered this habit",
  "crushing it",
];

// Phrases that assert a clear negative pattern/gap. These may only appear
// in copy generated from direction === "negative" evidence — guards the
// symmetric mistake (calling a genuinely positive pattern a "gap").
const NEGATIVE_GAP_PHRASES = ["clearest nutrition gap", "consistent gap", "struggling with"];

export type GuardrailResult = { passes: true } | { passes: false; reasons: string[] };

function fullText(content: SignalCardContent): string {
  return [
    content.headline,
    content.observation,
    content.evidence,
    content.whyItMatters,
    content.takeaway,
  ]
    .join(" \n ")
    .toLowerCase();
}

function containsAny(haystack: string, phrases: readonly string[]): string[] {
  return phrases.filter((p) => haystack.includes(p));
}

// Only protein_adherence has a real per-instance direction axis today (see
// the module header) — this function is still evidence-typed generically
// (not narrowed to that one insightType) so a future direction-bearing
// insight type is covered without editing this file.
export function evaluateSignalCopy(
  evidence: InsightEvidence,
  content: SignalCardContent,
): GuardrailResult {
  const reasons: string[] = [];
  const text = fullText(content);

  if (evidence.insightType === "protein_adherence") {
    const { direction, adherenceRate, averageAttainmentPct } = evidence;

    if (direction !== "positive") {
      const hits = containsAny(text, POSITIVE_HABIT_PHRASES);
      if (hits.length > 0) {
        reasons.push(
          `direction="${direction}" but copy contains positive-habit language: ${hits.join(", ")}`,
        );
      }
    }
    // Explicit, redundant with the direction check above by design (see
    // Phase 11 of the recalibration spec) — a low hit rate must never
    // co-occur with positive-habit language, independent of how direction
    // was computed.
    if (adherenceRate < 0.5) {
      const hits = containsAny(text, POSITIVE_HABIT_PHRASES);
      if (hits.length > 0) {
        reasons.push(
          `adherenceRate=${(adherenceRate * 100).toFixed(0)}% (<50%) but copy contains positive-habit language: ${hits.join(", ")}`,
        );
      }
    }
    if (averageAttainmentPct < 80 && direction === "positive") {
      reasons.push(
        `averageAttainmentPct=${averageAttainmentPct.toFixed(1)} (<80) cannot be classified as positive — evidence object itself is contradictory`,
      );
    }
    if (direction !== "negative") {
      const hits = containsAny(text, NEGATIVE_GAP_PHRASES);
      if (hits.length > 0) {
        reasons.push(
          `direction="${direction}" but copy contains negative-gap language: ${hits.join(", ")}`,
        );
      }
    }
  }

  return reasons.length > 0 ? { passes: false, reasons } : { passes: true };
}

export function passesContradictionGuardrail(
  evidence: InsightEvidence,
  content: SignalCardContent,
): boolean {
  return evaluateSignalCopy(evidence, content).passes;
}
