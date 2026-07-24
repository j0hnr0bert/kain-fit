// Pure transcription logic for the voice-input Supabase Edge Function.
// Deliberately framework/runtime-agnostic (Web-standard fetch/Blob/FormData
// only) so it can be unit-tested under Vitest/Node without a Deno runtime,
// while still running unmodified under Deno at deploy time. Do not import
// Deno- or Node-specific APIs here — put those in index.ts.

export const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

// MediaRecorder output formats actually produced by target browsers:
// Chromium (desktop/Android) -> audio/webm;codecs=opus, Safari (macOS/iOS,
// 14.3+) -> audio/mp4 (AAC). audio/wav/audio/mpeg allowed for the disposable
// test harness / future non-MediaRecorder callers.
export const ALLOWED_MIME_TYPES = [
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
] as const;

// Server-side backstop only. True recording-duration enforcement is a
// client-side concern (Stage 2's 20s MediaRecorder cap) — this endpoint
// cannot cheaply decode audio to measure duration, so it bounds request
// size instead, as a defense-in-depth proxy, not an exact duration check.
export const MAX_AUDIO_BYTES = 6 * 1024 * 1024; // 6 MB

export const DEFAULT_MODEL = "gpt-4o-mini-transcribe";
export const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 400;
const RETRYABLE_CATEGORIES = new Set(["provider_error", "provider_unavailable", "timeout"]);

// Optional vocabulary bias, per OpenAI's documented `prompt` field for the
// transcriptions endpoint. Kept as a named export (not inlined) so Phase 4's
// accuracy harness can evaluate it against a no-prompt baseline rather than
// this being a silent, unmeasured decision.
export const KAINFIT_VOCABULARY_PROMPT =
  "Filipino food logging. Common terms: adobo, sinigang, kare-kare, tinola, " +
  "lechon kawali, longganisa, tocino, bangus, pancit, lumpia, itlog, kanin, " +
  "tasa, kutsara, piraso, grams, cups, tablespoon, teaspoon.";

export type TranscriptionErrorCategory =
  | "invalid_request"
  | "unsupported_media_type"
  | "too_large"
  | "unauthorized"
  | "timeout"
  | "provider_error"
  | "provider_unavailable";

export class TranscriptionError extends Error {
  readonly category: TranscriptionErrorCategory;
  constructor(category: TranscriptionErrorCategory, message: string) {
    super(message);
    this.name = "TranscriptionError";
    this.category = category;
  }
}

export interface TranscriptionResult {
  transcript: string;
  requestId: string;
  latencyMs: number;
}

function normalizeMimeType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function validateAudioInput(input: { contentType: string; byteLength: number }): void {
  const mime = normalizeMimeType(input.contentType);
  if (!mime) {
    throw new TranscriptionError("invalid_request", "Missing content-type.");
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new TranscriptionError("unsupported_media_type", `Unsupported audio type: ${mime}`);
  }
  if (input.byteLength <= 0) {
    throw new TranscriptionError("invalid_request", "Empty audio payload.");
  }
  if (input.byteLength > MAX_AUDIO_BYTES) {
    throw new TranscriptionError("too_large", "Audio payload exceeds the maximum allowed size.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptOnce(opts: {
  audioBlob: Blob;
  contentType: string;
  apiKey: string;
  model: string;
  language?: string;
  prompt?: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const form = new FormData();
  const mime = normalizeMimeType(opts.contentType);
  const extension =
    mime === "audio/webm"
      ? "webm"
      : mime === "audio/wav" || mime === "audio/x-wav"
        ? "wav"
        : mime === "audio/mpeg"
          ? "mp3"
          : "m4a";
  form.append("file", opts.audioBlob, `voice-input.${extension}`);
  form.append("model", opts.model);
  form.append("response_format", "json");
  if (opts.language) form.append("language", opts.language);
  if (opts.prompt) form.append("prompt", opts.prompt);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  let res: Response;
  try {
    res = await opts.fetchImpl(OPENAI_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TranscriptionError("timeout", "Transcription request timed out.");
    }
    throw new TranscriptionError(
      "provider_unavailable",
      "Could not reach the transcription provider.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new TranscriptionError(
      "unauthorized",
      "Transcription provider rejected the request credentials.",
    );
  }
  if (res.status === 400 || res.status === 413 || res.status === 415) {
    throw new TranscriptionError(
      "invalid_request",
      "Transcription provider rejected the audio payload.",
    );
  }
  if (res.status === 429) {
    throw new TranscriptionError("provider_error", "Transcription provider rate limit reached.");
  }
  if (res.status >= 500) {
    throw new TranscriptionError(
      "provider_error",
      "Transcription provider returned a server error.",
    );
  }
  if (!res.ok) {
    // Any other unexpected non-success status: fail safe, don't guess.
    throw new TranscriptionError(
      "provider_error",
      "Transcription provider returned an unexpected response.",
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new TranscriptionError(
      "provider_error",
      "Transcription provider returned an invalid response body.",
    );
  }
  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== "string") {
    throw new TranscriptionError(
      "provider_error",
      "Transcription provider response was missing a transcript.",
    );
  }
  return text;
}

export async function transcribeAudio(opts: {
  audioBlob: Blob;
  contentType: string;
  apiKey: string;
  model?: string;
  language?: string;
  prompt?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<TranscriptionResult> {
  const requestId = crypto.randomUUID();
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const started = Date.now();
  let lastError: TranscriptionError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const transcript = await attemptOnce({
        audioBlob: opts.audioBlob,
        contentType: opts.contentType,
        apiKey: opts.apiKey,
        model,
        language: opts.language,
        prompt: opts.prompt,
        timeoutMs,
        fetchImpl,
      });
      return { transcript, requestId, latencyMs: Date.now() - started };
    } catch (err) {
      if (!(err instanceof TranscriptionError)) throw err;
      lastError = err;
      const canRetry = RETRYABLE_CATEGORIES.has(err.category) && attempt < MAX_ATTEMPTS;
      if (!canRetry) throw err;
      await sleep(RETRY_DELAY_MS);
    }
  }
  // Unreachable given MAX_ATTEMPTS >= 1, but keeps the return type sound.
  throw lastError ?? new TranscriptionError("provider_error", "Transcription failed.");
}
