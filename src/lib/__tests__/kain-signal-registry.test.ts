import { describe, it, expect } from "vitest";
import {
  SIGNAL_REGISTRY,
  validateRegistry,
  validateSignalModule,
  type SignalContext,
  type SignalModule,
} from "../kain-signal-registry";
import { detectProteinAdherence } from "../kain-signal-detector-protein";
import { detectLoggingConsistency } from "../kain-signal-detector-logging-consistency";
import {
  proteinAdherenceCopy,
  loggingConsistencyCopy,
  behaviorMilestoneCopy,
} from "../kain-signal-copy";
import type { FoodEntryLite } from "../kain-signal-types";

function foodEntry(overrides: Partial<FoodEntryLite> = {}): FoodEntryLite {
  return {
    logged_at: "2026-07-20T12:00:00.000Z",
    calories: 500,
    protein_g: 40,
    carbs_g: 40,
    fat_g: 15,
    data_source: "text",
    is_estimate: false,
    confidence: 0.9,
    ...overrides,
  };
}

// The 8-complete-day/130g worked example used verbatim across the KainSignal
// test suite: daily protein totals [140,150,120,135,100,145,160,90] -> 5 of
// 8 days meet the target.
const proteinDailyTotals = [140, 150, 120, 135, 100, 145, 160, 90];
const completeDays = proteinDailyTotals.map((_, i) => `2026-07-${13 + i}`);
const entriesByDay: Record<string, FoodEntryLite[]> = {};
proteinDailyTotals.forEach((total, i) => {
  entriesByDay[completeDays[i]] = [
    foodEntry({ protein_g: total, logged_at: `2026-07-${13 + i}T12:00:00.000Z` }),
  ];
});

const ctx: SignalContext = {
  entriesByDay,
  completeDays,
  activeDays: completeDays,
  todayManila: "2026-07-20",
  windowDays: 60,
  proteinTargetG: 130,
  lifetimeMealCount: proteinDailyTotals.length,
  lifetimeDistinctLoggingDays: completeDays.length,
  recordedMilestoneKeys: new Set<string>(),
};

describe("SIGNAL_REGISTRY", () => {
  it("registers exactly the three approved current categories, each with a distinct class and voice", () => {
    expect(SIGNAL_REGISTRY.map((m) => m.id).sort()).toEqual([
      "behavior_milestone",
      "logging_consistency",
      "protein_adherence",
    ]);
    const byId = Object.fromEntries(SIGNAL_REGISTRY.map((m) => [m.id, m]));
    expect(byId.protein_adherence.signalClass).toBe("reveal");
    expect(byId.protein_adherence.voice).toBe("scientist");
    expect(byId.logging_consistency.signalClass).toBe("protect");
    expect(byId.logging_consistency.voice).toBe("coach");
    expect(byId.behavior_milestone.signalClass).toBe("milestone");
    expect(byId.behavior_milestone.voice).toBe("observer");
  });

  it("protein_adherence module's buildCandidate matches calling detectProteinAdherence directly", () => {
    const module = SIGNAL_REGISTRY.find((m) => m.id === "protein_adherence")!;
    const viaModule = module.buildCandidate(ctx);
    const viaDetector = detectProteinAdherence({
      entriesByDay: ctx.entriesByDay,
      completeDays: ctx.completeDays,
      proteinTargetG: ctx.proteinTargetG,
    });
    expect(viaModule).toEqual(viaDetector);
  });

  it("logging_consistency module's buildCandidate matches calling detectLoggingConsistency directly", () => {
    const module = SIGNAL_REGISTRY.find((m) => m.id === "logging_consistency")!;
    const viaModule = module.buildCandidate(ctx);
    const viaDetector = detectLoggingConsistency({
      activeDays: ctx.activeDays,
      todayManila: ctx.todayManila,
      windowDays: ctx.windowDays,
    });
    expect(viaModule).toEqual(viaDetector);
  });

  it("behavior_milestone module qualifies when a lifetime threshold is newly crossed", () => {
    const module = SIGNAL_REGISTRY.find((m) => m.id === "behavior_milestone")!;
    const evidence = module.buildCandidate({ ...ctx, lifetimeMealCount: 25 });
    expect(evidence).not.toBeNull();
    expect(evidence).toMatchObject({ milestoneType: "meal_count", threshold: 25 });
  });

  it("behavior_milestone module does not re-qualify an already-recorded threshold", () => {
    const module = SIGNAL_REGISTRY.find((m) => m.id === "behavior_milestone")!;
    // Every threshold <=25 must already be recorded for this to isolate
    // "was 25 specifically re-offered" — a real user would have crossed
    // (and recorded) 10 before ever reaching 25, so this fixture matches
    // the realistic accumulated-dedup state, not just a single key.
    const evidence = module.buildCandidate({
      ...ctx,
      lifetimeMealCount: 25,
      lifetimeDistinctLoggingDays: 3, // below the lowest distinct-day threshold — isolates the meal_count ladder
      recordedMilestoneKeys: new Set(["meal_count:10", "meal_count:25"]),
    });
    expect(evidence).toBeNull();
  });

  it("each module's renderCopy matches calling the underlying copy function directly", () => {
    const proteinModule = SIGNAL_REGISTRY.find((m) => m.id === "protein_adherence")!;
    const proteinEvidence = proteinModule.buildCandidate(ctx)!;
    if (proteinEvidence.insightType !== "protein_adherence") throw new Error("unreachable");
    expect(proteinModule.renderCopy(proteinEvidence)).toEqual(
      proteinAdherenceCopy(proteinEvidence),
    );

    const loggingModule = SIGNAL_REGISTRY.find((m) => m.id === "logging_consistency")!;
    const loggingEvidence = loggingModule.buildCandidate(ctx)!;
    if (loggingEvidence.insightType !== "logging_consistency") throw new Error("unreachable");
    expect(loggingModule.renderCopy(loggingEvidence)).toEqual(
      loggingConsistencyCopy(loggingEvidence),
    );

    const milestoneModule = SIGNAL_REGISTRY.find((m) => m.id === "behavior_milestone")!;
    const milestoneEvidence = milestoneModule.buildCandidate({ ...ctx, lifetimeMealCount: 25 })!;
    if (milestoneEvidence.insightType !== "behavior_milestone") throw new Error("unreachable");
    expect(milestoneModule.renderCopy(milestoneEvidence)).toEqual(
      behaviorMilestoneCopy(milestoneEvidence),
    );
  });

  it("a module's renderCopy throws when given evidence for a different category", () => {
    const proteinModule = SIGNAL_REGISTRY.find((m) => m.id === "protein_adherence")!;
    const loggingModule = SIGNAL_REGISTRY.find((m) => m.id === "logging_consistency")!;
    const loggingEvidence = loggingModule.buildCandidate(ctx)!;
    expect(() => proteinModule.renderCopy(loggingEvidence)).toThrow();
  });

  it("buildCandidate returns null (ineligible) when the module's prohibited condition holds — no protein target set", () => {
    const proteinModule = SIGNAL_REGISTRY.find((m) => m.id === "protein_adherence")!;
    expect(proteinModule.buildCandidate({ ...ctx, proteinTargetG: null })).toBeNull();
  });
});

