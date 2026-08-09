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

// 2026-08-08 recalibration: this function previously used
// describeAssociation(evidenceStrength) for the headline and a single fixed
// whyItMatters/takeaway pair, regardless of whether the underlying pattern
// was actually good or bad — evidenceStrength measures sample size, not
// direction (see kain-signal-types.ts's SignalDirection comment). A user
// who hit a 220g target on 2 of 15 days (~13% hit rate, ~65-75% average
// attainment) was rendered "one of your strongest nutrition patterns" and
// "a workable habit." That was the production bug this rewrite fixes.
//
// Every branch below is driven by evidence.direction + evidence.directionTier
// (computed in kain-signal-detector-protein.ts from average target-
// attainment percentage, not the binary hit rate). The binary hit-rate
// fields still appear, but only inside the "evidence" sentence, as
// supporting detail — never as the basis for the headline or takeaway. See
// kain-signal-guardrail.ts for the defense-in-depth check that this
// function's output cannot contradict evidence.direction.
export function proteinAdherenceCopy(
  evidence: Extract<InsightEvidence, { insightType: "protein_adherence" }>,
): SignalCardContent {
  const attainmentPct = Math.round(evidence.averageAttainmentPct);
  const shortfallG = Math.round(evidence.averageShortfallG);
  const target = evidence.proteinTargetG;
  const days = evidence.daysEvaluated;
  const hitDays = evidence.daysAtOrAboveTarget;
  const highVariance = evidence.consistency === "high_variance";

  const observation = `You averaged ${attainmentPct}% of your ${target}g protein target across your last ${days} qualified days.`;

  // Near-miss guard: high attainment can co-exist with a low exact-hit
  // rate (5 days at 210/215/205/225/212g against a 220g target average
  // ~97% attainment but only 1 exact hit) — Phase 11's own guardrail rule
  // explicitly forbids "strong habit"/"consistently hitting"/"strongest
  // pattern" language whenever the hit rate is under 50%, regardless of how
  // high attainment is. This branch (not the strong/clear positive
  // branches below) is what a high-attainment-but-low-hit-rate case
  // renders — still positive, but acknowledging the hit-rate/attainment
  // gap rather than overclaiming habit formation.
  if (evidence.direction === "positive" && evidence.adherenceRate < 0.5) {
    return {
      headline: "You're closer on protein than your streak suggests.",
      observation,
      evidence: `You only hit the exact target on ${hitDays} of ${days} days, but attainment averaged ${attainmentPct}%.`,
      whyItMatters:
        "Averaging this close to target usually still supports steadier hunger and recovery, even without hitting the exact number every day.",
      takeaway: "This is a stronger pattern than the hit count alone would suggest.",
    };
  }

  if (evidence.direction === "positive" && evidence.directionTier === "strong") {
    return {
      headline: "Protein is becoming one of your most consistent habits.",
      observation,
      evidence: `${hitDays} of ${days} days hit the target exactly, and attainment stayed close to target day to day.`,
      whyItMatters:
        "Protein that lands close to target most days, not just occasionally, is what tends to support steadier hunger and recovery.",
      takeaway: "This is holding up as a real pattern, not just a good stretch.",
    };
  }

  if (evidence.direction === "positive") {
    // directionTier === "clear" — either 85-90% attainment, or 90%+ with
    // high variance (see classifyProteinDirection).
    return {
      headline: "Protein is trending close to your target.",
      observation,
      evidence: highVariance
        ? `${hitDays} of ${days} days hit the target exactly, though daily amounts swung well above and below that average.`
        : `${hitDays} of ${days} days hit the target exactly — attainment averaged ${attainmentPct}%.`,
      whyItMatters:
        "Averaging this close to target usually still supports steadier hunger and recovery, even without hitting the exact number every day.",
      takeaway: highVariance
        ? "Evening out day to day, not just the average, would make this pattern more dependable."
        : "This is trending in the right direction.",
    };
  }

  if (evidence.direction === "neutral") {
    return {
      headline: "You're consistently close on protein.",
      observation,
      evidence: `You hit the exact target on ${hitDays} of ${days} days, but attainment averaged ${attainmentPct}% — closer than the hit count alone suggests.`,
      whyItMatters:
        "Being consistently close to a target, even without hitting it exactly, is a meaningfully different pattern than missing by a wide margin.",
      takeaway: "A small, steady increase would likely close most of what's left.",
    };
  }

  // direction === "negative" (tier "clear" or "strong").
  return {
    headline:
      evidence.directionTier === "strong"
        ? "Protein is your clearest nutrition gap right now."
        : "Protein is a gap worth noticing.",
    observation: `${observation} That's about ${shortfallG}g short per day on average.`,
    evidence: `${hitDays} of ${days} days hit the target exactly; attainment averaged ${attainmentPct}%.`,
    whyItMatters:
      evidence.directionTier === "strong"
        ? "This isn't an occasional miss — it's the most consistent shortfall in your recent log."
        : "Falling short of a protein target most days, rather than occasionally, is the kind of gap that tends to compound rather than average out.",
    takeaway:
      "A modest, steady increase across your usual meals would close most of this gap over time.",
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
