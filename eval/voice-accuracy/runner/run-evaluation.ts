// Stage 3A reproducible evaluation runner (Part 14).
//
// Validates the corpus, runs every record through a configurable
// TranscriptionAdapter, scores each result, classifies errors, and
// aggregates overall + per-language summaries. Never prints an API key
// (adapters take one as a constructor argument, never logged here),
// never embeds raw audio in its output (only transcript TEXT — see the
// "clearly labels mocked/synthetic/live" note below for why that's safe
// for this corpus, and Part 13's privacy protocol for real audio later).

import {
  normalizedWordErrorRate,
  wordErrorRate,
  characterErrorRate,
  scoreSemanticMeal,
  latencyPercentiles,
} from "../scoring/metrics";
import { classifyErrors, worstSeverity, type DetectedError } from "../scoring/severity";
import { validateCorpus } from "../corpus/validate";
import type { CorpusRecord, LanguageGroup } from "../corpus/types";
import type { TranscriptionAdapter, AdapterResult } from "./adapters";

export interface RecordResult {
  recordId: string;
  languageGroup: LanguageGroup;
  testSplit: string;
  difficulty: string;
  isAdversarial: boolean;
  transcript: string;
  succeeded: boolean;
  timedOut: boolean;
  latencyMs: number;
  wer: number;
  cer: number;
  normalizedWer: number;
  semantic: ReturnType<typeof scoreSemanticMeal>;
  errors: DetectedError[];
  worstSeverity: ReturnType<typeof worstSeverity>;
}

export interface LanguageGroupSummary {
  languageGroup: LanguageGroup;
  recordCount: number;
  successRate: number;
  emptyTranscriptRate: number;
  timeoutRate: number;
  criticalErrorRate: number;
  foodEntityRecallMean: number;
  quantityAccuracyMean: number;
  unitAccuracyMean: number;
  completeSemanticAccuracyRate: number;
  meanNormalizedWer: number;
}

export interface AggregateSummary {
  successRate: number;
  emptyTranscriptRate: number;
  retryRate: number; // always 0 for mocked runs (no retry loop implemented in the runner itself — Stage 1's own 2-attempt retry is server-side and invisible here)
  timeoutRate: number;
  criticalErrorRate: number;
  foodEntityRecallMean: number;
  quantityAccuracyMean: number;
  unitAccuracyMean: number;
  rawCookedAccuracyMean: number;
  negationPreservationRate: number;
  exclusionPreservationRate: number;
  correctionPreservationRate: number;
  fabricatedFoodCount: number;
  translatedTranscriptCount: number; // always 0 unless explicitly detected — see note in runEvaluation
  latency: ReturnType<typeof latencyPercentiles>;
}

export interface EvaluationSummary {
  runId: string;
  timestamp: string;
  corpusVersion: string;
  totalRecords: number;
  isLiveRun: boolean;
  isSyntheticAudio: boolean;
  isMobileTested: boolean;
  adapterKind: "mock" | "live";
  aggregate: AggregateSummary;
  byLanguage: Record<string, LanguageGroupSummary>;
  results: RecordResult[];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function knownFoodVocabulary(records: CorpusRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) {
    for (const f of r.expected.foods) set.add(f.food);
  }
  return [...set];
}

export interface RunEvaluationOptions {
  corpus: CorpusRecord[];
  adapter: TranscriptionAdapter;
  runId: string;
  corpusVersion: string;
  isMobileTested?: boolean;
}

