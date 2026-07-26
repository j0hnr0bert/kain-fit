// Copy generation, fully separate from evidence/detection/ranking — the
// same split coaching-card-content.tsx uses relative to coaching.ts. Every
// function here is a pure template: it reads only fields already present
// on the evidence object it's given and never invents a number, a cause,
// or a claim the evidence doesn't support.
//
// This module IS the "LLM rendering" seam from the KainSignal architecture
// (raw evidence -> ... -> insight ranking -> recommendation mapping -> LLM
// rendering -> copy). Phase 1 implements that final stage as a
// deterministic template renderer rather than a live model call: same
// contract (structured evidence in, copy out, no new facts), zero
// nondeterminism, fully unit-testable — a real model could later replace
// this module's internals as a drop-in without any upstream stage
// changing, as long as it obeys the same "never invent evidence" contract.
//
// Approved-voice / prohibited-language enforcement: kain-signal-copy.test.ts
// scans every string this module can produce against a banned-word list
// (always, never, failed, guaranteed, caused, will result in) so "no
// unsupported claims" is a CI-checked invariant, not just a style
// guideline.

import type { EvidenceStrength, InsightEvidence } from "./kain-signal-types";
import type { RankedCandidate } from "./kain-signal-ranking";

export type SignalCardContent = {
  headline: string;
  observation: string;
  oneBetterMove: string;
  whyThis: string;
};

// The doctrine's own three canonical strength-label sentences, used
// verbatim as the card headline — never paraphrased per detector, so the
// same three phrases always mean the same thing across every insight type.
export function describeAssociation(strength: EvidenceStrength): string {
  switch (strength) {
    case "early_signal":
      return "An early pattern may be forming.";
    case "clear_signal":
      return "A clear pattern is emerging.";
    case "strong_signal":
      return "This is one of your strongest nutrition patterns.";
  }
}

export function proteinAdherenceCopy(
  evidence: Extract<InsightEvidence, { insightType: "protein_adherence" }>,
): SignalCardContent {
  const adherencePct = Math.round(evidence.adherenceRate * 100);
  return {
    headline: describeAssociation(evidence.evidenceStrength),
    observation: `Across your last ${evidence.daysEvaluated} complete days, you reached your ${evidence.proteinTargetG}g protein target on ${evidence.daysAtOrAboveTarget} of them.`,
    oneBetterMove: `Keep prioritizing protein at each meal — it's been working on ${adherencePct}% of your recent complete days.`,
    whyThis: `${evidence.daysAtOrAboveTarget} of your last ${evidence.daysEvaluated} complete days met your ${evidence.proteinTargetG}g protein target — that's why this pattern was surfaced.`,
  };
}

export function loggingConsistencyCopy(
  evidence: Extract<InsightEvidence, { insightType: "logging_consistency" }>,
): SignalCardContent {
  const streakNote =
    evidence.currentStreak > 0
      ? `, including a current streak of ${evidence.currentStreak} day${evidence.currentStreak === 1 ? "" : "s"}`
      : "";
  return {
    headline: describeAssociation(evidence.evidenceStrength),
    observation: `You've logged on ${evidence.activeDays} of your last ${evidence.windowDays} days${streakNote}.`,
    oneBetterMove: "Log today to keep this pattern going.",
    whyThis: `${evidence.activeDays} active days out of your last ${evidence.windowDays} — that consistency is why this pattern was surfaced.`,
  };
}

export function validSilenceCopy(): SignalCardContent {
  return {
    headline: "Nothing urgent today.",
    observation: "No new pattern stood out today.",
    oneBetterMove: "Keep logging normally — KainFit will continue learning from your history.",
    whyThis:
      "Your existing patterns are holding steady, and nothing new cleared the bar to show today.",
  };
}

export function signalCardCopy(ranked: RankedCandidate | null): SignalCardContent {
  if (ranked === null) return validSilenceCopy();
  return ranked.evidence.insightType === "protein_adherence"
    ? proteinAdherenceCopy(ranked.evidence)
    : loggingConsistencyCopy(ranked.evidence);
}
