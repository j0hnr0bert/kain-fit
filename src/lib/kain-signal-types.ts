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

// 2026-08-08 recalibration: `evidenceStrength` measures sample size alone
// (see kain-signal-evidence-strength.ts) — it must never be read as a
// judgment of whether the underlying behavior is good or bad. `direction`
// is the explicit, separate field that answers that question. A signal can
// be STRONG evidence of a NEGATIVE pattern; the two are orthogonal axes,
// not one scale. See kain-signal-guardrail.ts for the enforcement layer
// that rejects any copy contradicting this field.
export type SignalDirection = "positive" | "negative" | "neutral";

// Magnitude/quality tier within a direction — independent of evidenceStrength
// (sample size). "strong"/"clear" require both a large-enough effect size
// AND enough qualified days (already guaranteed by evidenceStrength's own
// >=5-day floor); "borderline" is the deliberately modest middle band that
// must never be dramatized in either direction (see kain-signal-config.ts's
// PROTEIN_* thresholds and kain-signal-copy.ts's proteinAdherenceCopy).
export type SignalDirectionTier = "strong" | "clear" | "borderline";

export type AttainmentConsistency = "low_variance" | "moderate_variance" | "high_variance";

export type ProteinAdherenceEvidence = {
  insightType: "protein_adherence";
  daysEvaluated: number;
  // Binary hit-rate fields — kept as SUPPORTING evidence only (shown in the
  // "evidence" sentence), never the primary basis for direction/tier. A
  // 97%-average-attainment user who hit the exact target on 1 of 5 days
  // must not be classified as failing (see the near-miss synthetic case);
  // a 2-of-15 hit rate at ~13% average attainment must not be classified as
  // succeeding (the production bug this recalibration fixes).
  daysAtOrAboveTarget: number;
  adherenceRate: number;
  proteinTargetG: number;
  evidenceStrength: EvidenceStrength;
  // Attainment-percentage analysis (Phase 4 of the recalibration) — the
  // primary basis for direction/tier from here on.
  averageGramsPerDay: number;
  averageAttainmentPct: number;
  medianAttainmentPct: number;
  attainmentStdDevPct: number;
  // Positive shortfallG = short of target on average; negative = surplus.
  averageShortfallG: number;
  consistency: AttainmentConsistency;
  direction: SignalDirection;
  directionTier: SignalDirectionTier;
};

export type LoggingConsistencyEvidence = {
  insightType: "logging_consistency";
  windowDays: number;
  activeDays: number;
  consistencyRate: number;
  currentStreak: number;
  longestGapDays: number;
  evidenceStrength: EvidenceStrength;
  // Unlike protein adherence, this detector's own sample metric (active
  // days) IS the success measure — there is no way for this evidence to
  // exist and represent a negative pattern (a low-activity user simply
  // never clears the evidenceStrength floor to begin with — see
  // kain-signal-detector-logging-consistency.ts). direction is always
  // "positive" here; the field exists for a uniform contract across
  // insight types, not because this detector needed its own calibration.
  direction: SignalDirection;
};

// The two lifetime ladders behavior_milestone currently supports. Adding a
// third ladder means adding a MilestoneType value and its threshold list in
// kain-signal-registry.ts — never inferring a milestone from same-day data.
export type MilestoneType = "meal_count" | "distinct_logging_days";

// A milestone is a certain, deterministic fact (a threshold was or wasn't
// crossed), not a confidence-graded pattern — evidenceStrength is always
// "strong_signal" here (see kain-signal-registry.ts) purely so it fits the
// same DB CHECK constraint and ranking base-score table the other two
// evidence types use, not because milestone strength is actually variable.
// milestoneType + threshold together are the stable identity used for
// dedup — see kain-signal-generate.server.ts's recordedMilestoneKeys. Two
// different thresholds of the same milestoneType are two different
// identities; crossing 25 meals must never be treated as the same
// milestone as crossing 50.
export type MilestoneEvidence = {
  insightType: "behavior_milestone";
  milestoneType: MilestoneType;
  threshold: number;
  observedValue: number;
  evidenceStrength: EvidenceStrength;
};

