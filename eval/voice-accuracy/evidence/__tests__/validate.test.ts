import { describe, it, expect } from "vitest";
import { validateEvidenceRecord, validateEvidenceSession } from "../validate";
import { newEmptyEvidenceRecord } from "../types";

function validRecord() {
  return {
    ...newEmptyEvidenceRecord("2026-07-26-session-1", "tester-01"),
    consentGiven: true,
    device: "iPhone 14",
    os: "iOS",
    osVersion: "18.1",
    browser: "Safari",
    languageGroup: "filipino",
    scripted: true,
    corpusRecordId: "fil-01",
    intendedPhrase: "Dalawang itlog at isang tasang kanin.",
    rawTranscript: "Dalawang itlog at isang tasang kanin.",
    finalStatus: "success",
  };
}

describe("validateEvidenceRecord", () => {
  it("accepts a well-formed scripted record", () => {
    const result = validateEvidenceRecord(validRecord());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a well-formed unscripted record with corpusRecordId null", () => {
    const r = { ...validRecord(), scripted: false, corpusRecordId: null, intendedPhrase: null };
    expect(validateEvidenceRecord(r).valid).toBe(true);
  });

  it("rejects a record with consentGiven not explicitly true", () => {
    const r = { ...validRecord(), consentGiven: false };
    const result = validateEvidenceRecord(r);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "consentGiven")).toBe(true);
  });

  it("rejects scripted:true with no corpusRecordId", () => {
    const r = { ...validRecord(), scripted: true, corpusRecordId: null };
    const result = validateEvidenceRecord(r);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "corpusRecordId")).toBe(true);
  });

  it("rejects scripted:false with a non-null corpusRecordId", () => {
    const r = { ...validRecord(), scripted: false, corpusRecordId: "fil-01" };
    const result = validateEvidenceRecord(r);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "corpusRecordId")).toBe(true);
  });

  it("rejects an invalid os/browser/languageGroup/finalStatus value", () => {
    for (const bad of [
      { os: "Linux" },
      { browser: "Firefox" },
      { languageGroup: "spanish" },
      { finalStatus: "maybe" },
    ]) {
      const result = validateEvidenceRecord({ ...validRecord(), ...bad });
      expect(result.valid).toBe(false);
    }
  });

  it("flags a testerAlias that looks like a real first+last name", () => {
    const r = { ...validRecord(), testerAlias: "Maria Santos" };
    const result = validateEvidenceRecord(r);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "testerAlias")).toBe(true);
  });

  it("accepts a plain alias like tester-01", () => {
    const r = { ...validRecord(), testerAlias: "tester-01" };
    expect(validateEvidenceRecord(r).valid).toBe(true);
  });

  it("rejects a record containing an audio or secret field, even alongside otherwise-valid data", () => {
    for (const field of ["audio", "audioBlob", "audioBase64", "apiKey", "authToken", "password"]) {
      const r = { ...validRecord(), [field]: "should never be here" };
      const result = validateEvidenceRecord(r);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === field)).toBe(true);
    }
  });

  it("rejects a non-object input", () => {
    expect(validateEvidenceRecord(null).valid).toBe(false);
    expect(validateEvidenceRecord("not an object").valid).toBe(false);
    expect(validateEvidenceRecord(42).valid).toBe(false);
  });

  it("rejects an invalid recordedAt timestamp", () => {
    const r = { ...validRecord(), recordedAt: "not a date" };
    expect(validateEvidenceRecord(r).valid).toBe(false);
  });

  it("requires all seven boolean error flags", () => {
    const r = { ...validRecord(), foodNameError: "yes" };
    const result = validateEvidenceRecord(r);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "foodNameError")).toBe(true);
  });
});

describe("validateEvidenceSession", () => {
  it("validates an array of records and prefixes errors with the index", () => {
    const good = validRecord();
    const bad = { ...validRecord(), consentGiven: false };
    const result = validateEvidenceSession([good, bad]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "[1].consentGiven")).toBe(true);
    expect(result.errors.some((e) => e.field.startsWith("[0]"))).toBe(false);
  });

  it("passes an all-valid session", () => {
    const result = validateEvidenceSession([validRecord(), validRecord()]);
    expect(result.valid).toBe(true);
  });
});

describe("newEmptyEvidenceRecord", () => {
  it("produces a record that fails validation until consent and required fields are filled in", () => {
    const empty = newEmptyEvidenceRecord("s1", "tester-01");
    expect(validateEvidenceRecord(empty).valid).toBe(false);
  });

  it("never includes an audio field by construction", () => {
    const empty = newEmptyEvidenceRecord("s1", "tester-01");
    expect(empty).not.toHaveProperty("audio");
    expect(empty).not.toHaveProperty("audioBlob");
  });
});
