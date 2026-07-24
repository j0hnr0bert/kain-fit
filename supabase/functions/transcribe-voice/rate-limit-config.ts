// Single, server-owned configuration surface for every voice-transcription
// business limit. No secrets live here — only numeric knobs and the kill
// switch's env var NAME. Every number has a safe default; every default is
// overridable via an env var so an operator can tune limits without a code
// change (though changing an Edge Function's env var still requires a
// function restart in Supabase — that's a smaller operational step than a
// code deploy, not "zero deployment," and this comment says so honestly).

export interface VoiceRateLimitConfig {
  perUserShortWindowSeconds: number;
  perUserShortWindowMax: number;
  perUserDailyWindowSeconds: number;
  perUserDailyWindowMax: number;
  projectHourlyWindowSeconds: number;
  projectHourlyWindowMax: number;
  projectDailyWindowSeconds: number;
  projectDailyWindowMax: number;
  leaseDurationSeconds: number;
}

// Mirrors the SQL function defaults in
// supabase/migrations/20260724220000_voice_transcription_rate_limiting.sql
// — kept in sync manually since Postgres can't read a TS module. The Edge
// Function always passes these explicitly as RPC arguments (see guard.ts),
// so the SQL defaults only matter for ad-hoc/manual RPC calls, never for
// the actual enforced values in production.
export const DEFAULT_VOICE_RATE_LIMIT_CONFIG: VoiceRateLimitConfig = {
  perUserShortWindowSeconds: 600, // 10 minutes
  perUserShortWindowMax: 10,
  perUserDailyWindowSeconds: 86_400, // 24 hours
  perUserDailyWindowMax: 100,
  projectHourlyWindowSeconds: 3_600,
  projectHourlyWindowMax: 1_000,
  projectDailyWindowSeconds: 86_400,
  projectDailyWindowMax: 5_000,
  // Must exceed Stage 1's worst-case processing time (DEFAULT_TIMEOUT_MS=10s
  // per attempt x up to 2 attempts + RETRY_DELAY_MS=400ms between = ~20.4s
  // worst case) with margin for Edge Function overhead, without being so
  // long that a crashed function blocks a user longer than necessary.
  leaseDurationSeconds: 30,
};

function readPositiveInt(
  env: (key: string) => string | undefined,
  key: string,
  fallback: number,
): number {
  const raw = env(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function loadVoiceRateLimitConfig(
  env: (key: string) => string | undefined,
): VoiceRateLimitConfig {
  return {
    perUserShortWindowSeconds: readPositiveInt(
      env,
      "VOICE_RATE_LIMIT_USER_SHORT_WINDOW_SECONDS",
      DEFAULT_VOICE_RATE_LIMIT_CONFIG.perUserShortWindowSeconds,
    ),
    perUserShortWindowMax: readPositiveInt(
      env,
      "VOICE_RATE_LIMIT_USER_SHORT_WINDOW_MAX",
      DEFAULT_VOICE_RATE_LIMIT_CONFIG.perUserShortWindowMax,
    ),
    perUserDailyWindowSeconds: readPositiveInt(
      env,
      "VOICE_RATE_LIMIT_USER_DAILY_WINDOW_SECONDS",
      DEFAULT_VOICE_RATE_LIMIT_CONFIG.perUserDailyWindowSeconds,
    ),
    perUserDailyWindowMax: readPositiveInt(
      env,
      "VOICE_RATE_LIMIT_USER_DAILY_WINDOW_MAX",
      DEFAULT_VOICE_RATE_LIMIT_CONFIG.perUserDailyWindowMax,
    ),
    projectHourlyWindowSeconds: readPositiveInt(
      env,
      "VOICE_RATE_LIMIT_PROJECT_HOURLY_WINDOW_SECONDS",
      DEFAULT_VOICE_RATE_LIMIT_CONFIG.projectHourlyWindowSeconds,
    ),
    projectHourlyWindowMax: readPositiveInt(
      env,
      "VOICE_RATE_LIMIT_PROJECT_HOURLY_WINDOW_MAX",
      DEFAULT_VOICE_RATE_LIMIT_CONFIG.projectHourlyWindowMax,
    ),
    projectDailyWindowSeconds: readPositiveInt(
      env,
      "VOICE_RATE_LIMIT_PROJECT_DAILY_WINDOW_SECONDS",
      DEFAULT_VOICE_RATE_LIMIT_CONFIG.projectDailyWindowSeconds,
    ),
    projectDailyWindowMax: readPositiveInt(
      env,
      "VOICE_RATE_LIMIT_PROJECT_DAILY_WINDOW_MAX",
      DEFAULT_VOICE_RATE_LIMIT_CONFIG.projectDailyWindowMax,
    ),
    leaseDurationSeconds: readPositiveInt(
      env,
      "VOICE_RATE_LIMIT_LEASE_SECONDS",
      DEFAULT_VOICE_RATE_LIMIT_CONFIG.leaseDurationSeconds,
    ),
  };
}

// Emergency kill switch. Missing, empty, or any value other than the exact
// string "true" is treated as DISABLED — cost-producing external API calls
// require explicit opt-in, not implicit opt-out. This is the secure
// default for a pre-launch/beta feature: a typo or an unset env var must
// never accidentally turn transcription ON.
export function isVoiceTranscriptionEnabled(env: (key: string) => string | undefined): boolean {
  return env("VOICE_TRANSCRIPTION_ENABLED") === "true";
}
