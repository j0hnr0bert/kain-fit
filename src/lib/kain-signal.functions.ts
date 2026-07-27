// Thin createServerFn orchestration layer — mirrors food.functions.ts's
// shape (auth, fetch, delegate to a separately-callable function, return).
// All real decision-making lives in kain-signal-generate.server.ts and the
// pure src/lib/kain-signal-*.ts modules; nothing here computes anything.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TodaySignalPayload } from "./kain-signal-generate.server";

// Always recomputes via the pure pipeline — see After-Meal Re-Evaluation
// (KainSignal v2): a signal must be able to change after any meal is
// logged, not just once per day, so there is no "read the persisted row
// and skip generation" fast path here anymore. Recomputation itself is
// cheap (in-memory over already-small per-user data); what must stay cheap
// and rare is *persistence*, which generateTodaySignal's own
// change-triggered-write gate (kain-signal-freshness.ts) handles — a new
// kain_signal_insights row (and a possible on-screen change) is only ever
// written when today's winner is materially different from what's already
// persisted for today.
export const getKainSignalToday = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TodaySignalPayload> => {
    const { generateTodaySignal } = await import("./kain-signal-generate.server");
    return generateTodaySignal(context.userId, context.supabase);
  });

const feedbackInputSchema = z.object({
  insightId: z.string().uuid(),
  insightType: z.enum(["protein_adherence", "logging_consistency", "behavior_milestone"]),
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
