import { describe, it, expect } from "vitest";
import { computeCountGates, finalizeReadiness } from "../kain-signal-readiness";
import type { FoodEntryLite } from "../kain-signal-types";

function entry(day: string, overrides: Partial<FoodEntryLite> = {}): FoodEntryLite {
  return {
    logged_at: `${day}T04:00:00Z`,
    calories: 500,
    protein_g: 30,
    carbs_g: 40,
    fat_g: 15,
    data_source: "verified_database",
    is_estimate: false,
    confidence: 0.9,
    ...overrides,
  };
}

// Builds N distinct-day, fully-verified, plausibly-sized entries — enough
// for both the active-day and reasonably-complete-day gates to pass per
// day, so tests can vary exactly one gate at a time.
function daysOfEntries(n: number, startDay = "2026-06-01"): FoodEntryLite[] {
  const start = new Date(startDay + "T00:00:00Z");
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return entry(d.toISOString().slice(0, 10), { calories: 800 });
  });
}

describe("computeCountGates", () => {
  it("7 active days / 7 qualifying entries / 7 complete days -> gates pass (at the exact minimums)", () => {
    const gates = computeCountGates(daysOfEntries(7));
    expect(gates.activeLoggingDays).toBe(7);
    expect(gates.qualifyingEntries).toBe(7);
    expect(gates.reasonablyCompleteDays).toBe(7);
    // qualifyingEntries=7 < MIN_QUALIFYING_ENTRIES=18, so overall gates are
    // NOT met yet even though active-day and complete-day gates are —
    // this is intentional: each gate is independent.
    expect(gates.countGatesMet).toBe(false);
  });

  it("18 qualifying entries across enough days clears every count gate", () => {
    // 3 entries/day x 6 days = 18 entries, 6 active/complete days — still
    // short of the 7-day minimum, so this exercises the entries gate
    // passing while the day gates fail.
    const entries: FoodEntryLite[] = [];
    for (const day of daysOfEntries(6).map((e) => e.logged_at.slice(0, 10))) {
      entries.push(entry(day), entry(day), entry(day));
    }
    const gates = computeCountGates(entries);
    expect(gates.qualifyingEntries).toBe(18);
    expect(gates.activeLoggingDays).toBe(6);
    expect(gates.countGatesMet).toBe(false);
  });

  it("every gate met simultaneously -> countGatesMet true", () => {
    // 8 days x 3 entries/day = 24 qualifying entries, 8 active days, 8
    // complete days — clears all three minimums (7 / 18 / 5).
    const entries: FoodEntryLite[] = [];
    for (const day of daysOfEntries(8).map((e) => e.logged_at.slice(0, 10))) {
      entries.push(entry(day), entry(day), entry(day));
    }
    const gates = computeCountGates(entries);
    expect(gates.countGatesMet).toBe(true);
    expect(gates.criticalDataQualityFailure).toBe(false);
  });

  it("critical data-quality failure blocks gates even when counts otherwise pass: 15 of 20 entries Low Trust (0.75 > 0.6 ceiling)", () => {
    const entries: FoodEntryLite[] = [];
    const days = daysOfEntries(8).map((e) => e.logged_at.slice(0, 10));
    let lowTrustPlaced = 0;
    for (const day of days) {
      for (let i = 0; i < 3; i++) {
        const isLowTrust = lowTrustPlaced < 15;
        entries.push(entry(day, isLowTrust ? { data_source: "estimated", confidence: 0.2 } : {}));
        if (isLowTrust) lowTrustPlaced += 1;
      }
    }
    const gates = computeCountGates(entries);
    expect(entries.length).toBe(24);
    expect(gates.qualifyingEntries).toBe(9); // 24 - 15
    expect(gates.criticalDataQualityFailure).toBe(true);
    expect(gates.countGatesMet).toBe(false);
  });
});

describe("finalizeReadiness", () => {
  const passingCountGates = {
    activeLoggingDays: 8,
    qualifyingEntries: 24,
    reasonablyCompleteDays: 8,
    countGatesMet: true,
    criticalDataQualityFailure: false,
  };
  const emptyCountGates = {
    activeLoggingDays: 0,
    qualifyingEntries: 0,
    reasonablyCompleteDays: 0,
    countGatesMet: false,
    criticalDataQualityFailure: false,
  };

  it("count gates pass but no detector found a pattern -> hasRepeatedPattern false blocks gatesMet, state stays 'building'", () => {
    const result = finalizeReadiness(passingCountGates, [null, null]);
    expect(result.gatesMet).toBe(false);
    expect(result.state).toBe("building");
  });

  it("count gates pass AND at least one detector found a pattern -> state 'eligible'", () => {
    const result = finalizeReadiness(passingCountGates, [null, "early_signal"]);
    expect(result.gatesMet).toBe(true);
    expect(result.state).toBe("eligible");
    expect(result.progressLabel).toBeNull();
  });

  it("zero activity -> state 'no_data', not 'building'", () => {
    const result = finalizeReadiness(emptyCountGates, [null, null]);
    expect(result.state).toBe("no_data");
    expect(result.compositeScore).toBe(0);
  });

  it("some activity but gates not met -> state 'building' with a categorical progress label, never a raw percentage shown to the user", () => {
    const partial = {
      activeLoggingDays: 2,
      qualifyingEntries: 5,
      reasonablyCompleteDays: 1,
      countGatesMet: false,
      criticalDataQualityFailure: false,
    };
    const result = finalizeReadiness(partial, [null, null]);
    expect(result.state).toBe("building");
    expect(result.progressLabel).toBe("starting");
  });
});
