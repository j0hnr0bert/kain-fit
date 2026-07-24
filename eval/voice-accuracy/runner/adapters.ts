// Stage 3A transcription adapters (Part 14: "uses a configurable
// transcription adapter").
//
// A TranscriptionAdapter turns a corpus record into a transcript string
// plus latency/status metadata. Three kinds exist:
//   - MockAdapter: deterministic, offline, no network call. Used for
//     every test in this repo and for exercising the scoring/gate
//     pipeline end-to-end without needing real audio or a live API key.
//   - createLiveAdapter(): a real HTTP adapter, wired to Stage 1's exact
//     endpoint/model, but it REQUIRES an audio fixture (an actual audio
//     Blob/Buffer) — Stage 3A has none yet (no Stage 3B recordings), so
//     this adapter exists but is never invoked by anything in this
//     commit. Calling it without OPENAI_API_KEY throws immediately
//     rather than silently no-op'ing.
//   - Every adapter result carries `isLive` so the runner and reports can
//     never mislabel a mocked/synthetic run as production evidence.

import type { CorpusRecord } from "../corpus/types";

export interface AdapterResult {
  transcript: string;
  latencyMs: number;
  succeeded: boolean;
  timedOut: boolean;
  errorCategory: string | null;
  isLive: boolean;
  isSynthetic: boolean; // true for TTS/synthetic audio, false for real human speech
}

export interface TranscriptionAdapter {
  readonly kind: "mock" | "live";
  transcribe(record: CorpusRecord): Promise<AdapterResult>;
}

/**
 * Deterministic mock: by default echoes the record's own intended
 * transcript back (a "perfect ASR" simulation, useful for proving the
 * scoring pipeline itself is correct — see __tests__/runner.test.ts).
 * Callers can supply `transcriptOverrides` to simulate specific ASR
 * errors per record ID for targeted severity/gate tests.
 */
export class MockAdapter implements TranscriptionAdapter {
  readonly kind = "mock";
  constructor(
    private readonly options: {
      transcriptOverrides?: Record<string, string>;
      simulatedLatencyMs?: Record<string, number>;
      defaultLatencyMs?: number;
      failRecordIds?: Set<string>;
      timeoutRecordIds?: Set<string>;
    } = {},
  ) {}

  async transcribe(record: CorpusRecord): Promise<AdapterResult> {
    if (this.options.timeoutRecordIds?.has(record.id)) {
      return {
        transcript: "",
        latencyMs: this.options.simulatedLatencyMs?.[record.id] ?? 20_000,
        succeeded: false,
        timedOut: true,
        errorCategory: "transcription_timeout",
        isLive: false,
        isSynthetic: true,
      };
    }
    if (this.options.failRecordIds?.has(record.id)) {
      return {
        transcript: "",
        latencyMs: this.options.simulatedLatencyMs?.[record.id] ?? 500,
        succeeded: false,
        timedOut: false,
        errorCategory: "transcription_failed",
        isLive: false,
        isSynthetic: true,
      };
    }
    const transcript = this.options.transcriptOverrides?.[record.id] ?? record.intendedTranscript;
    return {
      transcript,
      latencyMs:
        this.options.simulatedLatencyMs?.[record.id] ?? this.options.defaultLatencyMs ?? 800,
      succeeded: true,
      timedOut: false,
      errorCategory: null,
      isLive: false,
      isSynthetic: true,
    };
  }
}

export interface LiveAdapterAudioSource {
  getAudioForRecord(recordId: string): Promise<{ blob: Blob; contentType: string } | null>;
}

/**
 * Real HTTP adapter targeting Stage 1's exact endpoint. Never called by
 * any test or by the report-generation path in this commit — Stage 3A
 * has no approved audio fixtures. Exists so Stage 3B can plug in real
 * recordings without redesigning the runner.
 */
export function createLiveAdapter(config: {
  apiKey: string;
  audioSource: LiveAdapterAudioSource;
  languageParam?: string;
  promptText?: string;
  model?: string;
  timeoutMs?: number;
}): TranscriptionAdapter {
  if (!config.apiKey) {
    throw new Error(
      "createLiveAdapter requires an OPENAI_API_KEY — refusing to construct a silently-broken live adapter.",
    );
  }
  return {
    kind: "live",
    async transcribe(record: CorpusRecord): Promise<AdapterResult> {
      const audio = await config.audioSource.getAudioForRecord(record.id);
      if (!audio) {
        return {
          transcript: "",
          latencyMs: 0,
          succeeded: false,
          timedOut: false,
          errorCategory: "no_audio_fixture",
          isLive: true,
          isSynthetic: false,
        };
      }
      const form = new FormData();
      form.append("file", audio.blob, `${record.id}.audio`);
      form.append("model", config.model ?? "gpt-4o-mini-transcribe");
      form.append("response_format", "json");
      if (config.languageParam) form.append("language", config.languageParam);
      if (config.promptText) form.append("prompt", config.promptText);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
      const started = Date.now();
      try {
        const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}` },
          body: form,
          signal: controller.signal,
        });
        const latencyMs = Date.now() - started;
        if (!res.ok) {
          return {
            transcript: "",
            latencyMs,
            succeeded: false,
            timedOut: false,
            errorCategory: `http_${res.status}`,
            isLive: true,
            isSynthetic: false,
          };
        }
        const body = (await res.json()) as { text?: string };
        if (typeof body.text !== "string") {
          return {
            transcript: "",
            latencyMs,
            succeeded: false,
            timedOut: false,
            errorCategory: "missing_transcript",
            isLive: true,
            isSynthetic: false,
          };
        }
        return {
          transcript: body.text,
          latencyMs,
          succeeded: true,
          timedOut: false,
          errorCategory: null,
          isLive: true,
          isSynthetic: false,
        };
      } catch (err) {
        const latencyMs = Date.now() - started;
        const timedOut = err instanceof Error && err.name === "AbortError";
        return {
          transcript: "",
          latencyMs,
          succeeded: false,
          timedOut,
          errorCategory: timedOut ? "transcription_timeout" : "network_failed",
          isLive: true,
          isSynthetic: false,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
