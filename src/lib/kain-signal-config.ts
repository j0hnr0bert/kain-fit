// Centralized KainSignal Phase-1 thresholds. Every tunable number the
// pipeline uses lives here, named, with a comment justifying the value —
// the same idiom target-consistency.ts uses for TARGET_MISMATCH_TOLERANCE_*.
// This is deliberately a set of TypeScript constants, not an admin-tunable
// database settings row (that idiom — app_settings/ops-settings.server.ts —
// is reserved for ops safety valves like AI pause/caps, not product-logic
// thresholds that need code review and test coverage when they change).

import type { EvidenceStrength, InsightType } from "./kain-signal-types";

// How far back the pipeline looks for evidence. Matches the 60-day window
// today.tsx already fetches for the existing streak feature, so KainSignal
// doesn't need a second, larger query against food_entries.
export const SIGNAL_LOOKBACK_DAYS = 60;

// Hard gates — a user cannot unlock KainSignal (state 'eligible' or later)
// unless ALL of these are met, regardless of composite score.
export const MIN_ACTIVE_LOGGING_DAYS = 7;
export const MIN_QUALIFYING_ENTRIES = 18;
export const MIN_REASONABLY_COMPLETE_DAYS = 5;

// Data-quality gate: if more than this share of the lookback window's
// entries are Low Trust, the pipeline refuses to unlock regardless of raw
// counts — quantity of evidence cannot substitute for quality of evidence.
export const CRITICAL_LOW_TRUST_SHARE_MAX = 0.6;

// Reasonably-complete-day heuristic (kain-signal-day-completeness.ts).
// Deliberately NOT a meal-count model — a single large OMAD entry can make
// a day complete; a single tiny snack cannot. See that module's header for
// worked examples.
export const MIN_CALORIES_FOR_COMPLETE_DAY = 300;
export const MAX_LOW_TRUST_SHARE_FOR_COMPLETE_DAY = 0.5;

// Entry-confidence classification (kain-signal-confidence.ts). A numeric
// confidence below this, when present, marks an entry Low Trust regardless
// of its data_source.
export const LOW_TRUST_CONFIDENCE_MAX = 0.5;

// Building-state categorical progress bands (composite_score is 0-100).
// Never shown to the user as a raw number — only as one of these three
// labels — per the doctrine's explicit "no decorative percentage" rule.
export const PROGRESS_LABEL_BANDS = {
  starting: [0, 33],
  taking_shape: [34, 66],
  nearly_ready: [67, 99],
} as const;

// Evidence-strength thresholds, per insight type. Sample-size *shape*
// differs deliberately: protein adherence is measured in complete days
// evaluated (a slower-accumulating, higher-quality sample), logging
// consistency is measured in active days over a longer window (a
// faster-accumulating, coarser sample) — one universal threshold would
// misrepresent one or the other.
export const PROTEIN_ADHERENCE_EVIDENCE_THRESHOLDS = { early: 5, clear: 8, strong: 14 } as const;
export const LOGGING_CONSISTENCY_EVIDENCE_THRESHOLDS = { early: 7, clear: 14, strong: 21 } as const;

// Direction/tier calibration (2026-08-08 recalibration) — see
// kain-signal-detector-protein.ts's classifyProteinDirection. Based on
// average target-attainment percentage, never on the binary hit rate alone
// (a 97%-average-attainment user who only hit the exact target once must
// still read as positive — see the near-miss synthetic test case).
//
// Bands (non-overlapping, evaluated high-to-low):
//   >=90%          -> positive, tier "strong" (or "clear" if attainment is
//                     highly inconsistent day-to-day — see
//                     PROTEIN_HIGH_VARIANCE_STDDEV_PCT below; a volatile
//                     90% average is not the same claim as a steady one)
//   85% to <90%     -> positive, tier "clear"
//   80% to <85%     -> neutral, tier "borderline" ("consistently close",
//                      never "mastered")
//   75% to <80%     -> negative, tier "clear"
//   <75%            -> negative, tier "strong"
export const PROTEIN_POSITIVE_STRONG_MIN_ATTAINMENT_PCT = 90;
export const PROTEIN_POSITIVE_CLEAR_MIN_ATTAINMENT_PCT = 85;
export const PROTEIN_BORDERLINE_MIN_ATTAINMENT_PCT = 80;
export const PROTEIN_NEGATIVE_CLEAR_MAX_ATTAINMENT_PCT = 80; // strictly below
export const PROTEIN_NEGATIVE_STRONG_MAX_ATTAINMENT_PCT = 75; // strictly below

