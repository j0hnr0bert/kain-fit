import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALLOWED_EVENTS = [
  "landing_viewed",
  "demo_started",
  "demo_food_submitted",
  "demo_food_confirmed",
  "signup_started",
  "signup_completed",
  "onboarding_completed",
  "food_submitted",
  "food_parse_succeeded",
  "food_parse_failed",
  "food_clarification_requested",
  "food_edited_before_confirmation",
  "food_confirmed",
  "food_deleted",
  "incorrect_macros_reported",
  "saved_meal_repeated",
  "feedback_submitted",
  "app_returned",
  "admin_dashboard_viewed",
  "app_loaded",
  "today_ready",
  "web_vital",
  "db_query_timing",
  "food_calc_timing",
  "food_save_timing",
  "cache_hit",
  "cache_miss",
  "ai_call_timing",
  "route_load_timing",
  "error_boundary",
  "food_search_started",
  "food_search_results_shown",
  "food_calculation_started",
  "food_calculation_completed",
  "food_log_saved",
  "performance_error",
  "auth_method_chosen",
  "signup_failed",
  "first_food_logged",
  "auth_attempt_completed",
] as const;

const eventSchema = z.object({
  event_name: z.enum(ALLOWED_EVENTS),
  anonymous_session_id: z.string().max(128).nullable().optional(),
  acquisition_source: z.string().max(64).nullable().optional(),
  event_properties: z.record(z.string(), z.unknown()).default({}),
});

function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  // Strip any keys that could carry sensitive data. We accept only known-safe keys.
  const SAFE_KEYS = new Set([
    "processing_duration_ms",
    "ai_parsing_ms",
    "total_processing_ms",
    "resolution_path",
    "cache_hit",
    "item_count",
    "timeout",
    "number_of_items",
    "input_language",
    "measurement_units",
    "clarification_required",
    "estimated_item_count",
    "verified_item_count",
    "device_category",
    "demo_or_registered",
    "acquisition_source",
    "issue_type",
    "confidence",
    "minutes_away",
    "meal_type",
    "reason",
    "error_code",
    "provider",
    "operation",
    "success",
    "status",
    "duration_ms",
    "platform",
    "mode",
    "method",
    "field_target",
    "correlation_id",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!SAFE_KEYS.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      out[k] = v.slice(0, 200);
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
}

async function userIdFromRequest(): Promise<string | null> {
  try {
    const req = getRequest();
    const authHeader = req?.headers?.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    if (token.split(".").length !== 3) return null;
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return data.claims.sub as string;
  } catch {
    return null;
  }
}

// Public event tracking. Accepts anonymous or authenticated callers.
export const trackEvent = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => eventSchema.parse(data))
  .handler(async ({ data }) => {
    const uid = await userIdFromRequest();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const props = sanitizeProps(data.event_properties ?? {});
    // Server-side duplicate suppression
    if (data.anonymous_session_id) {
      const { data: dup } = await (supabaseAdmin as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (a: string, b: string) => {
              eq: (a: string, b: string) => {
                gt: (a: string, b: string) => {
                  limit: (n: number) => Promise<{ data: unknown[] | null }>;
                };
              };
            };
          };
        };
      })
        .from("product_events")
        .select("id")
        .eq("anonymous_session_id", data.anonymous_session_id)
        .eq("event_name", data.event_name)
        .gt("created_at", new Date(Date.now() - 1000).toISOString())
        .limit(1);
      if (dup && dup.length > 0) return { ok: true, deduped: true };
    }

    const row = {
      user_id: uid,
      anonymous_session_id: data.anonymous_session_id ?? null,
      event_name: data.event_name,
      acquisition_source: data.acquisition_source ?? null,
      event_properties: props,
    };
    const { error } = await (supabaseAdmin as unknown as {
      from: (t: string) => { insert: (r: unknown) => Promise<{ error: { message: string } | null }> };
    })
      .from("product_events")
      .insert(row);
    if (error) console.error("[trackEvent]", error.message);
    return { ok: !error };
  });

