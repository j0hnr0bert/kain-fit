// Supabase Edge Function: voice-input transcription.
//
// Browser MediaRecorder -> (this function) -> OpenAI /v1/audio/transcriptions
// -> editable transcript. Deliberately does not touch nutrition parsing.
//
// Stage 2.5 adds durable, server-authoritative rate limiting, a single-
// flight lease, and an emergency kill switch (see guard.ts and
// rate-limit-config.ts) in front of Stage 1's transcription call. The
// request-processing order below matches guard.ts's own numbered
// comments exactly — see that file for the full design rationale.
//
// Auth: relies on Supabase's default `verify_jwt = true` platform behavior
// (no [functions.transcribe-voice] override in config.toml) as the FIRST
// gate — unauthenticated requests are rejected before this code ever
// runs. This function additionally derives and verifies the caller's user
// id itself (getVerifiedUserId below) as defense-in-depth against a
// forged/stale token slipping past the platform check, and NEVER trusts
// any user id from the request body.
//
// OPENAI_API_KEY and VOICE_TRANSCRIPTION_ENABLED are expected as Supabase
// Edge Function runtime configuration, set by the project owner outside
// this repo. SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
// are provided automatically by the Supabase platform to every deployed
// Edge Function — nothing here required a new secret to be configured.
// This file never logs the API key, service-role key, request audio, the
// resulting transcript, the Authorization header, or a raw provider
// response body — only category/requestId/latency metadata.
//
// Not deployed by this change. Deploying, applying the migration, and
// setting OPENAI_API_KEY require separate explicit approval.

import { createClient } from "npm:@supabase/supabase-js@2";
import { transcribeAudio, KAINFIT_VOCABULARY_PROMPT } from "./logic.ts";
import {
  runVoiceTranscriptionGuard,
  ERROR_STATUS,
  ERROR_MESSAGE,
  type QuotaCheckResult,
  type QuotaFailureReason,
  type VoiceGuardDeps,
} from "./guard.ts";
import { loadVoiceRateLimitConfig, isVoiceTranscriptionEnabled } from "./rate-limit-config.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown, retryAfterSeconds?: number): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...CORS_HEADERS };
  if (retryAfterSeconds !== undefined) headers["Retry-After"] = String(retryAfterSeconds);
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // 1. Emergency kill switch — checked before the HTTP method (or
  // anything else), so a disabled feature rejects fast regardless of what
  // the request looks like. guard.ts also re-checks this (deps below) as
  // defense-in-depth; the fast path here just avoids doing any further
  // work — including reading env config that might itself be missing —
  // when the feature is simply off.
  if (!isVoiceTranscriptionEnabled((key) => Deno.env.get(key))) {
    return json(ERROR_STATUS.feature_disabled, {
      error: "feature_disabled",
      message: ERROR_MESSAGE.feature_disabled,
    });
  }

  // 2. HTTP method.
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("transcribe-voice: OPENAI_API_KEY is not configured");
    return json(500, { error: "not_configured" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("transcribe-voice: Supabase platform env vars are not configured");
    return json(500, { error: "not_configured" });
  }

  // Request-scoped client, authenticated as the CALLER (forwards their own
  // Authorization header) — used only to verify who they are. Never used
  // for the rate-limit tables.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  // Service-role client — the only client ever used against the
  // rate-limit tables/RPCs, which grant execute/access to service_role
  // alone (see the migration).
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const config = loadVoiceRateLimitConfig((key) => Deno.env.get(key));
  const contentType = req.headers.get("content-type") ?? "";
  const declaredLength = req.headers.get("content-length");

  const deps: VoiceGuardDeps = {
    isFeatureEnabled: isVoiceTranscriptionEnabled((key) => Deno.env.get(key)),
    method: req.method,
    contentType,
    declaredContentLength: declaredLength === null ? null : Number(declaredLength),

    getVerifiedUserId: async () => {
      const { data, error } = await callerClient.auth.getUser();
      if (error || !data?.user?.id) return null;
      return data.user.id;
    },

    checkQuota: async (userId: string): Promise<QuotaCheckResult> => {
      const { data, error } = await adminClient.rpc("acquire_voice_transcription_slot", {
        p_user_id: userId,
        p_short_window_seconds: config.perUserShortWindowSeconds,
        p_short_window_max: config.perUserShortWindowMax,
        p_daily_window_seconds: config.perUserDailyWindowSeconds,
        p_daily_window_max: config.perUserDailyWindowMax,
        p_project_hourly_seconds: config.projectHourlyWindowSeconds,
        p_project_hourly_max: config.projectHourlyWindowMax,
        p_project_daily_seconds: config.projectDailyWindowSeconds,
        p_project_daily_max: config.projectDailyWindowMax,
        p_lease_seconds: config.leaseDurationSeconds,
      });
      if (error) throw error;
      // Fail closed on a malformed/unexpected RPC response shape rather
      // than trusting an `as` cast at runtime — a schema drift here must
      // never silently coerce into "allowed".
      const row = data as {
        allowed?: unknown;
        lease_token?: unknown;
        reason?: unknown;
        retry_after_seconds?: unknown;
      } | null;
      if (!row || typeof row.allowed !== "boolean") {
        throw new Error("acquire_voice_transcription_slot returned an unexpected shape");
      }
      if (row.allowed) {
        if (typeof row.lease_token !== "string") {
          throw new Error(
            "acquire_voice_transcription_slot returned allowed=true with no lease_token",
          );
        }
        return { allowed: true, leaseToken: row.lease_token };
      }
      if (typeof row.reason !== "string") {
        throw new Error("acquire_voice_transcription_slot returned allowed=false with no reason");
      }
      return {
        allowed: false,
        reason: row.reason as QuotaFailureReason,
        retryAfterSeconds:
          typeof row.retry_after_seconds === "number" ? row.retry_after_seconds : undefined,
      };
    },

    releaseLease: async (userId: string, leaseToken: string) => {
      const { error } = await adminClient.rpc("release_voice_transcription_lease", {
        p_user_id: userId,
        p_lease_token: leaseToken,
      });
      if (error)
        console.error("transcribe-voice: lease release failed", {
          category: "lease_release_error",
        });
    },

    readBody: () => req.blob(),

    // Stage 3 hook only, unchanged from Stage 1/2 — no language-strategy
    // decision is made in this stage; this endpoint has never been called
    // with this param set by any current client.
    transcribe: (audioBlob, ct) =>
      transcribeAudio({
        audioBlob,
        contentType: ct,
        apiKey,
        language: new URL(req.url).searchParams.get("language") ?? undefined,
        prompt: KAINFIT_VOCABULARY_PROMPT,
      }),
  };

  const outcome = await runVoiceTranscriptionGuard(deps);

  if (outcome.ok) {
    console.log("transcribe-voice: success", {
      requestId: outcome.result.requestId,
      latencyMs: outcome.result.latencyMs,
    });
    return json(200, outcome.result);
  }

  // Server log only. Never spread `outcome` here — the client response
  // below is built from `category` alone, deliberately excluding
  // `diagnostics` (see guard.ts's VoiceGuardFailure comment).
  console.error("transcribe-voice: rejected", {
    category: outcome.category,
    diagnostics: outcome.diagnostics,
  });
  return json(
    ERROR_STATUS[outcome.category],
    { error: outcome.category, message: ERROR_MESSAGE[outcome.category] },
    outcome.retryAfterSeconds,
  );
});
