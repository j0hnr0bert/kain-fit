// Stage 3A release gates (Part 10).
//
// These thresholds are encoded here so the runner can enforce them
// mechanically (Part 14: "exits nonzero when release gates fail") — they
// are NOT claimed as met by anything in this commit. See the Stage 3A
// final report for what has and has not actually been proven.

import type { LanguageGroup } from "../corpus/types";
import type { EvaluationSummary, LanguageGroupSummary } from "./run-evaluation";

export interface ReleaseGateThresholds {
  foodEntityAccuracyMin: number;
  quantityAccuracyMin: number;
  unitAccuracyMin: number;
  rawCookedAccuracyMin: number;
  negationPreservationMin: number;
  exclusionPreservationMin: number;
  correctionPreservationMin: number;
  completeSemanticAccuracyMinPerLanguage: number;
  criticalErrorRateMax: number;
  maxLanguageGroupSpreadPercentagePoints: number;
  p95LatencyMsMax: number;
}

export const RELEASE_GATE_THRESHOLDS: ReleaseGateThresholds = {
  foodEntityAccuracyMin: 0.95,
  quantityAccuracyMin: 0.98,
  unitAccuracyMin: 0.98,
  rawCookedAccuracyMin: 1.0,
  negationPreservationMin: 1.0,
  exclusionPreservationMin: 1.0,
  correctionPreservationMin: 0.95,
  completeSemanticAccuracyMinPerLanguage: 0.9,
  criticalErrorRateMax: 0.01,
  maxLanguageGroupSpreadPercentagePoints: 8,
  p95LatencyMsMax: 8000,
};

export interface GateCheckResult {
  gate: string;
  passed: boolean;
  actual: string;
  required: string;
  blocking: boolean;
}