// ============================================================
// Macro report (authenticated)
// ============================================================

const macroReportSchema = z.object({
  food_entry_id: z.string().uuid().nullable(),
  issue_type: z.enum([
    "calories",
    "protein",
    "carbs",
    "fat",
    "serving_quantity",
    "wrong_food",
    "other",
  ]),
  explanation: z.string().max(1000).nullable().optional(),
  original_values: z.record(z.string(), z.unknown()).default({}),
  corrected_values: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const submitMacroReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => macroReportSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      food_entry_id: data.food_entry_id,
      issue_type: data.issue_type,
      explanation: data.explanation ?? null,
      original_values: data.original_values ?? {},
      corrected_values: data.corrected_values ?? null,
    };
    const { error } = await (context.supabase as unknown as {
      from: (t: string) => { insert: (r: unknown) => Promise<{ error: { message: string } | null }> };
    })
      .from("macro_reports")
      .insert(row);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// Feedback (public — anonymous or authenticated)
// ============================================================

const feedbackSchema = z.object({
  anonymous_session_id: z.string().max(128).nullable().optional(),
  ease_rating: z.number().int().min(1).max(5).nullable().optional(),
  accuracy_rating: z.number().int().min(1).max(5).nullable().optional(),
  confusing: z.string().max(1000).nullable().optional(),
  missed_food: z.string().max(500).nullable().optional(),
  would_use_tomorrow: z.enum(["yes", "maybe", "no"]).nullable().optional(),
  comment: z.string().max(2000).nullable().optional(),
  allow_contact: z.boolean().default(false),
  acquisition_source: z.string().max(64).nullable().optional(),
});

export const submitFeedback = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => feedbackSchema.parse(d))
  .handler(async ({ data }) => {
    const uid = await userIdFromRequest();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = {
      user_id: uid,
      anonymous_session_id: data.anonymous_session_id ?? null,
      ease_rating: data.ease_rating ?? null,
      accuracy_rating: data.accuracy_rating ?? null,
      confusing: data.confusing ?? null,
      missed_food: data.missed_food ?? null,
      would_use_tomorrow: data.would_use_tomorrow ?? null,
      comment: data.comment ?? null,
      allow_contact: !!data.allow_contact,
      acquisition_source: data.acquisition_source ?? null,
    };
    const { error } = await (supabaseAdmin as unknown as {
      from: (t: string) => { insert: (r: unknown) => Promise<{ error: { message: string } | null }> };
    })
      .from("feedback_submissions")
      .insert(row);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// Signup funnel logging (public — anonymous or authenticated)
// ============================================================

const SIGNUP_STEPS = [
  "signup_form_viewed",
  "signup_email_entered",
  "signup_password_entered",
  "signup_submit_clicked",
  "signup_validation_failed",
  "signup_request_sent",
  "signup_request_error",
  "signup_email_verification_sent",
  "signup_completed",
  "oauth_google_started",
  "oauth_google_failed",
  "oauth_apple_started",
  "oauth_apple_failed",
] as const;

const signupFunnelSchema = z.object({
  step: z.enum(SIGNUP_STEPS),
  anonymous_session_id: z.string().min(1).max(128),
  reason: z.string().max(64).nullable().optional(),
  detail: z.string().max(500).nullable().optional(),
});

export const logSignupFunnelEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => signupFunnelSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      };
      await admin.rpc("log_signup_funnel_event", {
        _step: data.step,
        _anonymous_session_id: data.anonymous_session_id,
        _reason: data.reason ?? null,
        _detail: data.detail ?? null,
      });
    } catch (err) {
      console.error("[logSignupFunnelEvent]", err);
    }
    return { ok: true };
  });

// First-touch attribution. Writes profiles.first_touch_* exactly once per
// user (the SQL function is idempotent — it only updates when
// first_touched_at IS NULL). Callable by any authenticated user.
const firstTouchSchema = z.object({
  source: z.string().max(64).nullable().optional(),
  utm: z.record(z.string(), z.string().max(128)).nullable().optional(),
});

