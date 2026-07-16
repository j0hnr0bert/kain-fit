// Server-only cached reader for public.app_settings.
// Values are cached briefly so parse/demo hot paths do not hit the DB per call.

type SettingsSnapshot = {
  pause_demo: boolean;
  pause_ai: boolean;
  db_only_mode: boolean;
  demo_allowance: number;
  high_demand_banner: string;
};

const DEFAULTS: SettingsSnapshot = {
  pause_demo: false,
  pause_ai: false,
  db_only_mode: false,
  demo_allowance: 3,
  high_demand_banner: "",
};

const CACHE_TTL_MS = 10_000;
let cache: { at: number; value: SettingsSnapshot } | null = null;

function coerceBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true";
  return fallback;
}
function coerceNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function coerceStr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

export async function readOpsSettings(): Promise<SettingsSnapshot> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (c: string) => Promise<{ data: Array<{ key: string; value: unknown }> | null; error: unknown }>;
    };
  };
  const { data } = await admin.from("app_settings").select("key,value");
  const map = new Map<string, unknown>();
  for (const row of data ?? []) map.set(row.key, row.value);
  const value: SettingsSnapshot = {
    pause_demo: coerceBool(map.get("pause_demo"), DEFAULTS.pause_demo),
    pause_ai: coerceBool(map.get("pause_ai"), DEFAULTS.pause_ai),
    db_only_mode: coerceBool(map.get("db_only_mode"), DEFAULTS.db_only_mode),
    demo_allowance: coerceNum(map.get("demo_allowance"), DEFAULTS.demo_allowance),
    high_demand_banner: coerceStr(map.get("high_demand_banner"), DEFAULTS.high_demand_banner),
  };
  cache = { at: now, value };
  return value;
}

export function invalidateOpsSettingsCache(): void {
  cache = null;
}