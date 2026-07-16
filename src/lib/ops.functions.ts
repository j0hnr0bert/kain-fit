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

export const getPublicOpsFlags = createServerFn({ method: "GET" }).handler(async () => {
  const { readOpsSettings } = await import("./ops-settings.server");
  const s = await readOpsSettings();
  return {
    high_demand_banner: s.high_demand_banner,
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

    return {
      capacity,
      breaker,
      settings,
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