export const recordFirstTouch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => firstTouchSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    }).rpc("record_first_touch", {
      _source: data.source ?? null,
      _utm: data.utm ?? null,
    });
    if (error) {
      console.error("[recordFirstTouch]", error);
    }
    return { ok: true };
  });

export const getSignupFunnel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => Promise<{ data: unknown[] | null; error: unknown }>;
      };
    };
    const { data } = await admin
      .from("signup_funnel_events")
      .select("step,reason,detail,anonymous_session_id,created_at");
    const rows = (data ?? []) as Array<{
      step: string;
      reason: string | null;
      detail: string | null;
      anonymous_session_id: string;
      created_at: string;
    }>;

    // Count unique sessions per step (so a session that fires the same
    // step twice — e.g. refocuses the email field — counts once).
    const bySessions = new Map<string, Set<string>>();
    for (const step of SIGNUP_STEPS) bySessions.set(step, new Set());
    for (const r of rows) {
      const set = bySessions.get(r.step);
      if (set) set.add(r.anonymous_session_id);
    }
    const steps = SIGNUP_STEPS.map((step) => ({
      step,
      sessions: bySessions.get(step)!.size,
      events: rows.filter((r) => r.step === step).length,
    }));

    // Validation failure breakdown by reason.
    const validationReasons = new Map<string, number>();
    const recentErrors: Array<{ created_at: string; reason: string | null; detail: string | null }> = [];
    for (const r of rows) {
      if (r.step === "signup_validation_failed") {
        const key = r.reason ?? "unknown";
        validationReasons.set(key, (validationReasons.get(key) ?? 0) + 1);
      }
      if (r.step === "signup_request_error") {
        recentErrors.push({ created_at: r.created_at, reason: r.reason, detail: r.detail });
      }
    }
    recentErrors.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));

    // Request-error breakdown (by reason code / status).
    const requestErrorReasons = new Map<string, number>();
    for (const e of recentErrors) {
      const key = e.reason ?? "unknown";
      requestErrorReasons.set(key, (requestErrorReasons.get(key) ?? 0) + 1);
    }

    return {
      steps,
      validationReasons: Object.fromEntries(validationReasons),
      requestErrorReasons: Object.fromEntries(requestErrorReasons),
      recentErrors: recentErrors.slice(0, 20),
      totalEvents: rows.length,
    };
  });

// ============================================================
// Admin metrics
// ============================================================

async function ensureAdmin(ctx: {
  supabase: unknown;
  userId: string;
}): Promise<void> {
  const supa = ctx.supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (a: string, b: string) => {
          in: (a: string, b: string[]) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
  };
  const { data } = await supa
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .in("role", ["admin", "founder"]);
  if (!data || data.length === 0) throw new Error("Forbidden");
}

type EventRow = {
  id: string;
  user_id: string | null;
  anonymous_session_id: string | null;
  event_name: string;
  acquisition_source: string | null;
  event_properties: Record<string, unknown>;
  created_at: string;
};

type FeedbackRow = {
  id: string;
  user_id: string | null;
  ease_rating: number | null;
  accuracy_rating: number | null;
  confusing: string | null;
  missed_food: string | null;
  would_use_tomorrow: string | null;
  comment: string | null;
  allow_contact: boolean;
  acquisition_source: string | null;
  created_at: string;
};

type ReportRow = {
  id: string;
  user_id: string;
  food_entry_id: string | null;
  issue_type: string;
  explanation: string | null;
  resolution_status: string;
  created_at: string;
};

