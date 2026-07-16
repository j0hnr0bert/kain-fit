import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// -------- Shared admin check --------

async function ensureAdmin(ctx: { supabase: unknown; userId: string }): Promise<void> {
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

// -------- Public: banner + flags safe for any visitor --------

// -------- Founder auto-alerts --------
//
// Rising-edge alerts logged to ops_audit_log when auto-banner conditions
// trip. Per-isolate cooldown prevents spamming the log during a sustained
// incident. The admin dashboard already renders ops_audit_log, so alerts
// appear inline with founder-driven setting changes.

const ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const lastAlertAt = new Map<string, number>();

type BannerReason =
  | "manual"
  | "ai_paused"
  | "breaker_open"
  | "monthly_cap"
  | "daily_alert"
  | "queue_saturated"
  | "none";

async function computeActiveBanner(): Promise<{
  text: string;
  reason: BannerReason;
  isAuto: boolean;
}> {
  const { readOpsSettings } = await import("./ops-settings.server");
  const { getBreakerStatus, getCapacityStats, getGlobalAiCounts } = await import("./ai-guard.server");
  const s = await readOpsSettings();

  const manual = s.high_demand_banner?.trim() ?? "";
  if (manual) return { text: manual, reason: "manual", isAuto: false };

  if (s.pause_ai || s.db_only_mode) {
    return {
      text: "KainFit's calculator is temporarily paused. You can still edit or add entries manually.",
      reason: "ai_paused",
      isAuto: true,
    };
  }
  if (getBreakerStatus() === "open") {
    void maybeLogAutoAlert("auto_alert:breaker_open", { breaker: "open" });
    return {
      text: "Our calculator is catching its breath. Try again in a minute — your entries are safe.",
      reason: "breaker_open",
      isAuto: true,
    };
  }
  try {
    const counts = await getGlobalAiCounts();
    if (s.monthly_ai_call_cap > 0 && counts.month >= s.monthly_ai_call_cap) {
      void maybeLogAutoAlert("auto_alert:monthly_cap_hit", {
        monthly: counts.month,
        cap: s.monthly_ai_call_cap,
      });
      return {
        text: "We've hit this month's calculator budget. You can still edit or add entries manually.",
        reason: "monthly_cap",
        isAuto: true,
      };
    }
    if (s.daily_ai_call_alert > 0 && counts.today >= s.daily_ai_call_alert) {
      void maybeLogAutoAlert("auto_alert:daily_alert_hit", {
        today: counts.today,
        threshold: s.daily_ai_call_alert,
      });
      return {
        text: "Demand is unusually high today — parsing may be slower than usual.",
        reason: "daily_alert",
        isAuto: true,
      };
    }
  } catch {
    // don't let a counts read failure hide the app
  }
  const cap = getCapacityStats();
  if (cap.queued > 0 && cap.inFlight >= cap.maxConcurrent) {
    void maybeLogAutoAlert("auto_alert:queue_saturated", {
      inFlight: cap.inFlight,
      queued: cap.queued,
    });
    return {
      text: "Lots of people logging right now — hang tight, your entry is queued.",
      reason: "queue_saturated",
      isAuto: true,
    };
  }
  return { text: "", reason: "none", isAuto: false };
}

async function maybeLogAutoAlert(key: string, detail: Record<string, unknown>): Promise<void> {
  const now = Date.now();
  const prev = lastAlertAt.get(key) ?? 0;
  if (now - prev < ALERT_COOLDOWN_MS) return;
  lastAlertAt.set(key, now);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => { insert: (row: Record<string, unknown>) => Promise<{ error: unknown }> };
    };
    await admin.from("ops_audit_log").insert({
      actor_id: null,
      key,
      old_value: null,
      new_value: JSON.stringify(detail),
    });
  } catch (err) {
    console.error("[auto-alert] insert failed", key, err);
  }
}

export const getPublicOpsFlags = createServerFn({ method: "GET" }).handler(async () => {
  const { readOpsSettings } = await import("./ops-settings.server");
  const s = await readOpsSettings();
  const active = await computeActiveBanner();
  return {
    high_demand_banner: active.text,
    db_only_mode: s.db_only_mode,
  };
});

// -------- Admin: live operational snapshot --------

