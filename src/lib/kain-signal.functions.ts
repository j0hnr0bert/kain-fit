// Thin createServerFn orchestration layer — mirrors food.functions.ts's
// shape (auth, fetch, delegate to a separately-callable function, return).
// All real decision-making lives in kain-signal-generate.server.ts and the
// pure src/lib/kain-signal-*.ts modules; nothing here computes anything.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TodaySignalPayload } from "./kain-signal-generate.server";
import type { ProgressLabel } from "./kain-signal-readiness";
import type { InsightEvidence, InsightType, SignalState } from "./kain-signal-types";

// Reads today's already-computed KainSignal state if one exists (the cheap,
// common path for every load after the first one on a given day) or
// generates it on first load of the day. This is the durable-row
// equivalent of the in-process TTL cache used elsewhere in this codebase
// (e.g. ops-settings.server.ts) — DB-persisted instead of in-memory, since
// insights must be reconstructable/auditable, not just cheap to recompute.
export const getKainSignalToday = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TodaySignalPayload> => {
    const { manilaDay } = await import("./retention");
    const todayManila = manilaDay(new Date().toISOString());

    const { data: existingStates, error: stateError } = await context.supabase
      .from("kain_signal_states")
      .select("id,state,progress_label")
      .eq("user_id", context.userId)
      .eq("computed_for_day", todayManila)
      .limit(1);
    if (stateError) throw new Error(stateError.message);
    const existingState = existingStates?.[0];

    if (!existingState) {
      const { generateTodaySignal } = await import("./kain-signal-generate.server");
      return generateTodaySignal(context.userId, context.supabase);
    }

    const { data: existingInsights, error: insightError } = await context.supabase
      .from("kain_signal_insights")
      .select("id,insight_type,evidence_strength,evidence,recommended_action_key")
      .eq("state_id", existingState.id)
      .eq("is_selected", true)
      .limit(1);
    if (insightError) throw new Error(insightError.message);
    const selectedRow = existingInsights?.[0];

    const state = existingState.state as SignalState;
    return {
      state,
      progressLabel:
        state === "building" ? (existingState.progress_label as ProgressLabel | null) : null,
      selectedInsight: selectedRow
        ? {
            id: selectedRow.id,
            insightType: selectedRow.insight_type as InsightType,
            evidenceStrength: selectedRow.evidence_strength as InsightEvidence["evidenceStrength"],
            evidence: selectedRow.evidence as unknown as InsightEvidence,
            recommendedActionKey: selectedRow.recommended_action_key,
          }
        : null,
    };
  });

const feedbackInputSchema = z.object({
  insightId: z.string().uuid(),
  insightType: z.enum(["protein_adherence", "logging_consistency"]),
  kind: z.enum(["not_quite", "dont_use_this"]),
});

// Corrective memory. Two plain, RLS-permitted inserts — no admin needed,
// since a user recording feedback on an insight shown to them is entirely
// within their own data. Centralized here (rather than two separate client
// inserts) only because "record the feedback row and the corresponding
// 'corrected' event together" is a single cross-cutting write worth
// keeping atomic-in-intent, unlike the single-table shown/why_this_opened/
// accepted/dismissed events, which the UI inserts directly.
export const submitSignalFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => feedbackInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error: feedbackError } = await context.supabase.from("kain_signal_feedback").insert({
      user_id: context.userId,
      insight_id: data.insightId,
      insight_type: data.insightType,
      feedback_kind: data.kind,
    });
    if (feedbackError) throw new Error(feedbackError.message);

    const { error: eventError } = await context.supabase.from("kain_signal_events").insert({
      user_id: context.userId,
      insight_id: data.insightId,
      event_type: "corrected",
      event_properties: { feedback_kind: data.kind },
    });
    if (eventError) throw new Error(eventError.message);

    return { ok: true };
  });
