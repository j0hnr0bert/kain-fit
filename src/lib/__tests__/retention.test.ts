import { describe, it, expect } from "vitest";
import { manilaDay, addDaysISO, computeRetention, computeCurrentStreak } from "../retention";

describe("manilaDay boundary (UTC+8)", () => {
  it("15:59Z is still previous Manila day (23:59)", () => {
    expect(manilaDay("2026-07-20T15:59:00Z")).toBe("2026-07-20");
  });
  it("16:00Z crosses into next Manila day (00:00)", () => {
    expect(manilaDay("2026-07-20T16:00:00Z")).toBe("2026-07-21");
  });
  it("midnight UTC is 08:00 Manila same UTC date", () => {
    expect(manilaDay("2026-07-20T00:00:00Z")).toBe("2026-07-20");
  });
});

// Helper: signup timestamp such that Manila day is `day` at 09:00 Manila (01:00Z).
function signupAt(day: string, id: string) {
  return { user_id: id, created_at: `${day}T01:00:00Z` };
}
function entryOn(day: string, id: string) {
  // 12:00 Manila (04:00Z) — safely inside the calendar day
  return { user_id: id, logged_at: `${day}T04:00:00Z` };
}

describe("computeRetention", () => {
  // "now" is far in the future so all cohorts below are mature.
  const now = new Date("2026-09-01T00:00:00Z");

  it("exact D1: active on signup+1 counts, active on +2 does not", () => {
    const signup = "2026-08-01";
    const s = [signupAt(signup, "u1"), signupAt(signup, "u2")];
    const e = [
      entryOn(addDaysISO(signup, 1), "u1"), // exact D1
      entryOn(addDaysISO(signup, 2), "u2"), // not D1
    ];
    const r = computeRetention(s, e, now);
    expect(r.overall.matureD1).toBe(2);
    expect(r.overall.d1).toBe(1);
  });

  it("exact D7 vs rolling 7-day return", () => {
    const signup = "2026-08-01";
    const s = [
      signupAt(signup, "exact7"),
      signupAt(signup, "onlyDay3"),
      signupAt(signup, "inactive"),
    ];
    const e = [
      entryOn(addDaysISO(signup, 7), "exact7"),
      entryOn(addDaysISO(signup, 3), "onlyDay3"),
    ];
    const r = computeRetention(s, e, now);
    expect(r.overall.matureD7).toBe(3);
    expect(r.overall.d7Exact).toBe(1); // exact7 only
    expect(r.overall.d7Return).toBe(2); // exact7 + onlyDay3
  });

  it("inactive users contribute to denominator, not numerator", () => {
    const s = [signupAt("2026-08-01", "ghost")];
    const r = computeRetention(s, [], now);
    expect(r.overall.users).toBe(1);
    expect(r.overall.activated).toBe(0);
    expect(r.overall.d1).toBe(0);
    expect(r.overall.d7Exact).toBe(0);
    expect(r.overall.d7Return).toBe(0);
    expect(r.overall.matureD1).toBe(1);
    expect(r.overall.matureD7).toBe(1);
  });

  it("immature cohorts are excluded from denominators", () => {
    // "now" = 2026-08-05 Manila. Signup 2026-08-04 → D1 window (day +1 = 08-05)
    // is not fully elapsed yet, and D7 window is far from mature.
    const s = [signupAt("2026-08-04", "fresh")];
    const r = computeRetention(s, [], new Date("2026-08-05T02:00:00Z"));
    expect(r.overall.users).toBe(1);
    expect(r.overall.matureD1).toBe(0);
    expect(r.overall.matureD7).toBe(0);
    expect(r.overall.d1Rate).toBe(0);
    expect(r.overall.d7ExactRate).toBe(0);
    expect(r.overall.d7ReturnRate).toBe(0);
  });

  it("D1 becomes mature only after signup+1 has fully elapsed (i.e. once signup+2 begins)", () => {
    // Signup 2026-08-01 Manila. D1 = 08-02. It is fully elapsed once 08-03 Manila begins
    // (16:00Z on 08-02).
    const s = [signupAt("2026-08-01", "u")];
    const beforeMature = new Date("2026-08-02T15:59:00Z"); // still 08-02 Manila
    const justMature = new Date("2026-08-02T16:00:00Z"); // 08-03 Manila 00:00
    expect(computeRetention(s, [], beforeMature).overall.matureD1).toBe(0);
    expect(computeRetention(s, [], justMature).overall.matureD1).toBe(1);
  });

  it("activation requires an entry on the signup Manila day", () => {
    const signup = "2026-08-01";
    const s = [signupAt(signup, "sameDay"), signupAt(signup, "nextDay")];
    const e = [entryOn(signup, "sameDay"), entryOn(addDaysISO(signup, 1), "nextDay")];
    const r = computeRetention(s, e, now);
    expect(r.overall.activated).toBe(1);
  });
});

describe("computeCurrentStreak", () => {
  const today = "2026-08-10";

  it("is 0 with no active days", () => {
    expect(computeCurrentStreak([], today)).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    const days = [today, addDaysISO(today, -1), addDaysISO(today, -2)];
    expect(computeCurrentStreak(days, today)).toBe(3);
  });

  it("stays alive if today has no entry yet but yesterday does", () => {
    const days = [addDaysISO(today, -1), addDaysISO(today, -2)];
    expect(computeCurrentStreak(days, today)).toBe(2);
  });

  it("breaks on a gap even if today is active", () => {
    // active on today and 3 days ago, but not yesterday or 2 days ago
    const days = [today, addDaysISO(today, -3)];
    expect(computeCurrentStreak(days, today)).toBe(1);
  });

  it("is 0 if the most recent active day was more than 1 day ago", () => {
    const days = [addDaysISO(today, -2)];
    expect(computeCurrentStreak(days, today)).toBe(0);
  });

  it("ignores duplicate day entries and unrelated far-past days", () => {
    const days = [today, today, addDaysISO(today, -1), addDaysISO(today, -1), "2020-01-01"];
    expect(computeCurrentStreak(days, today)).toBe(2);
  });
});