export const getBetaMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => Promise<{ data: unknown[] | null; error: unknown }>;
      };
    };

    const [eventsRes, feedbackRes, reportsRes] = await Promise.all([
      admin.from("product_events").select("*"),
      admin.from("feedback_submissions").select("*"),
      admin.from("macro_reports").select("*"),
    ]);

    const events = (eventsRes.data ?? []) as EventRow[];
    const feedback = (feedbackRes.data ?? []) as FeedbackRow[];
    const reports = (reportsRes.data ?? []) as ReportRow[];

    // Unique visitors — sessions with any landing_viewed or demo_started
    const uniqueSessions = new Set(
      events
        .filter((e) => e.anonymous_session_id)
        .map((e) => e.anonymous_session_id as string),
    );

    const count = (n: string) => events.filter((e) => e.event_name === n).length;

    const parseSuccess = count("food_parse_succeeded");
    const parseFail = count("food_parse_failed");
    const totalParses = parseSuccess + parseFail;

    const durations = events
      .filter((e) => e.event_name === "food_parse_succeeded")
      .map((e) => Number((e.event_properties as Record<string, unknown>)?.processing_duration_ms))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const median = durations.length
      ? durations[Math.floor(durations.length / 2)]
      : 0;

    // Percentiles and threshold coverage
    const pct = (arr: number[], p: number) => {
      if (!arr.length) return 0;
      const idx = Math.min(arr.length - 1, Math.floor((p / 100) * arr.length));
      return arr[idx];
    };
    const pctUnder = (arr: number[], ms: number) =>
      arr.length ? arr.filter((n) => n <= ms).length / arr.length : 0;
    const aiDurations = events
      .filter((e) => e.event_name === "food_parse_succeeded")
      .map((e) => Number((e.event_properties as Record<string, unknown>)?.ai_parsing_ms))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const timeoutCount = events.filter(
      (e) =>
        e.event_name === "food_parse_failed" &&
        typeof (e.event_properties as Record<string, unknown>)?.reason === "string" &&
        ((e.event_properties as Record<string, unknown>).reason as string).toLowerCase().includes("timeout"),
    ).length;
    const performance = {
      samples: durations.length,
      p50: Math.round(pct(durations, 50)),
      p75: Math.round(pct(durations, 75)),
      p90: Math.round(pct(durations, 90)),
      p95: Math.round(pct(durations, 95)),
      under3s: pctUnder(durations, 3000),
      under5s: pctUnder(durations, 5000),
      under8s: pctUnder(durations, 8000),
      under10s: pctUnder(durations, 10000),
      aiP50: Math.round(pct(aiDurations, 50)),
      aiP95: Math.round(pct(aiDurations, 95)),
      timeoutRate: totalParses ? timeoutCount / totalParses : 0,
    };

    // Resolution path + cache-hit breakdown
    const successEvents = events.filter((e) => e.event_name === "food_parse_succeeded");
    const resolutionCounts: Record<string, number> = {};
    let cacheHits = 0;
    for (const e of successEvents) {
      const p = e.event_properties as Record<string, unknown>;
      const path = typeof p?.resolution_path === "string" ? (p.resolution_path as string) : "unknown";
      resolutionCounts[path] = (resolutionCounts[path] ?? 0) + 1;
      if (p?.cache_hit === true) cacheHits += 1;
    }
    const cacheHitRate = successEvents.length ? cacheHits / successEvents.length : 0;

    // Live cache table stats
    let cacheStats: {
      total_entries: number;
      live_entries: number;
      total_hits: number;
      hits_last_24h: number;
    } = { total_entries: 0, live_entries: 0, total_hits: 0, hits_last_24h: 0 };
    try {
      const statsRes = await (admin as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      }).rpc("get_food_parse_cache_stats", {});
      if (Array.isArray(statsRes.data) && statsRes.data.length > 0) {
        const row = statsRes.data[0] as Record<string, unknown>;
        cacheStats = {
          total_entries: Number(row.total_entries ?? 0),
          live_entries: Number(row.live_entries ?? 0),
          total_hits: Number(row.total_hits ?? 0),
          hits_last_24h: Number(row.hits_last_24h ?? 0),
        };
      }
    } catch (err) {
      console.error("[beta] cache stats failed", err);
    }

    const confirmedUsers = new Set(
      events
        .filter((e) => e.event_name === "food_confirmed" && e.user_id)
        .map((e) => e.user_id as string),
    );
    const firstConfirmedByUser = confirmedUsers.size;

    // Day-1 and Day-7 return: sign-ups whose user_id also has app_returned or food_confirmed later
    const signups = new Map<string, string>(); // user_id -> created_at
    for (const e of events) {
      if (e.event_name === "signup_completed" && e.user_id) {
        if (!signups.has(e.user_id)) signups.set(e.user_id, e.created_at);
      }
    }
    const userActivity = new Map<string, string[]>();
    for (const e of events) {
      if (!e.user_id) continue;
      if (!userActivity.has(e.user_id)) userActivity.set(e.user_id, []);
      userActivity.get(e.user_id)!.push(e.created_at);
    }
    let d1 = 0;
    let d7 = 0;
    for (const [uid, signupAt] of signups) {
      const s = new Date(signupAt).getTime();
      const acts = userActivity.get(uid) ?? [];
      if (acts.some((t) => {
        const dt = new Date(t).getTime() - s;
        return dt > 20 * 60 * 60 * 1000 && dt < 48 * 60 * 60 * 1000;
      })) d1 += 1;
      if (acts.some((t) => {
        const dt = new Date(t).getTime() - s;
        return dt > 6 * 24 * 60 * 60 * 1000 && dt < 8 * 24 * 60 * 60 * 1000;
      })) d7 += 1;
    }

    // Confirmed entries per active user (users with any food_confirmed)
    const confirmedByUser = new Map<string, number>();
    for (const e of events) {
      if (e.event_name === "food_confirmed" && e.user_id) {
        confirmedByUser.set(e.user_id, (confirmedByUser.get(e.user_id) ?? 0) + 1);
      }
    }
    const activeUsers = confirmedByUser.size;
    const avgConfirmed = activeUsers
      ? Array.from(confirmedByUser.values()).reduce((a, b) => a + b, 0) / activeUsers
      : 0;

    // Acquisition breakdown
    const bySource: Record<string, number> = {};
    for (const s of uniqueSessions) {
      const src =
        events.find((e) => e.anonymous_session_id === s && e.acquisition_source)
          ?.acquisition_source ?? "(direct)";
      bySource[src] = (bySource[src] ?? 0) + 1;
    }

    const correctionRate = parseSuccess
      ? count("incorrect_macros_reported") / parseSuccess
      : 0;

    return {
      uniqueVisitors: uniqueSessions.size,
      demoStarts: count("demo_started"),
      signupsStarted: count("signup_started"),
      signupsCompleted: count("signup_completed"),
      firstConfirmedByUser,
      medianProcessingMs: Math.round(median),
      parseFailureRate: totalParses ? parseFail / totalParses : 0,
      correctionRate,
      incorrectMacroReports: reports.length,
      day1Return: d1,
      day7Return: d7,
      avgConfirmedPerActiveUser: Number(avgConfirmed.toFixed(2)),
      activeUsers,
      acquisitionBreakdown: bySource,
      performance,
      resolution: {
        counts: resolutionCounts,
        cacheHits,
        cacheHitRate,
        cacheStats,
      },
      recentFeedback: feedback
        .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
        .slice(0, 20)
        .map((f) => ({
          id: f.id,
          created_at: f.created_at,
          ease_rating: f.ease_rating,
          accuracy_rating: f.accuracy_rating,
          would_use_tomorrow: f.would_use_tomorrow,
          confusing: f.confusing,
          missed_food: f.missed_food,
          comment: f.comment,
          allow_contact: f.allow_contact,
          acquisition_source: f.acquisition_source,
        })),
      recentReports: reports
        .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
        .slice(0, 20)
        .map((r) => ({
          id: r.id,
          created_at: r.created_at,
          issue_type: r.issue_type,
          explanation: r.explanation,
          resolution_status: r.resolution_status,
        })),
    };
  });

