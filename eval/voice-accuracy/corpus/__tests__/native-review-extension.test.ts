import { describe, it, expect } from "vitest";
import { NATIVE_REVIEW_EXTENSION } from "../native-review-extension";
import { GOLDEN_CORPUS } from "../golden-corpus";

describe("NATIVE_REVIEW_EXTENSION", () => {
  it("every record sets needsNativeReview: true", () => {
    for (const r of NATIVE_REVIEW_EXTENSION) {
      expect(r.needsNativeReview).toBe(true);
    }
  });

  it("no Filipino/Taglish record is marked as reviewed", () => {
    const nonEnglish = NATIVE_REVIEW_EXTENSION.filter((r) => r.languageGroup !== "english");
    expect(nonEnglish.length).toBeGreaterThan(0);
    for (const r of nonEnglish) {
      expect(r.needsNativeReview).toBe(true);
    }
  });

  it("no record is in the locked_challenge split — unreviewed text must never gate a release", () => {
    for (const r of NATIVE_REVIEW_EXTENSION) {
      expect(r.testSplit).not.toBe("locked_challenge");
    }
  });

  it("no record is marked isAdversarial — extension records are not part of the locked adversarial set", () => {
    for (const r of NATIVE_REVIEW_EXTENSION) {
      expect(r.isAdversarial).toBe(false);
    }
  });

  it("every record has a non-empty reviewerNotes explaining its provenance", () => {
    for (const r of NATIVE_REVIEW_EXTENSION) {
      expect(r.reviewerNotes.length).toBeGreaterThan(20);
    }
  });

  it("ids do not collide with the locked corpus", () => {
    const lockedIds = new Set(GOLDEN_CORPUS.map((r) => r.id));
    for (const r of NATIVE_REVIEW_EXTENSION) {
      expect(lockedIds.has(r.id)).toBe(false);
    }
  });

  it("ids are unique within the extension itself", () => {
    const ids = NATIVE_REVIEW_EXTENSION.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("locked corpus is untouched — still exactly 120 records, 40/40/40 by language", () => {
    expect(GOLDEN_CORPUS.length).toBe(120);
    expect(GOLDEN_CORPUS.filter((r) => r.languageGroup === "english").length).toBe(40);
    expect(GOLDEN_CORPUS.filter((r) => r.languageGroup === "filipino").length).toBe(40);
    expect(GOLDEN_CORPUS.filter((r) => r.languageGroup === "taglish").length).toBe(40);
  });

  it("no locked corpus record has needsNativeReview set to true", () => {
    for (const r of GOLDEN_CORPUS) {
      expect(r.needsNativeReview).not.toBe(true);
    }
  });
});
