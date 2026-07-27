// Server-only orchestration for KainSignal Phase 1. Thin by design: every
// real decision (readiness, detection, ranking, copy) happens in the pure
// src/lib/kain-signal-*.ts modules; this module's only job is fetching the
// user's own data (via their RLS-scoped client — never supabaseAdmin for
// reads, since a user reading their own food history needs no elevated
// privilege), running the pure pipeline, and persisting the result via
// supabaseAdmin (insight generation is privileged — see the migration's
// RLS policies, which grant authenticated users SELECT only).
//
// Mirrors food-records.server.ts's shape: a single exported async function
// wrapping a tested pure pipeline, imported dynamically from the
// createServerFn handler in kain-signal.functions.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { addDaysISO, manilaDay } from "./retention";
import { computeCountGates, finalizeReadiness, type ProgressLabel } from "./kain-signal-readiness";
import { computeDaysCompleteness } from "./kain-signal-day-completeness";
import { SIGNAL_REGISTRY, type SignalContext } from "./kain-signal-registry";
import { rankInsights, type FeedbackSummary } from "./kain-signal-ranking";
import {
  patternOnlyEvidenceStrengths,
  selectPatternTop,
  selectWinner,
} from "./kain-signal-selection";
import { detectBehaviorMilestone, milestoneKey } from "./kain-signal-detector-milestone";
import { isMaterialChange, type SignalSelection } from "./kain-signal-freshness";
import { NOT_QUITE_LOOKBACK_DAYS, SIGNAL_LOOKBACK_DAYS } from "./kain-signal-config";
import type {
  FoodEntryLite,
  InsightEvidence,
  InsightType,
  MilestoneEvidence,
  MilestoneType,
  SignalState,
} from "./kain-signal-types";

export type SelectedInsightPayload = {
  id: string;
  insightType: InsightType;
  evidenceStrength: InsightEvidence["evidenceStrength"];
  evidence: InsightEvidence;
  recommendedActionKey: string;
};

export type TodaySignalPayload = {
  state: SignalState;
  progressLabel: ProgressLabel | null;
  selectedInsight: SelectedInsightPayload | null;
};