export async function runEvaluation(options: RunEvaluationOptions): Promise<EvaluationSummary> {
  const validation = validateCorpus(options.corpus);
  if (!validation.valid) {
    throw new Error(
      `Corpus failed validation, refusing to run: ${validation.errors.map((e) => e.message).join("; ")}`,
    );
  }

  const vocabulary = knownFoodVocabulary(options.corpus);
  const results: RecordResult[] = [];
  let anyLive = false;
  let anySynthetic = false;

  for (const record of options.corpus) {
    const adapterResult: AdapterResult = await options.adapter.transcribe(record);
    anyLive = anyLive || adapterResult.isLive;
    anySynthetic = anySynthetic || adapterResult.isSynthetic;

    const transcript = adapterResult.transcript;
    const wer = wordErrorRate(record.intendedTranscript, transcript);
    const cer = characterErrorRate(record.intendedTranscript, transcript);
    const normalizedWer = normalizedWordErrorRate(record.intendedTranscript, transcript);
    const semantic = scoreSemanticMeal(record.expected, transcript);
    const errors = adapterResult.succeeded
      ? classifyErrors(record.expected, transcript, semantic, normalizedWer, vocabulary)
      : [
          {
            severity: "critical" as const,
            category: "removed_spoken_food" as const,
            field: "transcript",
            detail: `Transcription did not succeed (${adapterResult.errorCategory ?? "unknown"}).`,
          },
        ];

    results.push({
      recordId: record.id,
      languageGroup: record.languageGroup,
      testSplit: record.testSplit,
      difficulty: record.difficulty,
      isAdversarial: record.isAdversarial,
      transcript,
      succeeded: adapterResult.succeeded,
      timedOut: adapterResult.timedOut,
      latencyMs: adapterResult.latencyMs,
      wer,
      cer,
      normalizedWer,
      semantic,
      errors,
      worstSeverity: worstSeverity(errors),
    });
  }

  const aggregate = summarize(results);
  const byLanguage: Record<string, LanguageGroupSummary> = {};
  for (const lang of ["english", "filipino", "taglish"] as LanguageGroup[]) {
    const subset = results.filter((r) => r.languageGroup === lang);
    byLanguage[lang] = summarizeLanguage(lang, subset);
  }

  return {
    runId: options.runId,
    timestamp: new Date().toISOString(),
    corpusVersion: options.corpusVersion,
    totalRecords: options.corpus.length,
    isLiveRun: anyLive,
    isSyntheticAudio: anySynthetic || !anyLive, // a mock/offline run is treated as synthetic-or-worse by definition
    isMobileTested: options.isMobileTested ?? false,
    adapterKind: options.adapter.kind,
    aggregate,
    byLanguage,
    results,
  };
}

function summarizeLanguage(lang: LanguageGroup, subset: RecordResult[]): LanguageGroupSummary {
  const n = subset.length;
  return {
    languageGroup: lang,
    recordCount: n,
    successRate: n === 0 ? 0 : subset.filter((r) => r.succeeded).length / n,
    emptyTranscriptRate:
      n === 0 ? 0 : subset.filter((r) => r.succeeded && r.transcript.trim() === "").length / n,
    timeoutRate: n === 0 ? 0 : subset.filter((r) => r.timedOut).length / n,
    criticalErrorRate:
      n === 0 ? 0 : subset.filter((r) => r.worstSeverity === "critical").length / n,
    foodEntityRecallMean: mean(subset.map((r) => r.semantic.foodEntityRecall)),
    quantityAccuracyMean: mean(subset.map((r) => r.semantic.quantityAccuracy ?? 1)),
    unitAccuracyMean: mean(subset.map((r) => r.semantic.unitAccuracy ?? 1)),
    completeSemanticAccuracyRate:
      n === 0 ? 0 : subset.filter((r) => r.semantic.completeSemanticMealAccuracy).length / n,
    meanNormalizedWer: mean(subset.map((r) => r.normalizedWer)),
  };
}

