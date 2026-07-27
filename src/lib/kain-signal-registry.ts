// Signal Registry — the modular per-category contract KainSignal's
// orchestration loop (kain-signal-generate.server.ts) iterates over instead
// of calling detectors by name. Adding a future signal category means
// adding one module to SIGNAL_REGISTRY, not touching the ranking engine,
// the orchestrator's control flow, or any other module — this is the
// concrete mechanism behind "future signal categories should require
// adding a module, not redesigning the engine."
//
// This is an adaptation layer, not a rewrite: each module wraps one of the
// existing, already-tested pure detector/copy functions unchanged. No
// detection or copy logic is duplicated or reimplemented here.
//
// Signal Class and Specialist Voice are internal classification only — see
// the "Do not create theatrical personalities" rule. Neither is ever
// rendered as a user-visible label; they exist so the copy/tone a category
// uses is chosen deterministically by the signal's purpose, not
// arbitrarily. Narrowed to exactly the three classes/voices actually in use
// (2026-07-27 correction) — do not add speculative unused values back.
//
//   protein_adherence   -> class "reveal"  (surfaces a historical adherence
//                          pattern the user hasn't necessarily noticed)
//                       -> voice "scientist" (measured, trend-across-days
//                          framing)
//   logging_consistency -> class "protect" (interprets an already-working
//                          habit, not a problem to fix)
//                       -> voice "coach" (direct, plain-spoken framing)
//   behavior_milestone  -> class "milestone" (a certain, lifetime-count
//                          fact, not a confidence-graded pattern)
//                       -> voice "observer" (states what changed, without
//                          judgment or urgency)
//
// Historical-evidence enforcement (2026-07-27 correction, §4): a Kain
// Signal is invalid if it could have been generated from today's state
// alone. This is enforced structurally, not just by convention, in three
// places:
//   1. evidenceWindow (below) — every module must declare its historical
//      requirement; validateSignalModule rejects a non-milestone module
//      that doesn't require at least 2 distinct days of evidence.
//   2. Each detector's own qualification floor — protein_adherence and
//      logging_consistency already refuse to produce evidence below their
//      early-signal sample-size threshold (5 / 7 days respectively, see
//      kain-signal-evidence-strength.ts) — evidenceWindow's declared
//      minimum is a direct, checkable reflection of that same floor, not a
//      second independent number invented for this file.
//   3. behavior_milestone's own identity/dedup rule (never re-qualifies
//      once recorded) — see kain-signal-detector-milestone.ts.

import { detectProteinAdherence } from "./kain-signal-detector-protein";
import { detectLoggingConsistency } from "./kain-signal-detector-logging-consistency";
import { detectBehaviorMilestone } from "./kain-signal-detector-milestone";
import {
  behaviorMilestoneCopy,
  proteinAdherenceCopy,
  loggingConsistencyCopy,
  type SignalCardContent,
} from "./kain-signal-copy";
import {
  LOGGING_CONSISTENCY_EVIDENCE_THRESHOLDS,
  PROTEIN_ADHERENCE_EVIDENCE_THRESHOLDS,
} from "./kain-signal-config";
import type { FoodEntryLite, InsightEvidence, InsightType } from "./kain-signal-types";

export type SignalClass = "reveal" | "protect" | "milestone";
export type SpecialistVoice = "scientist" | "coach" | "observer";

// Declares what historical requirement a module's evidence must satisfy.
// "rolling-days" modules (reveal/protect) must require at least 2 distinct
// days — a same-day-only signal is structurally prohibited (see
// validateSignalModule). "milestone-identity" modules substitute a stable,
// never-repeating threshold identity for a day-window requirement — see
// kain-signal-detector-milestone.ts's recordedMilestoneKeys mechanism.
export type EvidenceWindow =
  | { kind: "rolling-days"; minDistinctDays: number }
  | { kind: "milestone-identity" };

// The shared read-only context every module's buildCandidate receives.
// Modules never fetch their own data — kain-signal-generate.server.ts
// gathers and shapes all of this once per call.
export type SignalContext = {
  entriesByDay: Readonly<Record<string, readonly FoodEntryLite[]>>;
  completeDays: readonly string[];
  activeDays: readonly string[];
  todayManila: string;
  windowDays: number;
  proteinTargetG: number | null;
  /** All-time (not just the SIGNAL_LOOKBACK_DAYS window) meal count and
   * distinct logging-day count — milestones are lifetime facts, so they
   * must not be blind to history older than the rolling window the other
   * two modules use. See kain-signal-generate.server.ts's lifetime query. */
  lifetimeMealCount: number;
  lifetimeDistinctLoggingDays: number;
  /** Every milestoneType:threshold this user has ever had recorded (any
   * day, is_selected or not) — see kain-signal-generate.server.ts. */
  recordedMilestoneKeys: ReadonlySet<string>;
};

export type SignalModule = {
  /** Stable signal/category ID — matches InsightEvidence["insightType"] and
   * the DB's insight_type CHECK constraint. */
  id: InsightType;
  signalClass: SignalClass;
  voice: SpecialistVoice;
  /** Bumped when a module's detection or copy logic changes materially,
   * so a later migration/analysis can tell which version produced a given
   * persisted row if that's ever needed. Not read anywhere yet. */
  version: number;
  evidenceWindow: EvidenceWindow;
  /** Evidence requirements, eligibility, and prohibited conditions are all
   * expressed the same way the existing detectors already express them:
   * returning null. There is no separate "is eligible" predicate — a
   * module that returns null for a given context is, by definition, not
   * eligible for it. */
  buildCandidate: (ctx: SignalContext) => InsightEvidence | null;
  /** Callers must only pass evidence whose insightType matches this
   * module's id (the registry loop always satisfies this — see
   * kain-signal-generate.server.ts). Narrowed internally rather than typed
   * generically so SignalModule stays a single, non-generic, array-safe
   * shape. */
  renderCopy: (evidence: InsightEvidence) => SignalCardContent;
};

