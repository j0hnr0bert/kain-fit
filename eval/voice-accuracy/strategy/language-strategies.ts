// Stage 3A language-strategy experiment design (Part 11).
//
// This file defines the 5 strategies to compare — it does NOT pick a
// winner and does NOT wire any of them into production. Stage 2's
// languageMode hook (src/hooks/useVoiceRecorder.ts) and Stage 1/2.5's
// `language` query param (supabase/functions/transcribe-voice/index.ts,
// guard.ts) remain unset by every current call site; nothing here
// changes that.
//
// Rules enforced by convention, not code (there is no live transcription
// to run yet — see the Stage 3A final report's "what has not been
// tested" section):
//   - never force Tagalog for Taglish without evidence
//   - never translate
//   - never auto-correct quantities
//   - never tune against the locked_challenge corpus split
//   - the winner is selected by semantic accuracy first, latency second
//     — a strategy that improves fluency/WER but worsens quantity or
//     unit accuracy loses, full stop.

import { KAINFIT_VOCABULARY_PROMPT } from "../../../supabase/functions/transcribe-voice/logic";

export type LanguageStrategyId = "A" | "B" | "C" | "D" | "E";

export interface LanguageStrategyConfig {
  id: LanguageStrategyId;
  name: string;
  description: string;
  model: string; // exact model, mirrors logic.ts's DEFAULT_MODEL
  endpoint: string; // exact endpoint, mirrors logic.ts's OPENAI_TRANSCRIPTIONS_URL
  languageParam: string | undefined; // the `language` form field sent, if any
  promptText: string | undefined; // the `prompt` form field sent, if any
}

const MODEL = "gpt-4o-mini-transcribe";
const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";

export const LANGUAGE_STRATEGIES: LanguageStrategyConfig[] = [
  {
    id: "A",
    name: "Automatic detection, no hint",
    description:
      "No `language` param sent; relies entirely on the model's own language identification. Baseline.",
    model: MODEL,
    endpoint: ENDPOINT,
    languageParam: undefined,
    promptText: undefined,
  },
  {
    id: "B",
    name: "English language hint",
    description:
      "`language=en` sent on every request, regardless of the utterance's actual language. Expected to help pure English, likely to hurt Filipino/Taglish by biasing decoding toward English phonotactics.",
    model: MODEL,
    endpoint: ENDPOINT,
    languageParam: "en",
    promptText: undefined,
  },
  {
    id: "C",
    name: "Filipino/Tagalog language hint",
    description:
      "`language=tl` sent on every request. Expected to help pure Filipino, but risks forcing Taglish's English segments through Tagalog-biased decoding — exactly the failure mode the 'do not force Tagalog for Taglish without evidence' rule exists to catch.",
    model: MODEL,
    endpoint: ENDPOINT,
    languageParam: "tl",
    promptText: undefined,
  },
  {
    id: "D",
    name: "KainFit vocabulary prompt, no language hint",
    description:
      "No `language` param; `prompt` set to the existing production KAINFIT_VOCABULARY_PROMPT (imported directly from logic.ts, not duplicated) to bias toward Filipino food vocabulary without constraining language identification.",
    model: MODEL,
    endpoint: ENDPOINT,
    languageParam: undefined,
    promptText: KAINFIT_VOCABULARY_PROMPT,
  },
  {
    id: "E",
    name: "Automatic detection plus vocabulary prompt",
    description:
      "No `language` param, `prompt` set to KAINFIT_VOCABULARY_PROMPT. Combines A's language flexibility with D's vocabulary bias.",
    model: MODEL,
    endpoint: ENDPOINT,
    languageParam: undefined,
    promptText: KAINFIT_VOCABULARY_PROMPT,
  },
];

export interface StrategyRunRecord {
  strategyId: LanguageStrategyId;
  model: string;
  endpoint: string;
  languageParam: string | undefined;
  promptText: string | undefined;
  corpusVersion: string;
  runId: string;
  timestamp: string;
  isLive: boolean; // false for every run until Stage 3B supplies real audio
}

export function describeStrategyForManifest(
  strategy: LanguageStrategyConfig,
  corpusVersion: string,
  runId: string,
  isLive: boolean,
): StrategyRunRecord {
  return {
    strategyId: strategy.id,
    model: strategy.model,
    endpoint: strategy.endpoint,
    languageParam: strategy.languageParam,
    promptText: strategy.promptText,
    corpusVersion,
    runId,
    timestamp: new Date().toISOString(),
    isLive,
  };
}
