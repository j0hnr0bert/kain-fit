import { describe, it, expect } from "vitest";
import { detectLoggingConsistency } from "../kain-signal-detector-logging-consistency";

describe("detectLoggingConsistency", () => {
  it("the worked 60-day-window example: 22 active days -> consistencyRate≈0.367, strong_signal", () => {
    const todayManila = "2026-07-25";
    // The 22 most recent consecutive days ending today.
    const activeDays = Array.from({ length: 22 }, (_, i) => {
      const d = new Date(todayManila + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      return d.toISOString().slice(0, 10);
    });

    const result = detectLoggingConsistency({ activeDays, todayManila, windowDays: 60 });

    expect(result).not.toBeNull();
    expect(result!.windowDays).toBe(60);
    expect(result!.activeDays).toBe(22);
    expect(result!.consistencyRate).toBeCloseTo(22 / 60, 5);
    expect(result!.currentStreak).toBe(22);
    expect(result!.evidenceStrength).toBe("strong_signal");
  });

  it("a concrete date list with a known largest gap: two logging bursts inside a 20-day window", () => {
    const todayManila = "2026-07-20";
    const activeDays = [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ];

    const result = detectLoggingConsistency({ activeDays, todayManila, windowDays: 20 });

    expect(result).not.toBeNull();
    expect(result!.activeDays).toBe(9);
    expect(result!.consistencyRate).toBeCloseTo(9 / 20, 5);
    // Largest inactive run is 07-06..07-14 inclusive = 9 days, between the
    // two bursts — bigger than the 2-day trailing gap (07-19, 07-20).
    expect(result!.longestGapDays).toBe(9);
    // Most recent active day is 07-18, two days before "today" (07-20) —
    // the streak is already broken, so currentStreak is 0.
    expect(result!.currentStreak).toBe(0);
    expect(result!.evidenceStrength).toBe("early_signal");
  });

  it("too few active days for the early-signal floor (6 days, floor is 7) -> null", () => {
    const todayManila = "2026-07-10";
    const activeDays = [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
    ];
    const result = detectLoggingConsistency({ activeDays, todayManila, windowDays: 20 });
    expect(result).toBeNull();
  });

  it("active days outside the lookback window are excluded from the count", () => {
    const todayManila = "2026-07-20";
    const activeDays = [
      "2026-06-01", // well before the 20-day window starts (2026-07-01)
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
    ];
    const result = detectLoggingConsistency({ activeDays, todayManila, windowDays: 20 });
    expect(result).not.toBeNull();
    expect(result!.activeDays).toBe(7); // the 2026-06-01 entry is excluded
  });

  it("duplicate active-day strings are only counted once", () => {
    const todayManila = "2026-07-10";
    const activeDays = [
      "2026-07-01",
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
    ];
    const result = detectLoggingConsistency({ activeDays, todayManila, windowDays: 20 });
    expect(result).not.toBeNull();
    expect(result!.activeDays).toBe(7);
  });
});