// Aggregated CSV export (no raw food text, no PII beyond aggregates)
export const exportBetaCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ kind: z.enum(["metrics", "feedback"]) }).parse(d))
  .handler(async ({ context, data }) => {
    await ensureAdmin(context);
    const metrics = await (async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as {
        from: (t: string) => {
          select: (c: string) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
      const [ev, fb] = await Promise.all([
        admin.from("product_events").select("event_name,acquisition_source,anonymous_session_id,user_id,created_at,event_properties"),
        admin.from("feedback_submissions").select("ease_rating,accuracy_rating,would_use_tomorrow,confusing,missed_food,comment,allow_contact,acquisition_source,created_at"),
      ]);
      return { events: (ev.data ?? []) as EventRow[], feedback: (fb.data ?? []) as FeedbackRow[] };
    })();

    if (data.kind === "feedback") {
      const headers = [
        "created_at","ease_rating","accuracy_rating","would_use_tomorrow","confusing","missed_food","comment","allow_contact","acquisition_source",
      ];
      const rows = metrics.feedback.map((f) =>
        headers.map((h) => csvCell((f as Record<string, unknown>)[h])).join(","),
      );
      return { csv: [headers.join(","), ...rows].join("\n") };
    }

    // metrics — aggregate daily counts by event
    const byDayEvent = new Map<string, Map<string, number>>();
    for (const e of metrics.events) {
      const day = e.created_at.slice(0, 10);
      const m = byDayEvent.get(day) ?? new Map<string, number>();
      m.set(e.event_name, (m.get(e.event_name) ?? 0) + 1);
      byDayEvent.set(day, m);
    }
    const eventNames = Array.from(new Set(metrics.events.map((e) => e.event_name))).sort();
    const headers = ["date", ...eventNames];
    const days = Array.from(byDayEvent.keys()).sort();
    const rows = days.map((d) => {
      const m = byDayEvent.get(d)!;
      return [d, ...eventNames.map((n) => String(m.get(n) ?? 0))].join(",");
    });
    return { csv: [headers.join(","), ...rows].join("\n") };
  });

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  if (/[",\n]/.test(s)) return `"${s}"`;
  return s;
}

// Founder-only view of anonymous demo quota state.
// Returns only: session id, successful count, remaining, last success time,
// and last rate-limit reason. Never includes food text, IPs, or auth data.
export const getDemoUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          order: (
            col: string,
            opts: { ascending: boolean },
          ) => {
            limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>;
          };
        };
      };
    };
    const { DEMO_PARSE_LIMIT } = await import("./food.functions");
    const { data } = await admin
      .from("demo_usage")
      .select("session_id,count,last_success_at,last_reason,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    const rows = (data ?? []) as Array<{
      session_id: string;
      count: number;
      last_success_at: string | null;
      last_reason: string | null;
      created_at: string;
      updated_at: string;
    }>;
    return {
      limit: DEMO_PARSE_LIMIT,
      sessions: rows.map((r) => ({
        session_id: r.session_id,
        used: Math.min(DEMO_PARSE_LIMIT, r.count),
        remaining: Math.max(0, DEMO_PARSE_LIMIT - r.count),
        last_success_at: r.last_success_at,
        last_reason: r.last_reason,
        updated_at: r.updated_at,
      })),
    };
  });

