// Action-calibration regression tests (2026-08-09 recalibration, Task 7).
// Proves generateProteinAction's language actually scales with the measured
// shortfall, per the spec's explicit magnitude bands, rather than reusing
// one fixed sentence regardless of gap size (the bug this module fixes).

import { describe, it, expect } from "vitest";
import { generateProteinAction } from "../kain-signal-protein-action";

describe("generateProteinAction — magnitude calibration", () => {
  it("5g shortfall -> a small top-up, never two large/huge servings", () => {
    const text = generateProteinAction(5).toLowerCase();
    expect(text).toContain("5g");
    expect(text).not.toMatch(/two (large|huge|substantial) (protein )?serv/);
    expect(text).not.toMatch(/structural|meal-level change/);
  });

  it("15g shortfall -> a single modest addition, names the quantity", () => {
    const text = generateProteinAction(15).toLowerCase();
    expect(text).toContain("15g");
    expect(text).not.toMatch(/structural|meal-level change/);
  });

  it("30g shortfall -> one substantial addition or split across two meals, names the quantity", () => {
    const text = generateProteinAction(30).toLowerCase();
    expect(text).toContain("30g");
    expect(text).toMatch(/two meals|substantial/);
  });

  it("58g shortfall -> proportional two-meal split language, never framed as small/modest/a little", () => {
    const text = generateProteinAction(58).toLowerCase();
    expect(text).not.toMatch(
      /small adjustment|modest top-?up|just add a little|somewhere in your day/,
    );
    expect(text).toContain("two meals");
    // Rounds to a 25-30g per-meal split for a 58g total shortfall.
    expect(text).toMatch(/25-30g|25–30g/);
  });

  it("90g shortfall -> structural, meal-level change language, not a single small addition", () => {
    const text = generateProteinAction(90).toLowerCase();
    expect(text).toMatch(/meal level|meal-level|structural/);
    expect(text).not.toMatch(/small top-?up|modest addition|somewhere in your day/);
  });

  it("boundary: exactly at the small/modest band edge (10g vs 11g) produces different-shaped language", () => {
    const small = generateProteinAction(10);
    const modest = generateProteinAction(11);
    expect(small).not.toEqual(modest);
    expect(small.toLowerCase()).toContain("somewhere in your day");
    expect(modest.toLowerCase()).toContain("single modest addition");
  });

  it("boundary: exactly at the large/structural band edge (70g vs 71g) produces different-shaped language", () => {
    const large = generateProteinAction(70);
    const structural = generateProteinAction(71);
    expect(large.toLowerCase()).toContain("two meals");
    expect(structural.toLowerCase()).toMatch(/meal level|meal-level/);
  });

  it("a zero or negative shortfall (already at or above target) does not recommend adding protein", () => {
    expect(generateProteinAction(0).toLowerCase()).not.toMatch(/add|try/);
    expect(generateProteinAction(-10).toLowerCase()).not.toMatch(/add|try/);
  });
});