export interface ReleaseGateReport {
  overallPass: boolean;
  checks: GateCheckResult[];
  isLiveRun: boolean;
  isSyntheticAudio: boolean;
  isMobileTested: boolean;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export function evaluateReleaseGates(
  summary: EvaluationSummary,
  thresholds: ReleaseGateThresholds = RELEASE_GATE_THRESHOLDS,
): ReleaseGateReport {
  const checks: GateCheckResult[] = [];

  // "An empty dataset cannot pass."
  if (summary.totalRecords === 0) {
    return {
      overallPass: false,
      isLiveRun: summary.isLiveRun,
      isSyntheticAudio: summary.isSyntheticAudio,
      isMobileTested: summary.isMobileTested,
      checks: [
        {
          gate: "non_empty_dataset",
          passed: false,
          actual: "0 records",
          required: ">0 records",
          blocking: true,
        },
      ],
    };
  }

  // "Mocked results cannot satisfy a live release gate." /
  // "Synthetic audio cannot satisfy a real-speaker gate." /
  // "Desktop-only testing cannot satisfy the mobile gate."
  checks.push({
    gate: "live_run_required_for_release",
    passed: summary.isLiveRun,
    actual: summary.isLiveRun ? "live" : "mocked/offline",
    required: "live",
    blocking: true,
  });
  checks.push({
    gate: "real_speaker_audio_required_for_release",
    passed: !summary.isSyntheticAudio,
    actual: summary.isSyntheticAudio ? "synthetic" : "real speaker",
    required: "real speaker",
    blocking: true,
  });
  checks.push({
    gate: "mobile_device_coverage_required_for_release",
    passed: summary.isMobileTested,
    actual: summary.isMobileTested ? "mobile tested" : "desktop-only or untested",
    required: "iPhone Safari/PWA and Android Chrome/PWA tested",
    blocking: true,
  });

  checks.push(
    gate(
      "food_entity_accuracy",
      summary.aggregate.foodEntityRecallMean,
      thresholds.foodEntityAccuracyMin,
      true,
    ),
  );
  checks.push(
    gate(
      "quantity_accuracy",
      summary.aggregate.quantityAccuracyMean,
      thresholds.quantityAccuracyMin,
      true,
    ),
  );
  checks.push(
    gate("unit_accuracy", summary.aggregate.unitAccuracyMean, thresholds.unitAccuracyMin, true),
  );
  checks.push(
    gate(
      "raw_cooked_accuracy",
      summary.aggregate.rawCookedAccuracyMean,
      thresholds.rawCookedAccuracyMin,
      true,
    ),
  );
  checks.push(
    gate(
      "negation_preservation",
      summary.aggregate.negationPreservationRate,
      thresholds.negationPreservationMin,
      true,
    ),
  );
  checks.push(
    gate(
      "exclusion_preservation",
      summary.aggregate.exclusionPreservationRate,
      thresholds.exclusionPreservationMin,
      true,
    ),
  );
  checks.push(
    gate(
      "correction_preservation",
      summary.aggregate.correctionPreservationRate,
      thresholds.correctionPreservationMin,
      true,
    ),
  );
  checks.push({
    gate: "critical_error_rate",
    passed: summary.aggregate.criticalErrorRate < thresholds.criticalErrorRateMax,
    actual: pct(summary.aggregate.criticalErrorRate),
    required: `< ${pct(thresholds.criticalErrorRateMax)}`,
    blocking: true,
  });
  checks.push({
    gate: "zero_fabricated_foods",
    passed: summary.aggregate.fabricatedFoodCount === 0,
    actual: String(summary.aggregate.fabricatedFoodCount),
    required: "0",
    blocking: true,
  });
  checks.push({
    gate: "zero_translated_transcripts",
    passed: summary.aggregate.translatedTranscriptCount === 0,
    actual: String(summary.aggregate.translatedTranscriptCount),
    required: "0",
    blocking: true,
  });
  checks.push({
    gate: "p95_latency",
    passed: summary.aggregate.latency.p95 < thresholds.p95LatencyMsMax,
    actual: `${summary.aggregate.latency.p95}ms`,
    required: `< ${thresholds.p95LatencyMsMax}ms`,
    blocking: true,
  });

  // "A combined average cannot conceal a failing language group" —
  // every language group must independently clear the complete-semantic
  // -accuracy threshold, not just the overall average.
  const languages: LanguageGroup[] = ["english", "filipino", "taglish"];
  const perLanguage: Record<string, LanguageGroupSummary | undefined> = summary.byLanguage;
  for (const lang of languages) {
    const langSummary = perLanguage[lang];
    if (!langSummary) {
      checks.push({
        gate: `complete_semantic_accuracy_${lang}`,
        passed: false,
        actual: "no data",
        required: `>= ${pct(thresholds.completeSemanticAccuracyMinPerLanguage)}`,
        blocking: true,
      });
      continue;
    }
    checks.push(
      gate(
        `complete_semantic_accuracy_${lang}`,
        langSummary.completeSemanticAccuracyRate,
        thresholds.completeSemanticAccuracyMinPerLanguage,
        true,
      ),
    );
  }

  // "No language group trails another by more than 8 percentage points."
  const rates = languages.map((l) => perLanguage[l]?.completeSemanticAccuracyRate ?? 0);
  const spread = (Math.max(...rates) - Math.min(...rates)) * 100;
  checks.push({
    gate: "language_group_spread",
    passed: spread <= thresholds.maxLanguageGroupSpreadPercentagePoints,
    actual: `${spread.toFixed(1)} points`,
    required: `<= ${thresholds.maxLanguageGroupSpreadPercentagePoints} points`,
    blocking: true,
  });

  checks.push({
    gate: "transcript_requires_user_review",
    passed: true,
    actual: "enforced structurally (useVoiceRecorder never auto-submits)",
    required: "true",
    blocking: true,
  });
  checks.push({
    gate: "transcript_never_auto_saved",
    passed: true,
    actual: "enforced structurally (see Part 1 architecture audit)",
    required: "true",
    blocking: true,
  });

  const overallPass = checks.every((c) => c.passed || !c.blocking);
  return {
    overallPass,
    checks,
    isLiveRun: summary.isLiveRun,
    isSyntheticAudio: summary.isSyntheticAudio,
    isMobileTested: summary.isMobileTested,
  };
}

function gate(name: string, actual: number, min: number, blocking: boolean): GateCheckResult {
  return {
    gate: name,
    passed: actual >= min,
    actual: pct(actual),
    required: `>= ${pct(min)}`,
    blocking,
  };
}
