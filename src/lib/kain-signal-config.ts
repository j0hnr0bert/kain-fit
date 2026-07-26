// Centralized KainSignal Phase-1 thresholds. Every tunable number the
// pipeline uses lives here, named, with a comment justifying the value —
// the same idiom target-consistency.ts uses for TARGET_MISMATCH_TOLERANCE_*.
// This is deliberately a set of TypeScript constants, not an admin-tunable
// database settings row (that idiom — app_settings/ops-settings.server.ts —
// is reserved for ops safety valves like AI pause/caps, not product-logic
// thresholds that need code review and test coverage when they change).

import type { EvidenceStrength } from "./kain-signal-types";

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
export const INSIGHT_TYPE_PRIORITY_TIEBREAK = {
  protein_adherence: 0.1,
  logging_consistency: 0,
} as const;
export const NOT_QUITE_PENALTY_PER_OCCURRENCE = 1.5;
export const NOT_QUITE_LOOKBACK_DAYS = 30;
