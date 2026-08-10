// Insight Value (2026-08-10 insight-quality upgrade, Phase 1/Phase 6). A
// concept distinct from evidenceStrength (sample size) and direction
// (good/bad): whether an observation tells the user something meaningfully
// beyond the raw numbers already visible on Today or in one History entry.
//
// OBSERVATION vs INSIGHT (Phase 2): "You averaged 170g protein" restates a
// number the user can already see. "Your protein drops most on the days
// your first meal is low-protein" reveals a RELATIONSHIP the user would
// need several days of logs to notice on their own. Novelty is the axis
// that tells these apart; actionability is whether the pattern implies a
// specific, useful next move once noticed. Neither substitutes for
// evidenceStrength or correctness — a high-novelty candidate with too few
// days still returns null from its detector before this module ever sees
// it (see each detector's own early-signal floor).
//
// Deliberately keyed on insightType (a small, closed set) rather than
// computed from arbitrary evidence heuristics — novelty is a property of
// WHAT KIND of thing is being said (a relationship vs. a count), which is
// determined by which detector produced the evidence, not by its specific
// numbers. The one exception is protein_adherence's near-miss branch: a
// high-attainment-but-low-hit-rate pattern is itself a hidden, easy-to-miss
// fact (Phase 9 item 1, "protein near-miss insight") — surfaced as its own
// direction/adherenceRate combination within the existing detector (see
// kain-signal-detector-protein.ts) rather than a duplicate detector, but
// still deserving of high novelty here.

import type { InsightEvidence, InsightType } from "./kain-signal-types";
import { ACTIONABILITY_MULTIPLIER, NOVELTY_MULTIPLIER } from "./kain-signal-config";

export type NoveltyTier = "high" | "medium" | "low";
export type ActionabilityTier = "high" | "medium" | "low";

const NOVELTY_BY_TYPE: Record<InsightType, NoveltyTier> = {
  // A simple average/hit-rate restates what Today already shows — medium,
  // not low, because the direction/attainment interpretation itself still
  // adds something a raw number doesn't. See the near-miss override below.
  protein_adherence: "medium",
  // A streak/active-day count is the most directly-visible number on
  // Today's own logging indicator — the lowest-novelty type in the set.
  logging_consistency: "low",
  // A certain, deterministic lifetime fact the user could not have easily
  // tallied themselves, but not a relationship either.
  behavior_milestone: "medium",
  protein_calorie_relationship: "high",
  protein_meal_position: "high",
  weekday_weekend_pattern: "high",
  trend_shift: "high",
};

const ACTIONABILITY_BY_TYPE: Record<InsightType, ActionabilityTier> = {
  protein_adherence: "medium", // negative direction sharpens this — see override below
  logging_consistency: "low", // nothing concrete to change; the habit already exists
  behavior_milestone: "low", // a fact, not a prompt to do anything differently
  protein_calorie_relationship: "high", // "protect protein first when cutting calories"
  protein_meal_position: "high", // "front-load protein earlier in the day"
  weekday_weekend_pattern: "medium", // useful but softer than a per-day structural fix
  trend_shift: "medium", // informational; only mildly actionable either direction
};

export function classifyNovelty(evidence: InsightEvidence): NoveltyTier {
  if (
    evidence.insightType === "protein_adherence" &&
    evidence.direction === "positive" &&
    evidence.adherenceRate < 0.5
  ) {
    return "high"; // the hidden near-miss (Phase 9 item 1)
  }
  return NOVELTY_BY_TYPE[evidence.insightType];
}

export function classifyActionability(evidence: InsightEvidence): ActionabilityTier {
  if (evidence.insightType === "protein_adherence" && evidence.direction === "negative") {
    return "high"; // a gram-specific action exists — see generateProteinAction
  }
  return ACTIONABILITY_BY_TYPE[evidence.insightType];
}

// The combined multiplier rankInsights applies on top of the
// evidence-strength base score (Phase 6: "Do NOT let sample size alone
// dominate"). Not a literal `evidence x relevance x novelty x ...` product
// of every axis the spec lists — evidenceStrength already encodes sample
// size, direction/magnitude are already priced into which branch a
// detector took, and freshness/confidence are handled structurally
// elsewhere (change-triggered persistence, the early-signal floor) — but
// the RESULT reflects the same logic: novelty and actionability can move a
// candidate up or down relative to raw sample size, never the reverse.
export function insightValueMultiplier(evidence: InsightEvidence): number {
  return (
    NOVELTY_MULTIPLIER[classifyNovelty(evidence)] *
    ACTIONABILITY_MULTIPLIER[classifyActionability(evidence)]
  );
}

// Phase 12 ("Don't force a signal"): a low-novelty candidate — today, only
// logging_consistency, a plain active-day count/streak, the closest thing
// in this registry to the spec's own flagged-weak example "You logged
// consistently this week" — is only eligible to WIN selection at
// strong_signal evidence strength. This is the literal implementation of
// "low-novelty signals should only surface if no better candidate exists":
// selectTopInsight (kain-signal-ranking.ts) already sorts by rankScore, so
// a low-novelty candidate only reaches the top slot when nothing stronger
// was available — this floor additionally requires that, even then, its
// own evidence be genuinely substantial before KainFit says anything at
// all. A high- or medium-novelty candidate (a relationship, a trend, a
// near-miss, or protein_adherence's own direction-aware read) is never
// blocked by this floor — the floor exists specifically for "just a count."
export function passesInsightValueFloor(evidence: InsightEvidence): boolean {
  if (classifyNovelty(evidence) !== "low") return true;
  return evidence.evidenceStrength === "strong_signal";
}