export const getOpsSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const { getCapacityStats, getBreakerStatus } = await import("./ai-guard.server");
    const { readOpsSettings } = await import("./ops-settings.server");
    const { getGlobalAiCounts } = await import("./ai-guard.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          gte: (a: string, b: string) => Promise<{ data: unknown[] | null; error: unknown }>;
          order: (a: string, opts: { ascending: boolean }) => {
            limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>;
          };
        };
      };
    };

    const since = new Date(Date.now() - 60_000).toISOString();
    const [recentEventsRes, auditRes] = await Promise.all([
      admin.from("product_events").select("event_name,event_properties,created_at").gte("created_at", since),
      admin.from("ops_audit_log").select("*").order("created_at", { ascending: false }).limit(20),
    ]);

    type EvRow = { event_name: string; event_properties: Record<string, unknown> | null; created_at: string };
    const events = (recentEventsRes.data ?? []) as EvRow[];

    const parseSuccess = events.filter((e) => e.event_name === "food_parse_succeeded").length;
    const parseFail = events.filter((e) => e.event_name === "food_parse_failed").length;
    const total = parseSuccess + parseFail;

    const failReasons = events
      .filter((e) => e.event_name === "food_parse_failed")
      .map((e) => String(e.event_properties?.reason ?? ""));
    const rateLimited = failReasons.filter((r) => r.startsWith("AI_BUSY") || r.startsWith("Too many")).length;
    const retries = failReasons.filter((r) => r.startsWith("AI_UNAVAILABLE") || r.startsWith("AI_BUSY")).length;

    const durations = events
      .filter((e) => e.event_name === "food_parse_succeeded")
      .map((e) => Number(e.event_properties?.processing_duration_ms))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const pct = (p: number) =>
      durations.length ? durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))] : 0;
    const cacheHits = events.filter(
      (e) => e.event_name === "food_parse_succeeded" && e.event_properties?.cache_hit === true,
    ).length;

    const settings = await readOpsSettings();
    const capacity = getCapacityStats();
    const breaker = getBreakerStatus();
    const globalCounts = await getGlobalAiCounts().catch(() => ({ today: 0, month: 0 }));
    const dailyAlertHit =
      settings.daily_ai_call_alert > 0 && globalCounts.today >= settings.daily_ai_call_alert;
    const activeBanner = await computeActiveBanner();

    return {
      capacity,
      breaker,
      settings,
      activeBanner,
      globals: {
        aiCallsToday: globalCounts.today,
        aiCallsMonth: globalCounts.month,
        dailyAlertHit,
      },
      lastMinute: {
        aiCalls: total,
        parseSuccess,
        parseFail,
        rateLimited,
        retries,
        p50Ms: pct(50),
        p95Ms: pct(95),
        errorRate: total ? parseFail / total : 0,
        cacheHitRate: parseSuccess ? cacheHits / parseSuccess : 0,
      },
      recentAudit: (auditRes.data ?? []) as Array<{
        id: string;
        actor_id: string | null;
        key: string;
        old_value: string | number | boolean | null;
        new_value: string | number | boolean | null;
        created_at: string;
      }>,
    };
  });

// -------- Admin: update a setting (audited) --------

const SETTABLE_KEYS = [
  "pause_demo",
  "pause_ai",
  "db_only_mode",
  "demo_allowance",
  "high_demand_banner",
  "session_burst_per_min",
  "user_daily_ai_cap",
  "monthly_ai_call_cap",
  "daily_ai_call_alert",
] as const;

const updateSchema = z.object({
  key: z.enum(SETTABLE_KEYS),
  value: z.union([z.boolean(), z.number(), z.string()]),
});

export const updateOpsSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context);

    // Type-guard values per key so an admin can't put a string into pause_ai.
    const t = typeof data.value;
    switch (data.key) {
      case "pause_demo":
      case "pause_ai":
      case "db_only_mode":
        if (t !== "boolean") throw new Error("Invalid value: expected boolean");
        break;
      case "demo_allowance":
        if (t !== "number" || (data.value as number) < 0 || (data.value as number) > 50) {
          throw new Error("Invalid demo allowance (0–50)");
        }
        break;
      case "high_demand_banner":
        if (t !== "string" || (data.value as string).length > 200) {
          throw new Error("Banner must be a string under 200 chars");
        }
        break;
      case "session_burst_per_min":
        if (t !== "number" || (data.value as number) < 0 || (data.value as number) > 120) {
          throw new Error("Burst limit must be 0–120 per minute");
        }
        break;
      case "user_daily_ai_cap":
        if (t !== "number" || (data.value as number) < 0 || (data.value as number) > 10000) {
          throw new Error("User daily cap must be 0–10000");
        }
        break;
      case "monthly_ai_call_cap":
        if (t !== "number" || (data.value as number) < 0 || (data.value as number) > 10_000_000) {
          throw new Error("Monthly cap out of range");
        }
        break;
      case "daily_ai_call_alert":
        if (t !== "number" || (data.value as number) < 0 || (data.value as number) > 10_000_000) {
          throw new Error("Daily alert threshold out of range");
        }
        break;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (a: string, b: string) => {
            maybeSingle: () => Promise<{ data: { value: unknown } | null; error: unknown }>;
          };
        };
        upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: unknown }>;
        insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
    };

    const prev = await admin
      .from("app_settings")
      .select("value")
      .eq("key", data.key)
      .maybeSingle();

    const upsertRes = await admin.from("app_settings").upsert(
      {
        key: data.key,
        value: data.value,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (upsertRes.error) throw new Error("Failed to update setting");

    await admin.from("ops_audit_log").insert({
      actor_id: context.userId,
      key: data.key,
      old_value: prev.data?.value ?? null,
      new_value: data.value,
    });

    const { invalidateOpsSettingsCache } = await import("./ops-settings.server");
    invalidateOpsSettingsCache();

    return { ok: true };
  });

