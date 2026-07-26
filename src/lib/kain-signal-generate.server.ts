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
import { classifyEvidenceStrength } from "./kain-signal-evidence-strength";
import { computeCountGates, finalizeReadiness, type ProgressLabel } from "./kain-signal-readiness";
import { computeDaysCompleteness } from "./kain-signal-day-completeness";
import { detectProteinAdherence } from "./kain-signal-detector-protein";
import { detectLoggingConsistency } from "./kain-signal-detector-logging-consistency";
import { rankInsights, selectTopInsight, type FeedbackSummary } from "./kain-signal-ranking";
import { NOT_QUITE_LOOKBACK_DAYS, SIGNAL_LOOKBACK_DAYS } from "./kain-signal-config";
import type { FoodEntryLite, InsightEvidence, InsightType, SignalState } from "./kain-signal-types";

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

  const proteinEvidence = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG });
  const loggingEvidence = detectLoggingConsistency({
    activeDays,
    todayManila,
    windowDays: SIGNAL_LOOKBACK_DAYS,
  });

  const countGates = computeCountGates(entries);
  const readiness = finalizeReadiness(countGates, [
    proteinEvidence?.evidenceStrength ?? null,
    loggingEvidence?.evidenceStrength ?? null,
  ]);

  const ranked = rankInsights([proteinEvidence, loggingEvidence], feedback);
  const top = selectTopInsight(ranked);

  // Monotonic-state rule: a user who was ever Connected stays Connected —
  // a single weaker day never demotes them back to Building/Eligible.
  // Otherwise, Connected is only reached the first time the count gates
  // pass AND ranking actually found a real insight to show — gates alone
  // are not enough (classifyEvidenceStrength's null return already
  // enforces "must have at least one insight that is evidence-supported,
  // relevant, actionable" before this point).
  const finalState: SignalState = wasConnected
    ? "connected"
    : readiness.state === "eligible" && top !== null
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

  let selectedInsight: SelectedInsightPayload | null = null;
  if (ranked.length > 0) {
    const insightRows = ranked.map((candidate) => ({
      user_id: userId,
      state_id: stateId,
      computed_for_day: todayManila,
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
    }));
    const { data: insertedInsights, error: insightWriteError } = await supabaseAdmin
      .from("kain_signal_insights")
      .insert(insightRows)
      .select("id,insight_type,evidence_strength,evidence,recommended_action_key,is_selected");
    if (insightWriteError) throw new Error(insightWriteError.message);
    const selectedRow = (insertedInsights ?? []).find((r) => r.is_selected);
    if (selectedRow) {
      selectedInsight = {
        id: selectedRow.id,
        insightType: selectedRow.insight_type as InsightType,
        evidenceStrength: selectedRow.evidence_strength as InsightEvidence["evidenceStrength"],
        evidence: selectedRow.evidence as unknown as InsightEvidence,
        recommendedActionKey: selectedRow.recommended_action_key,
      };
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
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("kain_signal_events").insert({
        user_id: userId,
        insight_id: yesterdayInsightId,
        event_type: "behavior_observed",
        event_properties: {},
      });
    }
  }

  return {
    state: finalState,
    progressLabel: finalState === "building" ? readiness.progressLabel : null,
    selectedInsight,
  };
}
