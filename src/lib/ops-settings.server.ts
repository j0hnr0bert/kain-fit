// Server-only cached reader for public.app_settings.
// Values are cached briefly so parse/demo hot paths do not hit the DB per call.

type SettingsSnapshot = {
  pause_demo: boolean;
  pause_ai: boolean;
  db_only_mode: boolean;
  demo_allowance: number;
  high_demand_banner: string;
  session_burst_per_min: number;
  user_daily_ai_cap: number;
  monthly_ai_call_cap: number;
  daily_ai_call_alert: number;
  beta_limits_enabled: boolean;
  beta_daily_submission_cap: number;
  beta_max_input_length: number;
  beta_max_foods_per_submission: number;
};

const DEFAULTS: SettingsSnapshot = {
  pause_demo: false,
  pause_ai: false,
  db_only_mode: false,
  demo_allowance: 3,
  high_demand_banner: "",
  // Abuse & cost controls. Zero disables the limit.
  session_burst_per_min: 6,
  user_daily_ai_cap: 200,
  monthly_ai_call_cap: 0,
  daily_ai_call_alert: 0,
  // Beta usage limits. Enforced against food_parse_succeeded per PHT day.
  beta_limits_enabled: true,
  beta_daily_submission_cap: 20,
  beta_max_input_length: 500,
  beta_max_foods_per_submission: 10,
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
    session_burst_per_min: coerceNum(map.get("session_burst_per_min"), DEFAULTS.session_burst_per_min),
    user_daily_ai_cap: coerceNum(map.get("user_daily_ai_cap"), DEFAULTS.user_daily_ai_cap),
    monthly_ai_call_cap: coerceNum(map.get("monthly_ai_call_cap"), DEFAULTS.monthly_ai_call_cap),
    daily_ai_call_alert: coerceNum(map.get("daily_ai_call_alert"), DEFAULTS.daily_ai_call_alert),
    beta_limits_enabled: coerceBool(map.get("beta_limits_enabled"), DEFAULTS.beta_limits_enabled),
    beta_daily_submission_cap: coerceNum(map.get("beta_daily_submission_cap"), DEFAULTS.beta_daily_submission_cap),
    beta_max_input_length: coerceNum(map.get("beta_max_input_length"), DEFAULTS.beta_max_input_length),
    beta_max_foods_per_submission: coerceNum(map.get("beta_max_foods_per_submission"), DEFAULTS.beta_max_foods_per_submission),
  };
  cache = { at: now, value };
  return value;
}

export function invalidateOpsSettingsCache(): void {
  cache = null;
}