// ============================================================
// Authentication diagnostics (founder/admin)
// Aggregates the `auth_attempt_completed` product_events emitted by
// the centralized auth error handler.
// ============================================================

type AuthAttemptProps = {
  provider?: string;
  operation?: string;
  success?: boolean;
  status?: number | string;
  error_code?: string;
  reason?: string;
  duration_ms?: number;
  platform?: string;
};

export const getAuthDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (a: string, b: string) => {
            gte: (a: string, b: string) => Promise<{ data: unknown[] | null; error: unknown }>;
          };
        };
      };
    };
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from("product_events")
      .select("event_properties,created_at")
      .eq("event_name", "auth_attempt_completed")
      .gte("created_at", since);
    const rows = (data ?? []) as Array<{
      event_properties: AuthAttemptProps;
      created_at: string;
    }>;

    const providers = ["email", "phone", "google", "apple"] as const;
    type Bucket = {
      attempts: number;
      successes: number;
      failures: number;
      durations: number[];
      errorCounts: Record<string, number>;
      status422Details: Record<string, number>;
      platforms: Record<string, { attempts: number; failures: number }>;
    };
    const empty = (): Bucket => ({
      attempts: 0,
      successes: 0,
      failures: 0,
      durations: [],
      errorCounts: {},
      status422Details: {},
      platforms: {},
    });
    const byProvider: Record<string, Bucket> = Object.fromEntries(
      providers.map((p) => [p, empty()]),
    );
    byProvider.other = empty();

    const recentFailures: Array<{
      created_at: string;
      provider: string;
      operation: string;
      status: number | string | null;
      error_code: string;
      reason: string;
      platform: string;
    }> = [];

    for (const row of rows) {
      const p = row.event_properties ?? {};
      const provider = typeof p.provider === "string" ? p.provider : "other";
      const bucket = byProvider[provider] ?? byProvider.other;
      bucket.attempts += 1;
      if (p.success === true) bucket.successes += 1;
      else bucket.failures += 1;
      if (typeof p.duration_ms === "number" && Number.isFinite(p.duration_ms)) {
        bucket.durations.push(p.duration_ms);
      }
      if (p.success !== true) {
        const code = typeof p.error_code === "string" ? p.error_code : "unknown";
        bucket.errorCounts[code] = (bucket.errorCounts[code] ?? 0) + 1;
        const statusStr = String(p.status ?? "");
        if (statusStr === "422") {
          const key = code || "unknown";
          bucket.status422Details[key] = (bucket.status422Details[key] ?? 0) + 1;
        }
        const platform = typeof p.platform === "string" ? p.platform : "unknown";
        const platBucket = bucket.platforms[platform] ?? { attempts: 0, failures: 0 };
        platBucket.attempts += 1;
        platBucket.failures += 1;
        bucket.platforms[platform] = platBucket;
        if (recentFailures.length < 200) {
          recentFailures.push({
            created_at: row.created_at,
            provider,
            operation: typeof p.operation === "string" ? p.operation : "",
            status: (p.status as number | string | undefined) ?? null,
            error_code: code,
            reason: typeof p.reason === "string" ? p.reason.slice(0, 200) : "",
            platform,
          });
        }
      } else {
        const platform = typeof p.platform === "string" ? p.platform : "unknown";
        const platBucket = bucket.platforms[platform] ?? { attempts: 0, failures: 0 };
        platBucket.attempts += 1;
        bucket.platforms[platform] = platBucket;
      }
    }

    const percentile = (arr: number[], p: number) => {
      if (!arr.length) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
      return sorted[idx];
    };

    const summary = Object.entries(byProvider).map(([provider, b]) => ({
      provider,
      attempts: b.attempts,
      successes: b.successes,
      failures: b.failures,
      successRate: b.attempts ? b.successes / b.attempts : 0,
      p50Ms: Math.round(percentile(b.durations, 50)),
      p95Ms: Math.round(percentile(b.durations, 95)),
      topErrors: Object.entries(b.errorCounts)
        .sort((a, b2) => b2[1] - a[1])
        .slice(0, 5)
        .map(([code, count]) => ({ code, count })),
      status422: Object.entries(b.status422Details)
        .sort((a, b2) => b2[1] - a[1])
        .map(([code, count]) => ({ code, count })),
      platforms: Object.entries(b.platforms).map(([platform, v]) => ({
        platform,
        attempts: v.attempts,
        failures: v.failures,
      })),
    }));

    recentFailures.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));

    return {
      windowDays: 7,
      totalAttempts: rows.length,
      byProvider: summary,
      recentFailures: recentFailures.slice(0, 30),
    };
  });