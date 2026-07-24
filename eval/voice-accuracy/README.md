# KainFit Voice Transcription Accuracy Evaluation (Stage 3A)

Offline evaluation infrastructure for the English/Filipino/Taglish speech-to-text meal-logging feature (`supabase/functions/transcribe-voice/`, `src/hooks/useVoiceRecorder.ts`). Deliberately isolated from both `src/` (app code) and `supabase/functions/` (the deployed Edge Function) — nothing here runs in production, and production imports nothing from here.

**This is Stage 3A: corpus, scoring, and offline evaluation infrastructure. No live transcription has been run. See `STAGE_3B_PROTOCOL.md` for the real-audio collection plan that would make a live run possible, and the Stage 3A checkpoint report for exactly what has and hasn't been proven.**

## Layout

- `corpus/` — the 120-utterance golden corpus (`golden-corpus.ts`), its types (`types.ts`), schema validation (`validate.ts`), and the derived adversarial-pair list (`adversarial-pairs.ts`).
- `scoring/` — normalization rules (`normalize.ts`), transcript/semantic/operational metrics (`metrics.ts`), and error-severity classification (`severity.ts`).
- `runner/` — the reproducible evaluation runner (`run-evaluation.ts`), pluggable transcription adapters (`adapters.ts`, mock + a real-but-unused live adapter), and release-gate enforcement (`release-gates.ts`).
- `vocabulary/` — the bounded Filipino evaluation vocabulary (`filipino-vocabulary.ts`).
- `strategy/` — the 5 language-strategy configs for later comparison (`language-strategies.ts`).
- `__tests__/` — all Vitest coverage for the above.
- `STAGE_3B_PROTOCOL.md` — real-speaker audio collection plan (not yet executed).

## Running an evaluation

```ts
import { GOLDEN_CORPUS } from "./corpus/golden-corpus";
import { MockAdapter } from "./runner/adapters";
import { runEvaluation, toMarkdownReport } from "./runner/run-evaluation";
import { evaluateReleaseGates } from "./runner/release-gates";

const summary = await runEvaluation({
  corpus: GOLDEN_CORPUS,
  adapter: new MockAdapter(), // swap for a live adapter once Stage 3B fixtures exist
  runId: "example-run",
  corpusVersion: "1.0.0",
});
const gates = evaluateReleaseGates(summary);
console.log(toMarkdownReport(summary, gates.overallPass));
```

Every `EvaluationSummary` carries `isLiveRun`/`isSyntheticAudio`/`isMobileTested` flags that `release-gates.ts` checks before anything else — a mocked or synthetic run cannot pass the release gate, by construction, regardless of how good its accuracy numbers look.
