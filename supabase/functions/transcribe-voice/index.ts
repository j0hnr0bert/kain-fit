// Supabase Edge Function: voice-input transcription.
//
// Browser MediaRecorder -> (this function) -> OpenAI /v1/audio/transcriptions
// -> editable transcript. Deliberately does not touch nutrition parsing.
//
// Auth: relies on Supabase's default `verify_jwt = true` platform behavior
// (no [functions.transcribe-voice] override in config.toml) — unauthenticated
// requests are rejected before this code ever runs. Do not add a config.toml
// override that disables this.
//
// OPENAI_API_KEY is expected as a Supabase Edge Function runtime secret,
// configured by the project owner outside this repo. This file never logs
// it, the request audio, or the resulting transcript — only request
// metadata (status category, requestId, latency).
//
// Not deployed by this change. Deploying and setting the secret requires
// separate explicit approval.

import {
  transcribeAudio,
  validateAudioInput,
  TranscriptionError,
  KAINFIT_VOCABULARY_PROMPT,
  type TranscriptionErrorCategory,
} from "./logic.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const ERROR_STATUS: Record<TranscriptionErrorCategory, number> = {
  invalid_request: 400,
  unsupported_media_type: 415,
  too_large: 413,
  unauthorized: 502, // upstream credential problem, not the caller's fault
  timeout: 504,
  provider_error: 502,
  provider_unavailable: 502,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("transcribe-voice: OPENAI_API_KEY is not configured");
    return json(500, { error: "not_configured" });
  }

  const contentType = req.headers.get("content-type") ?? "";
  const declaredLength = Number(req.headers.get("content-length") ?? "0");

  try {
    validateAudioInput({ contentType, byteLength: declaredLength });
  } catch (err) {
    if (err instanceof TranscriptionError) {
      return json(ERROR_STATUS[err.category], { error: err.category });
    }
    throw err;
  }

  const audioBlob = await req.blob();
  try {
    // Re-validate against the bytes actually read — content-length is
    // caller-supplied and not trustworthy on its own.
    validateAudioInput({ contentType, byteLength: audioBlob.size });
  } catch (err) {
    if (err instanceof TranscriptionError) {
      return json(ERROR_STATUS[err.category], { error: err.category });
    }
    throw err;
  }

  const url = new URL(req.url);
  const language = url.searchParams.get("language") ?? undefined;

  try {
    const result = await transcribeAudio({
      audioBlob,
      contentType,
      apiKey,
      language,
      prompt: KAINFIT_VOCABULARY_PROMPT,
    });
    console.log("transcribe-voice: success", {
      requestId: result.requestId,
      latencyMs: result.latencyMs,
    });
    return json(200, result);
  } catch (err) {
    if (err instanceof TranscriptionError) {
      console.error("transcribe-voice: failed", { category: err.category });
      return json(ERROR_STATUS[err.category], { error: err.category });
    }
    console.error(
      "transcribe-voice: unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json(500, { error: "provider_error" });
  }
});
