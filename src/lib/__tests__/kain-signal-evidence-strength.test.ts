import { describe, it, expect } from "vitest";
import { classifyEvidenceStrength } from "../kain-signal-evidence-strength";

describe("classifyEvidenceStrength — protein_adherence (early=5, clear=8, strong=14)", () => {
  it("below the early floor -> null", () => {
    expect(classifyEvidenceStrength("protein_adherence", 4)).toBeNull();
  });
  it("exactly at early -> early_signal", () => {
    expect(classifyEvidenceStrength("protein_adherence", 5)).toBe("early_signal");
  });
  it("just below clear -> still early_signal", () => {
    expect(classifyEvidenceStrength("protein_adherence", 7)).toBe("early_signal");
  });
  it("exactly at clear -> clear_signal", () => {
    expect(classifyEvidenceStrength("protein_adherence", 8)).toBe("clear_signal");
  });
  it("just below strong -> still clear_signal", () => {
    expect(classifyEvidenceStrength("protein_adherence", 13)).toBe("clear_signal");
  });
  it("exactly at strong -> strong_signal", () => {
    expect(classifyEvidenceStrength("protein_adherence", 14)).toBe("strong_signal");
  });
});

describe("classifyEvidenceStrength — logging_consistency (early=7, clear=14, strong=21)", () => {
  it("below the early floor -> null", () => {
    expect(classifyEvidenceStrength("logging_consistency", 6)).toBeNull();
  });
  it("exactly at early -> early_signal", () => {
    expect(classifyEvidenceStrength("logging_consistency", 7)).toBe("early_signal");
  });
  it("exactly at clear -> clear_signal", () => {
    expect(classifyEvidenceStrength("logging_consistency", 14)).toBe("clear_signal");
  });
  it("exactly at strong -> strong_signal", () => {
    expect(classifyEvidenceStrength("logging_consistency", 21)).toBe("strong_signal");
  });
  it("the two insight types have independent threshold bands — sample size 8 is clear_signal for protein but only early_signal for logging", () => {
    expect(classifyEvidenceStrength("protein_adherence", 8)).toBe("clear_signal");
    expect(classifyEvidenceStrength("logging_consistency", 8)).toBe("early_signal");
  });
});
