// Copy generation, fully separate from evidence/detection/ranking — the
// same split coaching-card-content.tsx uses relative to coaching.ts. Every
// function here is a pure template: it reads only fields already present
// on the evidence object it's given and never invents a number, a cause,
// or a claim the evidence doesn't support.
//
// This module IS the "LLM rendering" seam from the KainSignal architecture
// (raw evidence -> ... -> insight ranking -> recommendation mapping -> LLM
// rendering -> copy). This is implemented as a deterministic template
// renderer rather than a live model call: same contract (structured
// evidence in, copy out, no new facts), zero nondeterminism, fully
// unit-testable — a real model could later replace this module's internals
// as a drop-in without any upstream stage changing, as long as it obeys the
// same "never invent evidence" contract.
//
// Copy Contract (KainSignal, locked 2026-07-27 correction): every rendered
// card must contain exactly these five parts — a strength headline, an
// observation, the evidence behind it, why it matters, and a takeaway.
//
// `takeaway` (not `action`): KainSignal interprets a longitudinal pattern —
// it never issues a same-day instruction. That is the Coaching Card's
// exclusive job (see coaching-card-content.ts's messageFor). A takeaway may
// interpret the behavior, name a variable that may be influencing it, or
// invite attention to a recurring condition — it must never mention
// today's remaining macros, recommend a specific next meal, or duplicate a
// Coaching Card CTA. See kain-signal-copy.test.ts's copy-ownership guards.
//
// Approved-voice / prohibited-language enforcement: kain-signal-copy.test.ts
// scans every string this module can produce against a banned-word list
// (always, never, failed, guaranteed, caused, will result in) so "no
// unsupported claims" is a CI-checked invariant, not just a style
// guideline.

import type { EvidenceStrength, InsightEvidence, MilestoneType } from "./kain-signal-types";

export type SignalCardContent = {
  headline: string;
  observation: string;
  evidence: string;
  whyItMatters: string;
  takeaway: string;
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
    evidence: `${evidence.daysAtOrAboveTarget} of your last ${evidence.daysEvaluated} complete days met your ${evidence.proteinTargetG}g protein target (${adherencePct}%) — that's why this pattern was surfaced.`,
    whyItMatters:
      "Reaching a protein target consistently, rather than occasionally, is what tends to support steadier hunger and recovery over time.",
    takeaway:
      "A pattern sustained across this many days is usually a sign protein has become a workable habit for you, not just an occasional win worth noticing.",
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
    evidence: `${evidence.activeDays} active days out of your last ${evidence.windowDays} — that consistency is why this pattern was surfaced.`,
    whyItMatters:
      "Regular logging is what gives every KainFit observation something real to work from — a steadier record supports a more precise pattern.",
    takeaway:
      "Consistency at this level usually means logging has become closer to routine than a conscious effort you have to remember each day.",
  };
}

// Milestone copy — deliberately hand-written per threshold rather than a
// single interpolated template, because a milestone "must communicate more
// than a number" (see the doctrine's weak/better examples). Every entry is
// a fixed, deterministic string keyed by milestoneType+threshold — no
// evidence-driven numbers are interpolated beyond the threshold value
// itself, since a milestone's meaning doesn't vary once observedValue has
// crossed it.
const MEAL_COUNT_MILESTONE_COPY: Record<number, Omit<SignalCardContent, "headline">> = {
  10: {
    observation: "You've now logged 10 meals with KainFit.",
    evidence:
      "This is your 10th logged meal — enough for KainFit to start telling a real pattern apart from a single choice.",
    whyItMatters:
      "Early history like this is what lets later observations rely on more than one day's decisions.",
    takeaway:
      "This is a good point to start noticing which meals keep showing up in your log — those are more telling than any single day.",
  },
  25: {
    observation: "You have now logged 25 meals with KainFit.",
    evidence:
      "This crosses the 25-meal mark — enough history for KainFit to begin separating one-off choices from your recurring eating patterns.",
    whyItMatters:
      "More logged history means later observations rely less on any single day and more on what actually repeats.",
    takeaway:
      "Meals that keep showing up from here on are more likely to reflect your real habits than any one day was.",
  },
  50: {
    observation: "You have now logged 50 meals with KainFit.",
    evidence:
      "Fifty logged meals is enough for KainFit to start comparing different stretches of your own history against each other.",
    whyItMatters:
      "At this volume, comparisons between periods — not just single observations — start to become meaningful.",
    takeaway:
      "From here, KainFit can start showing you how one stretch of your logging compares with another, not just what's happening lately.",
  },
  100: {
    observation: "You have now logged 100 meals with KainFit.",
    evidence:
      "One hundred logged meals is a substantial personal record — enough for longer-range patterns to stand out from short-term noise.",
    whyItMatters:
      "A record this size is what makes a genuine long-term pattern distinguishable from a temporary phase.",
    takeaway: "Patterns that still hold at this scale are the ones most worth paying attention to.",
  },
};

const DISTINCT_DAY_MILESTONE_COPY: Record<number, Omit<SignalCardContent, "headline">> = {
  7: {
    observation: "You've logged food across 7 different days.",
    evidence:
      "Seven distinct logging days is enough for KainFit to begin forming a real behavioral baseline, rather than a single-day snapshot.",
    whyItMatters:
      "A baseline like this is what lets KainFit tell a genuine pattern apart from a one-off day.",
    takeaway:
      "From here, anything KainFit shows you will be grounded in more than one day of data.",
  },
  14: {
    observation: "You've logged food across 14 different days.",
    evidence:
      "Two weeks of distinct logging days is enough for KainFit to start noticing whether a pattern holds, not just whether it appeared once.",
    whyItMatters:
      "Patterns that repeat across two weeks are far less likely to be coincidence than patterns from a handful of days.",
    takeaway:
      "Anything that's held steady across this many days is worth treating as a real habit, not a fluke.",
  },
  30: {
    observation: "You've logged food across 30 different days.",
    evidence:
      "Thirty distinct logging days gives KainFit a full month of behavioral history to draw from.",
    whyItMatters:
      "A month of history is enough to start separating your ordinary routine from occasional exceptions.",
    takeaway:
      "This is a reasonable point to trust that what KainFit is showing you reflects your routine, not a temporary stretch.",
  },
};

function milestoneHeadline(milestoneType: MilestoneType, threshold: number): string {
  const label =
    milestoneType === "meal_count" ? `${threshold} meals logged` : `${threshold} days logged`;
  return `A new milestone: ${label}.`;
}

export function behaviorMilestoneCopy(
  evidence: Extract<InsightEvidence, { insightType: "behavior_milestone" }>,
): SignalCardContent {
  const table =
    evidence.milestoneType === "meal_count"
      ? MEAL_COUNT_MILESTONE_COPY
      : DISTINCT_DAY_MILESTONE_COPY;
  const entry = table[evidence.threshold];
  if (!entry) {
    throw new Error(
      `behaviorMilestoneCopy: no copy defined for ${evidence.milestoneType}:${evidence.threshold} — every threshold in the registry's milestone ladder must have a matching copy entry.`,
    );
  }
  return {
    headline: milestoneHeadline(evidence.milestoneType, evidence.threshold),
    ...entry,
  };
}
