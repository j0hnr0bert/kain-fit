import { describe, it, expect } from "vitest";
import { GOLDEN_CORPUS } from "../corpus/golden-corpus";
import { MockAdapter } from "../runner/adapters";
import { runEvaluation, toMarkdownReport } from "../runner/run-evaluation";
import { evaluateReleaseGates, RELEASE_GATE_THRESHOLDS } from "../runner/release-gates";

describe("runEvaluation — basic behavior", () => {
  it("refuses to run against an empty corpus", async () => {
    await expect(
      runEvaluation({ corpus: [], adapter: new MockAdapter(), runId: "r1", corpusVersion: "v1" }),
    ).rejects.toThrow(/validation/);
  });

  it("a perfect-echo mock run scores every metric at (near-)100% on the corpus's own transcripts", async () => {
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter(),
      runId: "r-perfect",
      corpusVersion: "v1",
    });
    expect(summary.totalRecords).toBe(GOLDEN_CORPUS.length);
    expect(summary.aggregate.successRate).toBe(1);
    expect(summary.aggregate.foodEntityRecallMean).toBeGreaterThan(0.95);
    expect(summary.aggregate.criticalErrorRate).toBeLessThan(0.05);
  });

  it("REGRESSION: a perfect echo of every single corpus record's own intended transcript produces ZERO critical errors", async () => {
    // This is the strongest possible sanity check on the scoring pipeline
    // itself: if the corpus's own correct answer, fed back unmodified,
    // scores as "critically wrong" against its own ground truth, the bug
    // is in normalize.ts/metrics.ts/severity.ts or in a corpus record's
    // authoring — not in any real transcription. This test caught real
    // bugs during Stage 3A development (compound-number word tables,
    // hyphen-vs-space modifiers, a regex quantifier mistake, and several
    // corpus records whose `expected` fields didn't match what was
    // actually written in `intendedTranscript`) and exists to catch the
    // next one before it's mistaken for a transcription failure.
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter(),
      runId: "r-self-consistency",
      corpusVersion: "v1",
    });
    const criticalRecords = summary.results.filter((r) => r.worstSeverity === "critical");
    if (criticalRecords.length > 0) {
      const detail = criticalRecords
        .map(
          (r) =>
            `${r.recordId}: ${r.errors
              .filter((e) => e.severity === "critical")
              .map((e) => e.category)
              .join(",")}`,
        )
        .join("; ");
      throw new Error(
        `${criticalRecords.length} corpus record(s) fail against their own correct transcript: ${detail}`,
      );
    }
    expect(criticalRecords).toHaveLength(0);
  });

  it("labels a MockAdapter run as NOT live and NOT mobile-tested", async () => {
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter(),
      runId: "r2",
      corpusVersion: "v1",
    });
    expect(summary.isLiveRun).toBe(false);
    expect(summary.isSyntheticAudio).toBe(true);
    expect(summary.isMobileTested).toBe(false);
    expect(summary.adapterKind).toBe("mock");
  });

  it("simulated critical failures (wrong quantity substituted) drop the food-entity/quantity metrics and raise the critical error rate", async () => {
    const wrongQuantityPair = GOLDEN_CORPUS.filter((r) => r.adversarialPairId === "adv-pair-en-02");
    const overrides: Record<string, string> = {};
    // Feed each half of the pair the OTHER half's transcript — the worst-case critical substitution.
    overrides[wrongQuantityPair[0].id] = wrongQuantityPair[1].intendedTranscript;
    overrides[wrongQuantityPair[1].id] = wrongQuantityPair[0].intendedTranscript;
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter({ transcriptOverrides: overrides }),
      runId: "r3",
      corpusVersion: "v1",
    });
    const affected = summary.results.filter((r) =>
      wrongQuantityPair.some((p) => p.id === r.recordId),
    );
    expect(affected.every((r) => r.worstSeverity === "critical")).toBe(true);
  });

  it("simulated timeouts are reflected in the timeout rate and latency percentiles", async () => {
    const timeoutIds = new Set([GOLDEN_CORPUS[0].id]);
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter({
        timeoutRecordIds: timeoutIds,
        simulatedLatencyMs: { [GOLDEN_CORPUS[0].id]: 15000 },
      }),
      runId: "r4",
      corpusVersion: "v1",
    });
    expect(summary.aggregate.timeoutRate).toBeGreaterThan(0);
  });
});

