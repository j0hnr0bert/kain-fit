import { describe, it, expect } from "vitest";
import { classifyEntryConfidence } from "../kain-signal-confidence";

function base(overrides: Partial<Parameters<typeof classifyEntryConfidence>[0]> = {}) {
  return {
    data_source: "verified_database",
    is_estimate: false,
    confidence: 0.95,
    ...overrides,
  };
}

describe("classifyEntryConfidence", () => {
  it("verified_database + confirmed portion + high confidence -> verified", () => {
    expect(classifyEntryConfidence(base())).toBe("verified");
  });

  it("verified_database + estimated portion -> provisional (matched food, inferred prep)", () => {
    expect(classifyEntryConfidence(base({ is_estimate: true, confidence: 0.8 }))).toBe(
      "provisional",
    );
  });

  it("recipe_based / user_confirmed -> provisional", () => {
    expect(classifyEntryConfidence(base({ data_source: "recipe_based", confidence: 0.7 }))).toBe(
      "provisional",
    );
    expect(classifyEntryConfidence(base({ data_source: "user_confirmed", confidence: 0.7 }))).toBe(
      "provisional",
    );
  });

  it("data_source='estimated' -> low_trust regardless of confidence", () => {
    expect(
      classifyEntryConfidence(
        base({ data_source: "estimated", is_estimate: true, confidence: 0.4 }),
      ),
    ).toBe("low_trust");
    expect(classifyEntryConfidence(base({ data_source: "estimated", confidence: 0.9 }))).toBe(
      "low_trust",
    );
  });

  it("confidence below the low-trust ceiling -> low_trust even from a normally-trusted source", () => {
    expect(classifyEntryConfidence(base({ confidence: 0.49 }))).toBe("low_trust");
  });

  it("confidence exactly at the boundary (0.5) is NOT low_trust — only strictly below is", () => {
    expect(classifyEntryConfidence(base({ confidence: 0.5 }))).toBe("verified");
  });

  it("null confidence never triggers the low-confidence rule on its own", () => {
    expect(classifyEntryConfidence(base({ confidence: null }))).toBe("verified");
    expect(classifyEntryConfidence(base({ data_source: "recipe_based", confidence: null }))).toBe(
      "provisional",
    );
  });
});
