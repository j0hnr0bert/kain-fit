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
import { generateProteinAction } from "./kain-signal-protein-action";

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
//
// 2026-08-09 recalibration (evidence-boundary + action calibration): every
// whyItMatters sentence below is limited to what KainFit can actually prove
// from stored food-log data — counts, targets, rates, day-to-day
// consistency. Earlier copy claimed protein this close to target "supports
// steadier hunger and recovery," and a wide shortfall "compounds rather
// than average out" — neither is something a food log can establish;
// hunger, recovery, and compounding physiological effects aren't measured
// anywhere in this app. Every whyItMatters line here describes the logged
// pattern itself (how many days, how close, how consistent), never its
// effect on the body. Separately, the neutral and negative-direction
// takeaway lines now call generateProteinAction(evidence.averageShortfallG)
// (kain-signal-protein-action.ts) instead of one fixed sentence, so the
// suggested action's size actually matches the measured gap — a 5g
// shortfall and a 58g shortfall no longer get the same "modest, steady
// increase" language.
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
        "Days that missed the exact target here still landed close to it — a different pattern than days that missed by a wide margin.",
      takeaway: "This is a stronger pattern than the hit count alone would suggest.",
    };
  }

  if (evidence.direction === "positive" && evidence.directionTier === "strong") {
    return {
      headline: "Protein is becoming one of your most consistent habits.",
      observation,
      evidence: `${hitDays} of ${days} days hit the target exactly, and attainment stayed close to target day to day.`,
      whyItMatters:
        "Landing close to target most days, not just occasionally, is a more reliable pattern than a few good days mixed in with worse ones.",
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
        "Averaging this close to target across your qualified days means most days weren't far from your goal, even the ones that missed it exactly.",
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
      takeaway: generateProteinAction(evidence.averageShortfallG),
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
        : "This shortfall is showing up on most days, not just occasionally — a pattern, not a one-off.",
    takeaway: generateProteinAction(evidence.averageShortfallG),
  };
}

// 2026-08-10 insight-quality upgrade: copy for the four new relational
// detectors. Every sentence here follows two rules that don't apply the
// same way to the original three types:
//   1. Causality-honest phrasing (Phase 14) — two things moving together in
//      this user's own logs is never rendered as one CAUSING the other.
//      "tends to", "shows up on", "associated with", "when X, Y averages"
//      — never "improves", "causes", "because of", "leads to", "results
//      in". Enforced structurally by kain-signal-guardrail.ts's
//      checkCausalityLanguage, which runs for every insight type.
//   2. Same-day boundary (Phase 15) — every action here is framed as a
//      reusable, pattern-level recommendation ("on days like this",
//      "in your weekend routine"), never a same-day/next-meal instruction
//      ("today", "your next meal") — that remains Coaching Card's
//      exclusive job, unchanged from the original three types' rule.

export function proteinCalorieRelationshipCopy(
  evidence: Extract<InsightEvidence, { insightType: "protein_calorie_relationship" }>,
): SignalCardContent {
  const gapG = Math.round(evidence.proteinGapG);
  const lowerProtein = Math.round(evidence.avgProteinLowerGroup);
  const lowerCalories = Math.round(evidence.avgCaloriesLowerGroup);
  const higherCalories = Math.round(evidence.avgCaloriesHigherGroup);
  return {
    headline: "Your lowest-calorie days are also your lowest-protein days.",
    observation: `On your ${evidence.lowerCalorieDayCount} lowest-calorie days (around ${lowerCalories} kcal) you averaged ${lowerProtein}g of protein — about ${gapG}g less than on your ${evidence.higherCalorieDayCount} higher-calorie days (around ${higherCalories} kcal).`,
    evidence: `Across your last ${evidence.daysEvaluated} qualified days, protein tracked with calories rather than staying steady.`,
    whyItMatters:
      "This shows up specifically on your lower-calorie days in your own logs — not as a claim about every day.",
    takeaway:
      "On lower-calorie days, cutting from lower-protein foods first would help close this gap.",
  };
}

export function proteinMealPositionCopy(
  evidence: Extract<InsightEvidence, { insightType: "protein_meal_position" }>,
): SignalCardContent {
  const sharePct = Math.round(evidence.avgFirstMealProteinSharePct);
  return {
    headline: "Most of your protein gap is created early in the day.",
    observation: `Your first meal contributes only about ${sharePct}% of your daily protein on the ${evidence.shortfallDaysEvaluated} days you've missed your ${evidence.proteinTargetG}g target.`,
    evidence: `Measured only on shortfall days, using each day's own first logged meal — not an assumed breakfast.`,
    whyItMatters:
      "This pattern is specific to the days you fall short — it says nothing about days you already hit target.",
    takeaway:
      "Adding more protein to your first meal on days like this would leave less to make up later.",
  };
}

export function weekdayWeekendPatternCopy(
  evidence: Extract<InsightEvidence, { insightType: "weekday_weekend_pattern" }>,
): SignalCardContent {
  const proteinDiffG = Math.round(Math.abs(evidence.proteinDiffG));
  const lower = evidence.proteinDiffG < 0;
  return {
    headline: lower
      ? "Your weekends aren't actually your biggest problem."
      : "Your weekend protein is actually higher, even though your food intake barely changes.",
    observation: `Calories are about the same on weekdays and weekends, but protein averages ${proteinDiffG}g ${lower ? "lower" : "higher"} on weekends.`,
    evidence: `Based on ${evidence.weekdayCount} weekdays and ${evidence.weekendCount} weekend days, with calories within ${Math.round(Math.abs(evidence.calorieDiffPct))}% of each other.`,
    whyItMatters:
      "The two usually move together — calories and protein staying this far apart from each other is the specific pattern worth noticing here.",
    takeaway: lower
      ? "Keeping one reliable high-protein meal in your weekend routine would help close this gap."
      : "Whatever's different about your weekend protein sources may be worth carrying into your weekday routine.",
  };
}

export function trendShiftCopy(
  evidence: Extract<InsightEvidence, { insightType: "trend_shift" }>,
): SignalCardContent {
  const recentPct = Math.round(evidence.avgAttainmentPctRecent);
  const priorPct = Math.round(evidence.avgAttainmentPctPrior);
  const isPositive = evidence.direction === "positive";
  return {
    headline: isPositive
      ? "You're trending better on protein than you might realize."
      : "Your protein trend has slipped over your last few qualified days.",
    observation: `Your last ${evidence.recentWindowDays} qualified days averaged ${recentPct}% of target, versus ${priorPct}% in the ${evidence.priorWindowDays} qualified days before that.`,
    evidence: `Compares two equal-length, back-to-back windows of your own qualified days against your ${evidence.proteinTargetG}g target.`,
    whyItMatters:
      "This compares two windows of your own history — it isn't a single day's snapshot, and it isn't a claim about what happens after this window.",
    takeaway: isPositive
      ? "Whatever's different about these last few days is worth noticing, even before your overall numbers fully catch up."
      : "Worth watching over your next few qualified days before this becomes a bigger gap.",
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