// 2026-08-10 insight-quality upgrade: four relational/comparative signal
// types, added alongside the original three rather than replacing anything
// (see kain-signal-insight-value.ts's header for why "reveals a
// relationship, not merely a count" is the dividing line these exist to
// cross). Each is a genuine relationship or comparison over the SAME
// underlying food_entries data the original detectors already read — no new
// data source, no invented categories (no breakfast/lunch/dinner; meal
// position is derived from logged_at clustering, day-of-week from the
// Manila-day string itself). Every one of these can be null — "not enough
// data to say something real" is the common, expected outcome, not a bug.

// Protein vs. calorie-intake relationship (Phase 3 "Protein vs calorie
// intake"): whether the user's lowest-calorie days are also disproportion-
// ately low-protein days — a tradeoff the user is unlikely to have
// consciously noticed, since Today only ever shows one day at a time.
export type ProteinCalorieRelationshipEvidence = {
  insightType: "protein_calorie_relationship";
  daysEvaluated: number;
  lowerCalorieDayCount: number;
  higherCalorieDayCount: number;
  avgCaloriesLowerGroup: number;
  avgCaloriesHigherGroup: number;
  avgProteinLowerGroup: number;
  avgProteinHigherGroup: number;
  // Positive = protein is lower on the lower-calorie days (the tradeoff
  // pattern this detector looks for). This detector never surfaces the
  // reverse case — see its header comment for why that's not the same
  // story.
  proteinGapG: number;
  evidenceStrength: EvidenceStrength;
};

// Protein by meal position (Phase 3 "Protein by meal position"): whether,
// on the days the user falls short of target, most of the shortfall traces
// to a low-protein first meal rather than being spread evenly across the
// day. "First meal" is derived purely from logged_at clustering within a
// day (a >=90-minute gap starts a new meal-group) — never an invented or
// assumed breakfast/lunch/dinner category.
export type ProteinMealPositionEvidence = {
  insightType: "protein_meal_position";
  shortfallDaysEvaluated: number;
  avgFirstMealProteinSharePct: number;
  proteinTargetG: number;
  evidenceStrength: EvidenceStrength;
};

// Weekday vs. weekend comparison (Phase 3 "Weekday vs weekend"): the
// specific, higher-value framing this repo implements — calories staying
// roughly flat while protein drops on weekends, which contradicts the
// obvious "weekends mean more food" assumption a user would already expect.
// A weekday/weekend split where BOTH calories and protein move together is
// deliberately NOT surfaced by this detector — that's the unsurprising
// story, not the one worth an insight.
export type WeekdayWeekendPatternEvidence = {
  insightType: "weekday_weekend_pattern";
  weekdayCount: number;
  weekendCount: number;
  avgCaloriesWeekday: number;
  avgCaloriesWeekend: number;
  avgProteinWeekday: number;
  avgProteinWeekend: number;
  calorieDiffPct: number;
  proteinDiffG: number;
  evidenceStrength: EvidenceStrength;
};

// Trend shift (Phase 3 "Trend shift"): the most recent qualified-day window
// compared against the window immediately before it — surfaces a genuine
// improvement or decline the user may not have consciously registered,
// since Today only ever shows the single most recent day.
export type TrendShiftEvidence = {
  insightType: "trend_shift";
  recentWindowDays: number;
  priorWindowDays: number;
  avgAttainmentPctRecent: number;
  avgAttainmentPctPrior: number;
  deltaPct: number;
  direction: Extract<SignalDirection, "positive" | "negative">;
  proteinTargetG: number;
  evidenceStrength: EvidenceStrength;
};

export type InsightEvidence =
  | ProteinAdherenceEvidence
  | LoggingConsistencyEvidence
  | MilestoneEvidence
  | ProteinCalorieRelationshipEvidence
  | ProteinMealPositionEvidence
  | WeekdayWeekendPatternEvidence
  | TrendShiftEvidence;
export type InsightType = InsightEvidence["insightType"];
