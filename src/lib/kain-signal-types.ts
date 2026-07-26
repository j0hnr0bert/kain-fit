// Shared types for the KainSignal evidence pipeline (Phase 1 — Signal
// Foundation). Kept in one module, separate from any single stage, so the
// pure functions in kain-signal-*.ts can reference each other's inputs and
// outputs without circular imports.

// A food_entries row, trimmed to the fields the KainSignal pipeline reads.
// Matches the columns in supabase/migrations/20260716072107_...sql exactly.
export type FoodEntryLite = {
  logged_at: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  data_source: string;
  is_estimate: boolean;
  confidence: number | null;
};

// Three evidence-strength tiers — never "average" (see kain-signal-config.ts
// for why: that reads as a judgment of the user, not a description of the
// data). Each insight type has its own thresholds; there is no universal
// sample-size cutoff.
export type EvidenceStrength = "early_signal" | "clear_signal" | "strong_signal";

// The four Phase-1 UX states. Persisted per user per Manila day in
// kain_signal_states.state. States only ever move forward in Phase 1 (see
// kain-signal-generate.server.ts's monotonic-state rule) — degrading or
// relearning states are out of scope until a later phase.
export type SignalState = "no_data" | "building" | "eligible" | "connected";

// Derived per-entry data-quality class. The doctrine assumes a per-entry
// logging-method tag (voice/barcode/plate-scan); that field doesn't exist
// on food_entries in this schema (logging is text-only, AI-parsed today),
// so confidence is derived instead from the fields that do exist —
// data_source, is_estimate, confidence — see kain-signal-confidence.ts.
export type EntryConfidenceClass = "verified" | "provisional" | "low_trust";

export type ProteinAdherenceEvidence = {
  insightType: "protein_adherence";
  daysEvaluated: number;
  daysAtOrAboveTarget: number;
  adherenceRate: number;
  proteinTargetG: number;
  evidenceStrength: EvidenceStrength;
};

export type LoggingConsistencyEvidence = {
  insightType: "logging_consistency";
  windowDays: number;
  activeDays: number;
  consistencyRate: number;
  currentStreak: number;
  longestGapDays: number;
  evidenceStrength: EvidenceStrength;
};

export type InsightEvidence = ProteinAdherenceEvidence | LoggingConsistencyEvidence;
export type InsightType = InsightEvidence["insightType"];
