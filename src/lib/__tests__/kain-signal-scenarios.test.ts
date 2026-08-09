// KainSignal V2 recalibration (2026-08-08) — synthetic user histories, run
// through the real pipeline end to end (detector -> guardrail -> copy),
// per the recalibration spec's required test matrix (Cases A-H). Each case
// documents Input / Expected / what the pipeline Actually produces, and
// asserts on it.

import { describe, it, expect } from "vitest";
import { detectProteinAdherence } from "../kain-signal-detector-protein";
import { proteinAdherenceCopy } from "../kain-signal-copy";
import { evaluateSignalCopy } from "../kain-signal-guardrail";
import { computeDaysCompleteness } from "../kain-signal-day-completeness";
import type { FoodEntryLite } from "../kain-signal-types";

function proteinEntry(day: string, proteinG: number, calories?: number): FoodEntryLite {
  return {
    logged_at: `${day}T04:00:00Z`,
    calories: calories ?? Math.max(proteinG * 4, 400),
    protein_g: proteinG,
    carbs_g: 0,
    fat_g: 0,
    data_source: "verified_database",
    is_estimate: false,
    confidence: 0.9,
  };
}

function buildDays(dailyGrams: number[], startIndex = 1) {
  const completeDays = dailyGrams.map(
    (_, i) =>
      `2026-0${Math.floor((startIndex + i - 1) / 28) + 7}-${String(((startIndex + i - 1) % 28) + 1).padStart(2, "0")}`,
  );
  const entriesByDay: Record<string, FoodEntryLite[]> = {};
  completeDays.forEach((day, i) => {
    entriesByDay[day] = [proteinEntry(day, dailyGrams[i])];
  });
  return { completeDays, entriesByDay };
}

describe("Case A — the production bug, reconstructed: 2 of 15 days hit a 220g target", () => {
  it("Input: target=220g, 15 qualified days, hit on only 2 -> Expected: NEGATIVE, never positive-habit language", () => {
    // Deliberately not a flat repeat of one number — realistic noisy days,
    // averaging to roughly 65-75% attainment as the spec specifies, with
    // exactly 2 of 15 clearing 220g.
    const dailyGrams = [150, 140, 160, 155, 145, 165, 225, 150, 140, 230, 155, 160, 150, 145, 155];
    expect(dailyGrams.filter((g) => g >= 220).length).toBe(2); // sanity-check the fixture itself
    const { completeDays, entriesByDay } = buildDays(dailyGrams);

    const evidence = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG: 220 });

    // Actual:
    expect(evidence).not.toBeNull();
    expect(evidence!.daysEvaluated).toBe(15);
    expect(evidence!.daysAtOrAboveTarget).toBe(2);
    expect(evidence!.adherenceRate).toBeCloseTo(2 / 15, 5);
    expect(evidence!.direction).toBe("negative");
    expect(["clear", "strong"]).toContain(evidence!.directionTier);

    const content = proteinAdherenceCopy(evidence!);
    const allText = Object.values(content).join(" ").toLowerCase();
    expect(allText).not.toMatch(
      /strongest nutrition pattern|strongest positive pattern|workable habit|strong habit|consistently hitting|consistent success/,
    );
    expect(evaluateSignalCopy(evidence!, content).passes).toBe(true);
  });
});

describe("Case B — near miss: 210/215/205/225/212 against a 220g target", () => {
  it("Input: 5 days [210,215,205,225,212], target=220g -> Expected: positive/near-target, ~97% average attainment emphasized, not framed as failure", () => {
    const dailyGrams = [210, 215, 205, 225, 212];
    const { completeDays, entriesByDay } = buildDays(dailyGrams);

    const evidence = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG: 220 });

    expect(evidence).not.toBeNull();
    expect(evidence!.daysAtOrAboveTarget).toBe(1); // only 225 clears 220 — hit rate alone would look bad
    expect(evidence!.averageAttainmentPct).toBeCloseTo(97.05, 1);
    expect(evidence!.direction).toBe("positive");
    expect(evidence!.directionTier).toBe("strong");
    expect(evidence!.consistency).toBe("low_variance");

    const content = proteinAdherenceCopy(evidence!);
    expect(content.observation).toContain("97%");
    expect(content.headline).not.toMatch(/gap|behind|missed/i);
    expect(evaluateSignalCopy(evidence!, content).passes).toBe(true);
  });
});

describe("Case C — strong success: 8 days averaging 95-105% of a 220g target", () => {
  it("Input: 8 days at 95-105% attainment -> Expected: STRONG POSITIVE", () => {
    const dailyGrams = [209, 220, 231, 215, 225, 210, 228, 218]; // 95%-105% of 220
    const { completeDays, entriesByDay } = buildDays(dailyGrams);

    const evidence = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG: 220 });

    expect(evidence).not.toBeNull();
    expect(evidence!.direction).toBe("positive");
    expect(evidence!.directionTier).toBe("strong");
    expect(evidence!.averageAttainmentPct).toBeGreaterThanOrEqual(95);
    expect(evidence!.consistency).not.toBe("high_variance");

    const content = proteinAdherenceCopy(evidence!);
    expect(content.headline).toBe("Protein is becoming one of your most consistent habits.");
  });
});