export async function generateTodaySignal(
  userId: string,
  supabase: SupabaseClient<Database>,
): Promise<TodaySignalPayload> {
  const todayManila = manilaDay(new Date().toISOString());
  const lookbackStart = addDaysISO(todayManila, -(SIGNAL_LOOKBACK_DAYS - 1));

  const { data: priorStates, error: priorStateError } = await supabase
    .from("kain_signal_states")
    .select("state")
    .eq("user_id", userId)
    .order("computed_for_day", { ascending: false })
    .limit(1);
  if (priorStateError) throw new Error(priorStateError.message);
  const wasConnected = priorStates?.[0]?.state === "connected";

  // Fetch a slightly wider UTC range than the exact Manila window needs
  // (one extra day of slack on each side), then filter to the exact
  // Manila-day window in memory using the same manilaDay() every other
  // stage uses — simpler and less error-prone than deriving a precise
  // Manila-midnight-to-UTC boundary here, and the lookback window is small
  // enough that the extra day of data is negligible.
  const bufferStart = addDaysISO(lookbackStart, -1);
  const bufferEndExclusive = addDaysISO(todayManila, 1);
  const { data: rawEntries, error: entriesError } = await supabase
    .from("food_entries")
    .select("logged_at,calories,protein_g,carbs_g,fat_g,data_source,is_estimate,confidence")
    .eq("user_id", userId)
    .gte("logged_at", `${bufferStart}T00:00:00.000Z`)
    .lt("logged_at", `${bufferEndExclusive}T00:00:00.000Z`)
    .order("logged_at", { ascending: true });
  if (entriesError) throw new Error(entriesError.message);
  const entries: FoodEntryLite[] = (rawEntries ?? [])
    .filter((e) => {
      const day = manilaDay(e.logged_at);
      return day >= lookbackStart && day <= todayManila;
    })
    .map((e) => ({
      logged_at: e.logged_at,
      calories: e.calories,
      protein_g: e.protein_g,
      carbs_g: e.carbs_g,
      fat_g: e.fat_g,
      data_source: e.data_source,
      is_estimate: e.is_estimate,
      confidence: e.confidence,
    }));

  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("manual_targets_enabled,target_protein_g")
    .eq("user_id", userId)
    .limit(1);
  if (profileError) throw new Error(profileError.message);
  const profile = profileRows?.[0];
  const proteinTargetG =
    profile?.manual_targets_enabled && profile.target_protein_g ? profile.target_protein_g : null;

  const { data: feedbackRows, error: feedbackError } = await supabase
    .from("kain_signal_feedback")
    .select("insight_type,feedback_kind,created_at")
    .eq("user_id", userId);
  if (feedbackError) throw new Error(feedbackError.message);
  const notQuiteSince = `${addDaysISO(todayManila, -(NOT_QUITE_LOOKBACK_DAYS - 1))}T00:00:00.000Z`;
  const feedback: Partial<Record<InsightType, FeedbackSummary>> = {};
  for (const row of feedbackRows ?? []) {
    const type = row.insight_type as InsightType;
    const existing = feedback[type] ?? { notQuiteCount: 0, dontUseThisEver: false };
    if (row.feedback_kind === "dont_use_this") existing.dontUseThisEver = true;
    if (row.feedback_kind === "not_quite" && row.created_at >= notQuiteSince) {
      existing.notQuiteCount += 1;
    }
    feedback[type] = existing;
  }

  const daysCompleteness = computeDaysCompleteness(entries);
  const completeDays = Object.values(daysCompleteness)
    .filter((d) => d.isReasonablyComplete)
    .map((d) => d.day);
  const entriesByDay: Record<string, FoodEntryLite[]> = {};
  for (const entry of entries) {
    const day = manilaDay(entry.logged_at);
    (entriesByDay[day] ??= []).push(entry);
  }
  const activeDays = Object.keys(daysCompleteness);

  // behavior_milestone is a lifetime fact, not bound to
  // SIGNAL_LOOKBACK_DAYS's rolling window — a user with more than 60 days
  // of history could have crossed a milestone long before it would appear
  // in `entries` above. One extra lightweight query (logged_at only, no
  // other columns) covers both the lifetime meal count and the lifetime
  // distinct-day count without a second round trip.
  const { data: allLoggedAt, error: allLoggedAtError } = await supabase
    .from("food_entries")
    .select("logged_at")
    .eq("user_id", userId);
  if (allLoggedAtError) throw new Error(allLoggedAtError.message);
  const lifetimeMealCount = allLoggedAt?.length ?? 0;
  const lifetimeDistinctLoggingDays = new Set(
    (allLoggedAt ?? []).map((e) => manilaDay(e.logged_at)),
  ).size;

  // Milestone dedup identity (§9/§6): every milestoneType:threshold this
  // user has EVER had recorded (any day, is_selected or not) — a threshold
  // must never become a candidate again once it has been surfaced once.
  // Reads the dedicated milestone_type/milestone_threshold columns (added
  // 2026-07-27 alongside the DB uniqueness constraint) rather than parsing
  // the evidence JSONB — the same real columns the uniqueness constraint
  // and the atomic replacement RPC key off of. See
  // kain-signal-detector-milestone.ts.
  const { data: milestoneRows, error: milestoneRowsError } = await supabase
    .from("kain_signal_insights")
    .select("milestone_type,milestone_threshold")
    .eq("user_id", userId)
    .eq("insight_type", "behavior_milestone");
  if (milestoneRowsError) throw new Error(milestoneRowsError.message);
  const recordedMilestoneKeys = new Set(
    (milestoneRows ?? [])
      .filter((row) => row.milestone_type !== null && row.milestone_threshold !== null)
      .map((row) =>
        milestoneKey(row.milestone_type as MilestoneType, row.milestone_threshold as number),
      ),
  );

  // Signal Registry (kain-signal-registry.ts): every approved category's
  // detector is invoked identically through SIGNAL_REGISTRY rather than by
  // name, so a future category only needs a new registry entry, not a
  // change to this loop.
  const signalCtx: SignalContext = {
    entriesByDay,
    completeDays,
    activeDays,
    todayManila,
    windowDays: SIGNAL_LOOKBACK_DAYS,
    proteinTargetG,
    lifetimeMealCount,
    lifetimeDistinctLoggingDays,
    recordedMilestoneKeys,
  };
  const candidates = SIGNAL_REGISTRY.map((module) => module.buildCandidate(signalCtx));

  // Multi-threshold / bootstrap policy (§2): a single direct call
  // alongside the registry loop above — detectBehaviorMilestone is pure
  // and cheap (a handful of array scans, no I/O), so calling it a second
  // time here (with the exact same inputs the registry's own module
  // wrapper already used to produce `candidates`) is a trivial, side-
  // effect-free redundancy, not a real cost — and it keeps the generic
  // SignalModule.buildCandidate contract (one evidence value out) fully
  // intact rather than special-casing the registry loop for milestone's
  // richer {surfaced, completedSilently} result. completedSilently is
  // persisted unconditionally below, independent of materialChange —
  // every newly-crossed threshold must be recorded in this exact call so
  // it can never drip-feed across future calls.
  const milestoneDetection = detectBehaviorMilestone({
    lifetimeMealCount,
    lifetimeDistinctLoggingDays,
    recordedMilestoneKeys,
  });

  const countGates = computeCountGates(entries);
  // Module-level readiness (2026-07-27 correction): the global count-gate
  // trust bar exists to protect PATTERN modules (protein_adherence,
  // logging_consistency) from claiming a trend before the user has given
  // KainFit enough overall usage to back it — it was never meant to gate
  // milestones, which are independently-certain lifetime facts, not
  // confidence-graded patterns. Scoping hasRepeatedPattern to pattern-class
  // evidence only fixes both directions of the coupling: a milestone can no
  // longer be blocked by pattern-readiness, and a milestone can no longer
  // inflate pattern-readiness on its own — "connected" keeps meaning "a
  // real pattern was found," never "some KainSignal thing happened."
  const readiness = finalizeReadiness(countGates, patternOnlyEvidenceStrengths(candidates));

  const ranked = rankInsights(candidates, feedback);
  // Selection policy (§8): a newly-crossed milestone always outranks a
  // reveal/protect candidate for DISPLAY/PERSISTENCE — see
  // kain-signal-selection.ts. Everything else falls back to the unchanged
  // ranking engine.
  const top = selectWinner(ranked);
  // Separately: whether a genuine PATTERN is ready to move the lifetime
  // SignalState to "connected" — independent of whether a milestone
  // happens to outrank it for today's display/selection. A milestone must
  // never single-handedly grant "connected," and must never be blocked by
  // it either — see the finalState computation and today.tsx's
  // kainSignalEligible, which renders a milestone regardless of state.
  const patternTop = selectPatternTop(ranked);

  // After-Meal Re-Evaluation (freshness): fetch whatever is currently the
  // displayed insight for today (if any) so the fresh computation above can
  // be compared against it — see kain-signal-freshness.ts. This read uses
  // the RLS-scoped client (authenticated has SELECT on kain_signal_insights)
  // like every other read in this function.
  const { data: existingTodayInsights, error: existingInsightsError } = await supabase
    .from("kain_signal_insights")
    .select("id,insight_type,evidence_strength,evidence,recommended_action_key")
    .eq("user_id", userId)
    .eq("computed_for_day", todayManila)
    .eq("is_selected", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existingInsightsError) throw new Error(existingInsightsError.message);
  const previousSelectedRow = existingTodayInsights?.[0] ?? null;
  const previousSelection: SignalSelection = previousSelectedRow
    ? {
        insightType: previousSelectedRow.insight_type as InsightType,
        evidence: previousSelectedRow.evidence as unknown as InsightEvidence,
      }
    : null;
  const nextSelection: SignalSelection = top
    ? { insightType: top.insightType, evidence: top.evidence }
    : null;
  const materialChange = isMaterialChange(previousSelection, nextSelection);

  // Monotonic-state rule: a user who was ever Connected stays Connected —
  // a single weaker day never demotes them back to Building/Eligible.
  // Otherwise, Connected is only reached the first time the count gates
  // pass AND a genuine PATTERN was actually ranked to show — gates alone
  // are not enough (classifyEvidenceStrength's null return already
  // enforces "must have at least one insight that is evidence-supported,
  // relevant, actionable" before this point). Checked against patternTop,
  // not top — a milestone winning today's display must never by itself
  // flip this user's lifetime state to "connected".
  const finalState: SignalState = wasConnected
    ? "connected"
    : readiness.state === "eligible" && patternTop !== null
      ? "connected"
      : readiness.state;

  // Generation is privileged: authenticated users are granted SELECT only
  // on kain_signal_states/kain_signal_insights (see the migration's RLS
  // policies) — INSERT/UPDATE require service_role. Using the RLS-scoped
  // `supabase` param here would fail with "permission denied for table
  // kain_signal_states", exactly as it did before this fix. This mirrors
  // the same supabaseAdmin pattern already used below for the
  // behavior_observed write.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: upsertedStates, error: stateWriteError } = await supabaseAdmin
    .from("kain_signal_states")
    .upsert(
      {
        user_id: userId,
        computed_for_day: todayManila,
        state: finalState,
        gates_met: readiness.gatesMet,
        gate_results: readiness.gateResults,
        composite_score: readiness.compositeScore,
        progress_label: readiness.progressLabel,
        active_logging_days: readiness.gateResults.activeLoggingDays,
        qualifying_entries: readiness.gateResults.qualifyingEntries,
        reasonably_complete_days: readiness.gateResults.reasonablyCompleteDays,
      },
      { onConflict: "user_id,computed_for_day" },
    )
    .select("id");
  if (stateWriteError) throw new Error(stateWriteError.message);
  const stateId = upsertedStates?.[0]?.id;
  if (!stateId) throw new Error("KainSignal: failed to persist today's state row");

  // Multi-threshold / bootstrap completion (§2, §6): every OTHER
  // newly-crossed threshold from this exact call — not the one surfaced —
  // must be recorded so it can never become a candidate again on a future
  // call. These rows are folded into the SAME p_rows batch passed to
  // kain_signal_replace_selection below (2026-07-27 atomicity correction)
  // rather than written via a separate call, so a surfaced winner and its
  // sibling completions can never partially persist — either the whole
  // batch commits in one transaction, or none of it does. Each still
  // resolves an identity conflict via ON CONFLICT DO NOTHING (the RPC's
  // existing per-row handling), unchanged.
  const completionInsightRows = milestoneDetection.completedSilently.map((c) => {
    const evidence: MilestoneEvidence = {
      insightType: "behavior_milestone",
      milestoneType: c.milestoneType,
      threshold: c.threshold,
      observedValue: c.observedValue,
      evidenceStrength: "strong_signal",
    };
    return {
      insight_type: "behavior_milestone" as const,
      evidence_strength: "strong_signal" as const,
      rank_score: 0,
      is_selected: false,
      evidence,
      observation_facts: evidence,
      recommended_action_key: "behavior_milestone",
      suppressed: false,
      milestone_type: c.milestoneType,
      milestone_threshold: c.threshold,
    };
  });

  // Change-triggered persistence: a new kain_signal_insights row (and a
  // possible on-screen change) is only written when today's winner is
  // materially different from what's already persisted for today — see
  // kain-signal-freshness.ts. An unchanged winner reuses the existing row's
  // id (so KainSignalCard's remount-keyed entrance animation correctly does
  // NOT replay), rather than fabricating a new one. Pending silent
  // completions must still persist even on a call where the WINNER didn't
  // change (e.g. the winning milestone is feedback-suppressed and a
  // pattern wins instead) — see shouldPersist below.
  const shouldPersist = materialChange || completionInsightRows.length > 0;
  let selectedInsight: SelectedInsightPayload | null = null;
  if (!shouldPersist) {
    selectedInsight = previousSelectedRow
      ? {
          id: previousSelectedRow.id,
          insightType: previousSelectedRow.insight_type as InsightType,
          evidenceStrength:
            previousSelectedRow.evidence_strength as InsightEvidence["evidenceStrength"],
          evidence: previousSelectedRow.evidence as unknown as InsightEvidence,
          recommendedActionKey: previousSelectedRow.recommended_action_key,
        }
      : null;
  } else if (ranked.length > 0 || completionInsightRows.length > 0) {
    // Atomic selection replacement (2026-07-27 hardening pass): the old
    // two-statement flow (UPDATE is_selected=false, then INSERT) was not
    // atomic — a failure between the two could leave a user with no
    // selected insight, and two overlapping calls could interleave their
    // clear/insert steps. kain_signal_replace_selection() does both inside
    // one transaction, serialized per user+day via an advisory lock (see
    // the migration), and never lets a milestone identity conflict error
    // out (ON CONFLICT DO NOTHING) — see supabase/migrations/
    // 20260727130000_....sql. completionInsightRows ride in the SAME
    // p_rows batch (2026-07-27 atomicity correction, §3) so a surfaced
    // winner and its sibling silent completions commit or roll back
    // together — never split across two separate statements.
    const rankedInsightRows = ranked.map((candidate) => {
      const isMilestone = candidate.insightType === "behavior_milestone";
      const milestoneEvidence = isMilestone ? (candidate.evidence as MilestoneEvidence) : null;
      return {
        insight_type: candidate.insightType,
        evidence_strength: candidate.evidence.evidenceStrength,
        rank_score: candidate.rankScore,
        is_selected: top !== null && candidate === top,
        // evidence and observation_facts are the same object in Phase 1 —
        // the evidence objects are already minimal (no extraneous fields
        // beyond what copy generation needs), so a second derived shape
        // would only duplicate information, not add any.
        evidence: candidate.evidence,
        observation_facts: candidate.evidence,
        recommended_action_key: candidate.insightType,
        suppressed: candidate.suppressed,
        milestone_type: milestoneEvidence?.milestoneType ?? null,
        milestone_threshold: milestoneEvidence?.threshold ?? null,
      };
    });
    const { data: replacedRows, error: replaceError } = await supabaseAdmin.rpc(
      "kain_signal_replace_selection",
      {
        p_user_id: userId,
        p_state_id: stateId,
        p_computed_for_day: todayManila,
        p_rows: [...rankedInsightRows, ...completionInsightRows],
      },
    );
    if (replaceError) throw new Error(replaceError.message);
    const selectedRow = (replacedRows ?? []).find((r) => r.is_selected);
    if (selectedRow) {
      selectedInsight = {
        id: selectedRow.id,
        insightType: selectedRow.insight_type as InsightType,
        evidenceStrength: selectedRow.evidence_strength as InsightEvidence["evidenceStrength"],
        evidence: selectedRow.evidence as unknown as InsightEvidence,
        recommendedActionKey: selectedRow.recommended_action_key,
      };
    } else if (top !== null) {
      // Edge case: our intended winner conflicted with a concurrently
      // inserted duplicate (milestone-identity race) and was skipped by ON
      // CONFLICT DO NOTHING. Read back whatever the database now considers
      // the actual current selection for today, rather than returning
      // nothing to the client.
      const { data: fallbackSelected } = await supabase
        .from("kain_signal_insights")
        .select("id,insight_type,evidence_strength,evidence,recommended_action_key")
        .eq("user_id", userId)
        .eq("computed_for_day", todayManila)
        .eq("is_selected", true)
        .order("created_at", { ascending: false })
        .limit(1);
      const fallbackRow = fallbackSelected?.[0];
      if (fallbackRow) {
        selectedInsight = {
          id: fallbackRow.id,
          insightType: fallbackRow.insight_type as InsightType,
          evidenceStrength: fallbackRow.evidence_strength as InsightEvidence["evidenceStrength"],
          evidence: fallbackRow.evidence as unknown as InsightEvidence,
          recommendedActionKey: fallbackRow.recommended_action_key,
        };
      }
    }
  }

  // Minimal behavior_observed measurement (Phase 1 scope — see the
  // implementation plan's deviation #5: outcome_improved is schema-reserved
  // but not computed yet). If yesterday had a selected insight, and the
  // user logged at least one entry today, record that the recommended
  // behavior window was engaged. No scheduled job — this piggybacks on the
  // next day's generateTodaySignal call.
  const yesterdayManila = addDaysISO(todayManila, -1);
  const { data: yesterdayStates } = await supabase
    .from("kain_signal_states")
    .select("id")
    .eq("user_id", userId)
    .eq("computed_for_day", yesterdayManila)
    .limit(1);
  const yesterdayStateId = yesterdayStates?.[0]?.id;
  if (yesterdayStateId) {
    const { data: yesterdaySelected } = await supabase
      .from("kain_signal_insights")
      .select("id")
      .eq("state_id", yesterdayStateId)
      .eq("is_selected", true)
      .limit(1);
    const yesterdayInsightId = yesterdaySelected?.[0]?.id;
    const hasLoggedToday = entries.some((e) => manilaDay(e.logged_at) === todayManila);
    if (yesterdayInsightId && hasLoggedToday) {
      // Dedup guard: generateTodaySignal now runs on every load/meal-save
      // (see After-Meal Re-Evaluation), not once per day, so this branch is
      // reachable many times for the same yesterdayInsightId — without this
      // check it would insert a duplicate behavior_observed row on every
      // call instead of exactly one.
      const { data: existingBehaviorEvent } = await supabase
        .from("kain_signal_events")
        .select("id")
        .eq("insight_id", yesterdayInsightId)
        .eq("event_type", "behavior_observed")
        .limit(1);
      if (!existingBehaviorEvent || existingBehaviorEvent.length === 0) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("kain_signal_events").insert({
          user_id: userId,
          insight_id: yesterdayInsightId,
          event_type: "behavior_observed",
          event_properties: {},
        });
      }
    }
  }

  return {
    state: finalState,
    progressLabel: finalState === "building" ? readiness.progressLabel : null,
    selectedInsight,
  };
}