// -------- Admin: pre-warm the shared parse cache --------
//
// Iterates a small curated list of common Filipino inputs and populates the
// shared cache when it's missing. Any hit skips the AI call entirely.
// Bounded (max ~40 entries) so an accidental click can't burn credits.

const WARM_INPUTS: ReadonlyArray<{ input: string; mealHint: "breakfast" | "lunch" | "dinner" | "snacks" }> = [
  // Breakfast
  { input: "tapsilog", mealHint: "breakfast" },
  { input: "longsilog", mealHint: "breakfast" },
  { input: "tocilog", mealHint: "breakfast" },
  { input: "1 pandesal", mealHint: "breakfast" },
  { input: "2 pandesal with butter", mealHint: "breakfast" },
  { input: "1 cup oatmeal with banana", mealHint: "breakfast" },
  { input: "2 scrambled eggs and rice", mealHint: "breakfast" },
  { input: "1 cup arroz caldo", mealHint: "breakfast" },
  // Lunch / Dinner staples
  { input: "chicken adobo and rice", mealHint: "lunch" },
  { input: "1 cup chicken adobo with 1 cup rice", mealHint: "lunch" },
  { input: "pork sinigang and rice", mealHint: "lunch" },
  { input: "beef sinigang and rice", mealHint: "lunch" },
  { input: "sinigang na baboy with 1 cup rice", mealHint: "lunch" },
  { input: "chicken tinola and rice", mealHint: "lunch" },
  { input: "pork giniling and rice", mealHint: "lunch" },
  { input: "menudo and rice", mealHint: "lunch" },
  { input: "kare-kare and rice", mealHint: "lunch" },
  { input: "lechon kawali and rice", mealHint: "lunch" },
  { input: "sisig and rice", mealHint: "lunch" },
  { input: "grilled bangus and rice", mealHint: "lunch" },
  { input: "fried tilapia and rice", mealHint: "lunch" },
  { input: "bicol express and rice", mealHint: "lunch" },
  { input: "chicken curry and rice", mealHint: "lunch" },
  { input: "beef caldereta and rice", mealHint: "dinner" },
  { input: "pancit canton", mealHint: "dinner" },
  { input: "pancit bihon", mealHint: "dinner" },
  { input: "spaghetti Filipino style", mealHint: "dinner" },
  // Fast food
  { input: "Jollibee Chickenjoy with rice", mealHint: "lunch" },
  { input: "Jollibee 2pc Chickenjoy with rice", mealHint: "lunch" },
  { input: "Jollibee Jolly Spaghetti", mealHint: "lunch" },
  { input: "Chowking chao fan and siomai", mealHint: "lunch" },
  { input: "McDonalds Chicken McDo with rice", mealHint: "lunch" },
  // Snacks
  { input: "1 banana", mealHint: "snacks" },
  { input: "1 apple", mealHint: "snacks" },
  { input: "1 cup taho", mealHint: "snacks" },
  { input: "1 turon", mealHint: "snacks" },
  { input: "1 slice cassava cake", mealHint: "snacks" },
  { input: "1 puto", mealHint: "snacks" },
  { input: "1 can Coke", mealHint: "snacks" },
  { input: "1 cup rice", mealHint: "snacks" },
];

export const warmFoodParseCache = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context);
    const started = Date.now();
    let hits = 0;
    let misses = 0;
    let errors = 0;
    const { resolveWithCache } = await import("./food.functions");
    for (const entry of WARM_INPUTS) {
      try {
        const result = await resolveWithCache(entry.input, entry.mealHint);
        if (result.timings.cache_hit) hits++;
        else misses++;
      } catch (err) {
        console.error("[warm] entry failed", entry.input, err);
        errors++;
      }
    }
    return {
      attempted: WARM_INPUTS.length,
      cacheHits: hits,
      aiCalls: misses,
      errors,
      durationMs: Date.now() - started,
    };
  });