function summarize(results: RecordResult[]): AggregateSummary {
  const n = results.length;
  const fabricatedFoodCount = results.reduce(
    (sum, r) => sum + r.errors.filter((e) => e.category === "added_food_never_spoken").length,
    0,
  );
  return {
    successRate: n === 0 ? 0 : results.filter((r) => r.succeeded).length / n,
    emptyTranscriptRate:
      n === 0 ? 0 : results.filter((r) => r.succeeded && r.transcript.trim() === "").length / n,
    retryRate: 0,
    timeoutRate: n === 0 ? 0 : results.filter((r) => r.timedOut).length / n,
    criticalErrorRate:
      n === 0 ? 0 : results.filter((r) => r.worstSeverity === "critical").length / n,
    foodEntityRecallMean: mean(results.map((r) => r.semantic.foodEntityRecall)),
    quantityAccuracyMean: mean(results.map((r) => r.semantic.quantityAccuracy ?? 1)),
    unitAccuracyMean: mean(results.map((r) => r.semantic.unitAccuracy ?? 1)),
    rawCookedAccuracyMean: mean(results.map((r) => r.semantic.rawCookedAccuracy ?? 1)),
    negationPreservationRate: mean(
      results.map((r) =>
        r.semantic.negationPreserved === null ? 1 : r.semantic.negationPreserved ? 1 : 0,
      ),
    ),
    exclusionPreservationRate: mean(
      results.map((r) =>
        r.semantic.exclusionsPreserved === null ? 1 : r.semantic.exclusionsPreserved ? 1 : 0,
      ),
    ),
    correctionPreservationRate: mean(
      results.map((r) =>
        r.semantic.correctionsPreserved === null ? 1 : r.semantic.correctionsPreserved ? 1 : 0,
      ),
    ),
    fabricatedFoodCount,
    translatedTranscriptCount: 0, // translation detection requires a real transcript from a genuinely different-language ASR path; not computable from mocked/self-echoing runs — always reported as 0 with this caveat, never silently assumed
    latency: latencyPercentiles(results.map((r) => r.latencyMs)),
  };
}

export function toMarkdownReport(
  summary: EvaluationSummary,
  gateReportOverallPass: boolean,
): string {
  const lines: string[] = [];
  lines.push(`# Voice Transcription Evaluation Report`);
  lines.push("");
  lines.push(`**Run ID:** ${summary.runId}  `);
  lines.push(`**Timestamp:** ${summary.timestamp}  `);
  lines.push(`**Corpus version:** ${summary.corpusVersion}  `);
  lines.push(`**Adapter:** ${summary.adapterKind}  `);
  lines.push(
    `**Run type:** ${summary.isLiveRun ? "LIVE" : "MOCKED/OFFLINE"} — ${summary.isSyntheticAudio ? "SYNTHETIC or no audio" : "real speaker audio"} — mobile tested: ${summary.isMobileTested ? "yes" : "no"}  `,
  );
  lines.push("");
  if (!summary.isLiveRun) {
    lines.push(
      "> ⚠️ This is not a live run. No accuracy claim in this report is evidence of real transcription accuracy.",
    );
    lines.push("");
  }
  lines.push(`**Overall release gate result:** ${gateReportOverallPass ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push("## Aggregate metrics");
  lines.push("");
  lines.push(`- Success rate: ${(summary.aggregate.successRate * 100).toFixed(1)}%`);
  lines.push(`- Critical error rate: ${(summary.aggregate.criticalErrorRate * 100).toFixed(2)}%`);
  lines.push(`- Food-entity recall: ${(summary.aggregate.foodEntityRecallMean * 100).toFixed(1)}%`);
  lines.push(`- Quantity accuracy: ${(summary.aggregate.quantityAccuracyMean * 100).toFixed(1)}%`);
  lines.push(`- Unit accuracy: ${(summary.aggregate.unitAccuracyMean * 100).toFixed(1)}%`);
  lines.push(
    `- Latency P50/P75/P90/P95 (ms): ${summary.aggregate.latency.p50}/${summary.aggregate.latency.p75}/${summary.aggregate.latency.p90}/${summary.aggregate.latency.p95}`,
  );
  lines.push("");
  lines.push("## By language group");
  lines.push("");
  lines.push("| Language | N | Success | Complete semantic accuracy | Critical error rate |");
  lines.push("|---|---|---|---|---|");
  for (const lang of ["english", "filipino", "taglish"]) {
    const s = summary.byLanguage[lang];
    if (!s) continue;
    lines.push(
      `| ${lang} | ${s.recordCount} | ${(s.successRate * 100).toFixed(1)}% | ${(s.completeSemanticAccuracyRate * 100).toFixed(1)}% | ${(s.criticalErrorRate * 100).toFixed(2)}% |`,
    );
  }
  lines.push("");
  const criticalResults = summary.results.filter((r) => r.worstSeverity === "critical");
  lines.push(`## Critical errors (${criticalResults.length})`);
  lines.push("");
  for (const r of criticalResults) {
    for (const e of r.errors.filter((e) => e.severity === "critical")) {
      lines.push(`- **${r.recordId}** [${e.category}] ${e.detail}`);
    }
  }
  return lines.join("\n");
}