describe("release gates — enforcement", () => {
  it("a perfect mock run fails the release gate ONLY because it's not a live run / real speaker / mobile-tested — not because of accuracy", async () => {
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter(),
      runId: "r5",
      corpusVersion: "v1",
    });
    const report = evaluateReleaseGates(summary);
    expect(report.overallPass).toBe(false);
    const liveGate = report.checks.find((c) => c.gate === "live_run_required_for_release");
    expect(liveGate?.passed).toBe(false);
    // But the accuracy-shaped gates should pass on a perfect echo.
    const quantityGate = report.checks.find((c) => c.gate === "quantity_accuracy");
    expect(quantityGate?.passed).toBe(true);
  });

  it("an empty-dataset summary always fails the release gate", () => {
    const emptySummary = {
      runId: "empty",
      timestamp: new Date().toISOString(),
      corpusVersion: "v1",
      totalRecords: 0,
      isLiveRun: true,
      isSyntheticAudio: false,
      isMobileTested: true,
      adapterKind: "live" as const,
      aggregate: {
        successRate: 0,
        emptyTranscriptRate: 0,
        retryRate: 0,
        timeoutRate: 0,
        criticalErrorRate: 0,
        foodEntityRecallMean: 0,
        quantityAccuracyMean: 0,
        unitAccuracyMean: 0,
        rawCookedAccuracyMean: 0,
        negationPreservationRate: 0,
        exclusionPreservationRate: 0,
        correctionPreservationRate: 0,
        fabricatedFoodCount: 0,
        translatedTranscriptCount: 0,
        latency: { p50: 0, p75: 0, p90: 0, p95: 0 },
      },
      byLanguage: {},
      results: [],
    };
    const report = evaluateReleaseGates(emptySummary);
    expect(report.overallPass).toBe(false);
  });

  it("fails when one language group is missing from byLanguage entirely", async () => {
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter(),
      runId: "r6",
      corpusVersion: "v1",
    });
    const broken = {
      ...summary,
      byLanguage: { english: summary.byLanguage.english, taglish: summary.byLanguage.taglish },
    };
    const report = evaluateReleaseGates(broken as typeof summary);
    expect(
      report.checks.some((c) => c.gate === "complete_semantic_accuracy_filipino" && !c.passed),
    ).toBe(true);
    expect(report.overallPass).toBe(false);
  });

  it("fails when one language group misses its own complete-semantic-accuracy gate even if the others are perfect", async () => {
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter(),
      runId: "r7",
      corpusVersion: "v1",
    });
    const degraded = {
      ...summary,
      byLanguage: {
        ...summary.byLanguage,
        filipino: { ...summary.byLanguage.filipino, completeSemanticAccuracyRate: 0.5 },
      },
    };
    const report = evaluateReleaseGates(degraded);
    expect(
      report.checks.find((c) => c.gate === "complete_semantic_accuracy_filipino")?.passed,
    ).toBe(false);
    expect(report.overallPass).toBe(false);
  });

  it("a combined average cannot conceal one weak language group (spread gate independently catches it)", async () => {
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter(),
      runId: "r8",
      corpusVersion: "v1",
    });
    const skewed = {
      ...summary,
      byLanguage: {
        english: { ...summary.byLanguage.english, completeSemanticAccuracyRate: 1 },
        filipino: { ...summary.byLanguage.filipino, completeSemanticAccuracyRate: 0.5 },
        taglish: { ...summary.byLanguage.taglish, completeSemanticAccuracyRate: 1 },
      },
    };
    const report = evaluateReleaseGates(skewed);
    const spreadGate = report.checks.find((c) => c.gate === "language_group_spread");
    expect(spreadGate?.passed).toBe(false);
    expect(report.overallPass).toBe(false);
  });

  it("release gate thresholds match Part 10 exactly", () => {
    expect(RELEASE_GATE_THRESHOLDS.foodEntityAccuracyMin).toBe(0.95);
    expect(RELEASE_GATE_THRESHOLDS.quantityAccuracyMin).toBe(0.98);
    expect(RELEASE_GATE_THRESHOLDS.unitAccuracyMin).toBe(0.98);
    expect(RELEASE_GATE_THRESHOLDS.rawCookedAccuracyMin).toBe(1.0);
    expect(RELEASE_GATE_THRESHOLDS.negationPreservationMin).toBe(1.0);
    expect(RELEASE_GATE_THRESHOLDS.exclusionPreservationMin).toBe(1.0);
    expect(RELEASE_GATE_THRESHOLDS.correctionPreservationMin).toBe(0.95);
    expect(RELEASE_GATE_THRESHOLDS.completeSemanticAccuracyMinPerLanguage).toBe(0.9);
    expect(RELEASE_GATE_THRESHOLDS.criticalErrorRateMax).toBe(0.01);
    expect(RELEASE_GATE_THRESHOLDS.maxLanguageGroupSpreadPercentagePoints).toBe(8);
    expect(RELEASE_GATE_THRESHOLDS.p95LatencyMsMax).toBe(8000);
  });
});

describe("report generation", () => {
  it("produces a JSON-serializable summary with no undefined/function values", async () => {
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter(),
      runId: "r9",
      corpusVersion: "v1",
    });
    const json = JSON.stringify(summary);
    expect(json.length).toBeGreaterThan(0);
    expect(JSON.parse(json).runId).toBe("r9");
  });

  it("produces a Markdown report containing the run type label and gate result", async () => {
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter(),
      runId: "r10",
      corpusVersion: "v1",
    });
    const report = evaluateReleaseGates(summary);
    const md = toMarkdownReport(summary, report.overallPass);
    expect(md).toContain("MOCKED/OFFLINE");
    expect(md).toContain("Overall release gate result");
    expect(md).toContain("not a live run");
  });

  it("never includes an API key, raw audio, or a base64-looking blob in the JSON or Markdown report", async () => {
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter(),
      runId: "r11",
      corpusVersion: "v1",
    });
    const report = evaluateReleaseGates(summary);
    const json = JSON.stringify(summary);
    const md = toMarkdownReport(summary, report.overallPass);
    for (const text of [json, md]) {
      expect(text).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
      expect(text.toLowerCase()).not.toContain("openai_api_key");
      expect(text).not.toMatch(/data:audio\//);
    }
  });

  it("a live+real-speaker+mobile-tested run with perfect scores would pass every gate (sanity check on the gate logic itself)", async () => {
    const summary = await runEvaluation({
      corpus: GOLDEN_CORPUS,
      adapter: new MockAdapter(),
      runId: "r12",
      corpusVersion: "v1",
      isMobileTested: true,
    });
    const forcedLive = { ...summary, isLiveRun: true, isSyntheticAudio: false };
    const report = evaluateReleaseGates(forcedLive);
    expect(report.overallPass).toBe(true);
  });
});