// Day-to-day variance in attainment%, measured as a population standard
// deviation. Calibrated against the two synthetic extremes: a tight cluster
// (210/215/205/225/212g vs a 220g target) produces a stddev in the low
// single digits; a wildly swinging pattern (40% one day, 140% another)
// produces a stddev well past 30. These thresholds sit comfortably between
// the two rather than at a precisely-derived statistical cutoff — there is
// no larger dataset yet to fit one, and Phase 6 explicitly calls for a
// "sensible starting framework," not a blindly precise one.
export const PROTEIN_LOW_VARIANCE_STDDEV_PCT_MAX = 10;
export const PROTEIN_MODERATE_VARIANCE_STDDEV_PCT_MAX = 25;

// Ranking (kain-signal-ranking.ts).
export const EVIDENCE_STRENGTH_BASE_SCORE: Record<EvidenceStrength, number> = {
  early_signal: 1,
  clear_signal: 2,
  strong_signal: 3,
};
// Protein adherence and logging consistency are the doctrine's own #1/#2
// priority ("the two strongest opening domains"). This tiebreak only
// matters on an exact score tie between the two — it never overrides a
// genuine evidence-strength difference.
export const INSIGHT_TYPE_PRIORITY_TIEBREAK: Record<InsightType, number> = {
  protein_adherence: 0.1,
  logging_consistency: 0,
  // behavior_milestone's tiebreak value is irrelevant to actual selection —
  // kain-signal-selection.ts's selectWinner always gives a present milestone
  // candidate top priority before rankInsights' score even matters (see the
  // selection-policy doctrine: "newly crossed milestone" outranks
  // everything). Present only so rankInsights' score math never produces
  // NaN for a milestone candidate in the audit-trail ranked array.
  behavior_milestone: 0,
  // 2026-08-10 insight-quality upgrade: the four new relational types have
  // no tiebreak preference among themselves or against the original two —
  // insightValueMultiplier (kain-signal-insight-value.ts) is what's meant
  // to differentiate them, not an arbitrary type ordering.
  protein_calorie_relationship: 0,
  protein_meal_position: 0,
  weekday_weekend_pattern: 0,
  trend_shift: 0,
};
export const NOT_QUITE_PENALTY_PER_OCCURRENCE = 1.5;
export const NOT_QUITE_LOOKBACK_DAYS = 30;

// Quantitative protein action bands (2026-08-09 recalibration, Task 3) —
// see kain-signal-protein-action.ts. Translates a measured average shortfall
// (grams/day) into proportional action language instead of one fixed
// sentence regardless of magnitude. Boundaries are deliberately simple,
// round numbers rather than statistically fit — there's no larger dataset
// yet to calibrate against, and the spec explicitly asked to keep them
// simple over precise. Upper bound of each band is inclusive.
export const PROTEIN_ACTION_SMALL_MAX_G = 10; // small top-up
export const PROTEIN_ACTION_MODEST_MAX_G = 25; // one modest addition
export const PROTEIN_ACTION_SUBSTANTIAL_MAX_G = 45; // one substantial addition, or split across two meals
export const PROTEIN_ACTION_LARGE_MAX_G = 70; // ~20-35g added to each of two meals
// Above PROTEIN_ACTION_LARGE_MAX_G: structural, meal-level change language.

// 2026-08-10 insight-quality upgrade — thresholds for the four new
// relational/comparative detectors. Each detector's own header comment
// explains what pattern it looks for; these are the "is this real enough,
// and big enough, to be worth a sentence" gates. Chosen as simple, round
// numbers (there is no larger dataset yet to statistically fit them
// against) rather than precisely derived — matches this file's existing
// convention (see the PROTEIN_LOW_VARIANCE_STDDEV_PCT_MAX comment above).