describe("Case D — partial logging: 15 calendar days, only 5 truly qualified", () => {
  it("Input: 15 calendar days, 10 with a single trivial snack (<300 kcal), 5 with real meals -> Expected: denominator is 5, not 15", () => {
    const entries: FoodEntryLite[] = [];
    for (let i = 1; i <= 10; i++) {
      const day = `2026-07-${String(i).padStart(2, "0")}`;
      // A tiny snack — below MIN_CALORIES_FOR_COMPLETE_DAY (300 kcal) — must
      // not count as a qualified day, regardless of what it logs for
      // protein, matching the day-completeness module's own contract.
      entries.push(proteinEntry(day, 15, 80));
    }
    for (let i = 11; i <= 15; i++) {
      const day = `2026-07-${String(i).padStart(2, "0")}`;
      entries.push(proteinEntry(day, 180, 900));
    }

    const completeness = computeDaysCompleteness(entries);
    const completeDays = Object.values(completeness)
      .filter((d) => d.isReasonablyComplete)
      .map((d) => d.day);
    expect(completeDays.length).toBe(5); // the 10 trivial-snack days never qualify

    const entriesByDay: Record<string, FoodEntryLite[]> = {};
    for (const e of entries) {
      const day = e.logged_at.slice(0, 10);
      (entriesByDay[day] ??= []).push(e);
    }

    const evidence = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG: 220 });
    expect(evidence).not.toBeNull();
    expect(evidence!.daysEvaluated).toBe(5); // not 15
  });
});

describe("Case E — changing target mid-window (documented architectural limitation)", () => {
  it("the detector normalizes by attainment % against ONE current target, never compares raw grams across a target change — but has no per-day historical target to split on", () => {
    // profiles.target_protein_g is a single current value with no history
    // table (see kain-signal-generate.server.ts's profile query) — the
    // pipeline cannot know a user's target was different 10 days ago. This
    // test documents the current, honest behavior rather than claiming a
    // capability the data model doesn't support: attainment is computed
    // consistently against the one target passed in (never raw grams, so a
    // target change can't produce a nonsensical direct-gram comparison),
    // but a real historical-target split is a genuine gap, flagged in the
    // recalibration report rather than silently left untested.
    const dailyGrams = [140, 145, 150, 210, 215, 220, 225, 218]; // first half near an old ~150g target, second half near a new 220g target
    const { completeDays, entriesByDay } = buildDays(dailyGrams);

    const evidence = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG: 220 });
    expect(evidence).not.toBeNull();
    // Applied uniformly: the early days (genuinely on-target for their own
    // 150g goal at the time) read as a shortfall against today's 220g
    // target — expected given the current data model, not a bug in this
    // detector specifically.
    expect(evidence!.averageAttainmentPct).toBeLessThan(90);
  });
});

describe("Case F — high variance: 90% average attainment, but swinging from 40% to 140%", () => {
  it("Input: days at 40%/140%/etc averaging ~90% of a 220g target -> Expected: never called 'consistent'", () => {
    // Mean of [40,140,40,140,90,140,40,140] % = 771.25/8... let's build grams
    // directly for clarity: alternate low/high around a 220g target.
    const dailyGrams = [88, 308, 88, 308, 198, 308, 88, 308]; // 40%,140%,40%,140%,90%,140%,40%,140%
    const { completeDays, entriesByDay } = buildDays(dailyGrams);

    const evidence = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG: 220 });

    expect(evidence).not.toBeNull();
    expect(evidence!.averageAttainmentPct).toBeGreaterThanOrEqual(85);
    expect(evidence!.consistency).toBe("high_variance");
    // Strong tier requires low/moderate variance even at a high average —
    // high variance caps it at "clear", never "strong".
    expect(evidence!.directionTier).not.toBe("strong");

    const content = proteinAdherenceCopy(evidence!);
    const allText = Object.values(content).join(" ").toLowerCase();
    expect(allText).not.toContain("consistent");
    expect(evaluateSignalCopy(evidence!, content).passes).toBe(true);
  });
});

describe("Case G — repeated negative: 7 qualified days around 60-70% attainment", () => {
  it("Input: 7 days at ~60-70% of a 220g target -> Expected: strong negative signal with a proportionate takeaway", () => {
    const dailyGrams = [140, 150, 145, 135, 155, 148, 142]; // ~62-70% of 220
    const { completeDays, entriesByDay } = buildDays(dailyGrams);

    const evidence = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG: 220 });

    expect(evidence).not.toBeNull();
    expect(evidence!.direction).toBe("negative");
    expect(evidence!.directionTier).toBe("strong");
    expect(evidence!.averageAttainmentPct).toBeLessThan(75);

    const content = proteinAdherenceCopy(evidence!);
    expect(content.headline).toBe("Protein is your clearest nutrition gap right now.");
    // Proportionate: names the actual average shortfall, not a fixed
    // arbitrary serving recommendation.
    const roundedShortfall = Math.round(evidence!.averageShortfallG);
    expect(content.observation).toContain(`${roundedShortfall}g short`);
    expect(evaluateSignalCopy(evidence!, content).passes).toBe(true);
  });
});

describe("Case H — no useful pattern: sparse/noisy data -> silence", () => {
  it("Input: only 3 qualified days (below the 5-day early-signal floor) -> Expected: null (no card), never a forced weak insight", () => {
    const dailyGrams = [180, 90, 250];
    const { completeDays, entriesByDay } = buildDays(dailyGrams);

    const evidence = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG: 220 });
    expect(evidence).toBeNull();
  });

  it("Input: no protein target configured at all -> Expected: null regardless of logging volume", () => {
    const dailyGrams = [150, 160, 140, 155, 165, 148, 152, 158, 145, 162];
    const { completeDays, entriesByDay } = buildDays(dailyGrams);

    const evidence = detectProteinAdherence({ entriesByDay, completeDays, proteinTargetG: null });
    expect(evidence).toBeNull();
  });
});