const proteinAdherenceModule: SignalModule = {
  id: "protein_adherence",
  signalClass: "reveal",
  voice: "scientist",
  version: 1,
  evidenceWindow: {
    kind: "rolling-days",
    minDistinctDays: PROTEIN_ADHERENCE_EVIDENCE_THRESHOLDS.early,
  },
  buildCandidate: (ctx) =>
    detectProteinAdherence({
      entriesByDay: ctx.entriesByDay,
      completeDays: ctx.completeDays,
      proteinTargetG: ctx.proteinTargetG,
    }),
  renderCopy: (evidence) => {
    if (evidence.insightType !== "protein_adherence") {
      throw new Error("proteinAdherenceModule.renderCopy: mismatched evidence.insightType");
    }
    return proteinAdherenceCopy(evidence);
  },
};

const loggingConsistencyModule: SignalModule = {
  id: "logging_consistency",
  signalClass: "protect",
  voice: "coach",
  version: 1,
  evidenceWindow: {
    kind: "rolling-days",
    minDistinctDays: LOGGING_CONSISTENCY_EVIDENCE_THRESHOLDS.early,
  },
  buildCandidate: (ctx) =>
    detectLoggingConsistency({
      activeDays: ctx.activeDays,
      todayManila: ctx.todayManila,
      windowDays: ctx.windowDays,
    }),
  renderCopy: (evidence) => {
    if (evidence.insightType !== "logging_consistency") {
      throw new Error("loggingConsistencyModule.renderCopy: mismatched evidence.insightType");
    }
    return loggingConsistencyCopy(evidence);
  },
};

const behaviorMilestoneModule: SignalModule = {
  id: "behavior_milestone",
  signalClass: "milestone",
  voice: "observer",
  version: 1,
  evidenceWindow: { kind: "milestone-identity" },
  // Only the single surfaced candidate flows through the generic registry
  // contract — completedSilently (other thresholds newly crossed in the
  // same call) is bookkeeping, not a display candidate, and is persisted
  // directly by kain-signal-generate.server.ts via its own dedicated call
  // to detectBehaviorMilestone (see the comment there for why calling this
  // pure, side-effect-free function twice is an acceptable, cheap
  // trade-off against special-casing the registry loop).
  buildCandidate: (ctx) =>
    detectBehaviorMilestone({
      lifetimeMealCount: ctx.lifetimeMealCount,
      lifetimeDistinctLoggingDays: ctx.lifetimeDistinctLoggingDays,
      recordedMilestoneKeys: ctx.recordedMilestoneKeys,
    }).surfaced,
  renderCopy: (evidence) => {
    if (evidence.insightType !== "behavior_milestone") {
      throw new Error("behaviorMilestoneModule.renderCopy: mismatched evidence.insightType");
    }
    return behaviorMilestoneCopy(evidence);
  },
};

const VALID_CLASSES: readonly SignalClass[] = ["reveal", "protect", "milestone"];
const VALID_VOICES: readonly SpecialistVoice[] = ["scientist", "coach", "observer"];

// Enforceable historical-evidence boundary (§4/§12): throws — does not warn,
// does not silently pass — when a module is misconfigured. This is what
// makes "a future signal module should fail validation if it does not
// demonstrate historical evidence" true structurally rather than by
// developer discipline alone.
export function validateSignalModule(module: SignalModule): void {
  if (!module.id) {
    throw new Error("SignalModule.id must be a non-empty string");
  }
  if (!VALID_CLASSES.includes(module.signalClass)) {
    throw new Error(`SignalModule "${module.id}": invalid signalClass "${module.signalClass}"`);
  }
  if (!VALID_VOICES.includes(module.voice)) {
    throw new Error(`SignalModule "${module.id}": invalid voice "${module.voice}"`);
  }
  if (module.signalClass === "milestone") {
    if (module.evidenceWindow.kind !== "milestone-identity") {
      throw new Error(
        `SignalModule "${module.id}": class "milestone" must declare evidenceWindow.kind === "milestone-identity"`,
      );
    }
  } else if (
    module.evidenceWindow.kind !== "rolling-days" ||
    module.evidenceWindow.minDistinctDays < 2
  ) {
    throw new Error(
      `SignalModule "${module.id}": non-milestone modules must require at least 2 distinct days of ` +
        `historical evidence (evidenceWindow = { kind: "rolling-days", minDistinctDays >= 2 }) — a ` +
        `same-day-only signal is prohibited`,
    );
  }
}

export function validateRegistry(modules: readonly SignalModule[]): void {
  const seenIds = new Set<string>();
  for (const module of modules) {
    validateSignalModule(module);
    if (seenIds.has(module.id)) {
      throw new Error(`Duplicate SignalModule id: "${module.id}"`);
    }
    seenIds.add(module.id);
  }
}

// Registration order has no ranking significance — kain-signal-selection.ts
// (milestone priority) and kain-signal-ranking.ts's
// INSIGHT_TYPE_PRIORITY_TIEBREAK are the only priority authorities.
// Approved current categories only — do not add speculative modules here.
export const SIGNAL_REGISTRY: readonly SignalModule[] = [
  proteinAdherenceModule,
  loggingConsistencyModule,
  behaviorMilestoneModule,
];

// Fails loudly at import time, not just in a test — a broken registry
// should never silently ship.
validateRegistry(SIGNAL_REGISTRY);