// Evidence-strength sample-size bands for the four new types (see
// kain-signal-evidence-strength.ts). Each type's "sample size" is defined
// in its own detector — see EVIDENCE_STRENGTH_THRESHOLDS_BY_TYPE below.
export const PROTEIN_CALORIE_RELATIONSHIP_EVIDENCE_THRESHOLDS = {
  early: 12,
  clear: 18,
  strong: 28,
} as const;
export const PROTEIN_MEAL_POSITION_EVIDENCE_THRESHOLDS = {
  early: 5,
  clear: 8,
  strong: 14,
} as const;
export const WEEKDAY_WEEKEND_EVIDENCE_THRESHOLDS = { early: 8, clear: 14, strong: 24 } as const;
export const TREND_SHIFT_EVIDENCE_THRESHOLDS = { early: 10, clear: 15, strong: 25 } as const;

// Protein-vs-calorie relationship (kain-signal-detector-protein-calorie.ts).
// A median split of complete days into "lower-calorie"/"higher-calorie"
// halves; the pattern only surfaces if the protein gap between the two
// halves is large enough to be a real tradeoff, not day-to-day noise.
export const PROTEIN_CALORIE_MIN_DAYS = 12; // needs both halves to be a real sample
export const PROTEIN_CALORIE_MIN_GAP_G = 15; // below this, not worth a sentence

// Protein-by-meal-position (kain-signal-detector-protein-meal-position.ts).
// A new meal-group starts after this many minutes since the previous entry
// on the same day — a data-driven stand-in for "next meal" that never
// assumes breakfast/lunch/dinner categories exist or are used consistently.
export const MEAL_GROUP_GAP_MINUTES = 90;
export const PROTEIN_MEAL_POSITION_MIN_SHORTFALL_DAYS = 5;
// An even split across ~3 meal-groups would be ~33% each; well below that
// is the "gap is loaded early" pattern worth surfacing.
export const PROTEIN_MEAL_POSITION_LOW_SHARE_PCT_MAX = 25;

// Weekday vs. weekend (kain-signal-detector-weekday-weekend.ts). Only
// surfaces the specific "calories stayed flat but protein moved" pattern —
// see the detector's header for why a weekday/weekend split where both
// move together is deliberately NOT surfaced (it's the obvious story, not
// an insight).
export const WEEKDAY_WEEKEND_MIN_WEEKDAY_DAYS = 5;
export const WEEKDAY_WEEKEND_MIN_WEEKEND_DAYS = 4;
export const WEEKDAY_WEEKEND_MAX_STABLE_CALORIE_DIFF_PCT = 10; // "barely changed"
export const WEEKDAY_WEEKEND_MIN_PROTEIN_DIFF_G = 15; // "but protein moved"

// Trend shift (kain-signal-detector-trend-shift.ts). Two fixed-size,
// back-to-back qualified-day windows compared against each other.
export const TREND_SHIFT_WINDOW_DAYS = 5;
export const TREND_SHIFT_MIN_TOTAL_QUALIFIED_DAYS = TREND_SHIFT_WINDOW_DAYS * 2;
export const TREND_SHIFT_MIN_DELTA_PCT = 10; // in attainment percentage points

// Insight-value scoring (kain-signal-insight-value.ts / kain-signal-
// ranking.ts). Multiplies the evidence-strength base score so a candidate
// that merely restates a count/average can't outrank a genuinely relational
// one purely on sample size — see rankInsights' updated formula.
export const NOVELTY_MULTIPLIER = { high: 1.5, medium: 1.0, low: 0.6 } as const;
export const ACTIONABILITY_MULTIPLIER = { high: 1.3, medium: 1.0, low: 0.8 } as const;

// Milestone ladders (kain-signal-detector-milestone.ts). Deliberately
// small and high-value only — see the doctrine's explicit rejection of
// weak milestones ("second meal logged", "every five meals forever").
export const MEAL_COUNT_MILESTONE_THRESHOLDS = [10, 25, 50, 100] as const;
export const DISTINCT_DAY_MILESTONE_THRESHOLDS = [7, 14, 30] as const;