describe("registry validation — enforceable historical-evidence boundary", () => {
  it("the real registry validates cleanly (already asserted at import time, re-checked explicitly here)", () => {
    expect(() => validateRegistry(SIGNAL_REGISTRY)).not.toThrow();
  });

  it("every registered module uses a valid class and voice", () => {
    const VALID_CLASSES = ["reveal", "protect", "milestone"];
    const VALID_VOICES = ["scientist", "coach", "observer"];
    for (const module of SIGNAL_REGISTRY) {
      expect(VALID_CLASSES).toContain(module.signalClass);
      expect(VALID_VOICES).toContain(module.voice);
    }
  });

  it("registry ids are unique", () => {
    const ids = SIGNAL_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects a duplicate-id registry", () => {
    const dupe: SignalModule = { ...SIGNAL_REGISTRY[0] };
    expect(() => validateRegistry([...SIGNAL_REGISTRY, dupe])).toThrow(/duplicate/i);
  });

  it("rejects a non-milestone module that requires fewer than 2 distinct days of evidence (same-day-only)", () => {
    const badModule: SignalModule = {
      id: "protein_adherence",
      signalClass: "reveal",
      voice: "scientist",
      version: 1,
      evidenceWindow: { kind: "rolling-days", minDistinctDays: 1 },
      buildCandidate: () => null,
      renderCopy: () => {
        throw new Error("unused");
      },
    };
    expect(() => validateSignalModule(badModule)).toThrow(/historical evidence|same-day/i);
  });

  it("rejects a non-milestone module declaring a milestone-identity evidence window", () => {
    const badModule: SignalModule = {
      id: "logging_consistency",
      signalClass: "protect",
      voice: "coach",
      version: 1,
      evidenceWindow: { kind: "milestone-identity" },
      buildCandidate: () => null,
      renderCopy: () => {
        throw new Error("unused");
      },
    };
    expect(() => validateSignalModule(badModule)).toThrow();
  });

  it("rejects a milestone-class module that doesn't declare milestone-identity", () => {
    const badModule: SignalModule = {
      id: "behavior_milestone",
      signalClass: "milestone",
      voice: "observer",
      version: 1,
      evidenceWindow: { kind: "rolling-days", minDistinctDays: 5 },
      buildCandidate: () => null,
      renderCopy: () => {
        throw new Error("unused");
      },
    };
    expect(() => validateSignalModule(badModule)).toThrow(/milestone-identity/);
  });

  it("rejects an invalid signalClass", () => {
    const badModule = {
      id: "protein_adherence",
      signalClass: "correct", // deliberately invalid for this test — no longer a real class
      voice: "scientist",
      version: 1,
      evidenceWindow: { kind: "rolling-days", minDistinctDays: 5 },
      buildCandidate: () => null,
      renderCopy: () => {
        throw new Error("unused");
      },
    } as unknown as SignalModule;
    expect(() => validateSignalModule(badModule)).toThrow(/invalid signalClass/);
  });

  it("rejects an invalid voice", () => {
    const badModule = {
      id: "protein_adherence",
      signalClass: "reveal",
      voice: "strategist", // deliberately invalid for this test — no longer a real voice
      version: 1,
      evidenceWindow: { kind: "rolling-days", minDistinctDays: 5 },
      buildCandidate: () => null,
      renderCopy: () => {
        throw new Error("unused");
      },
    } as unknown as SignalModule;
    expect(() => validateSignalModule(badModule)).toThrow(/invalid voice/);
  });
});
