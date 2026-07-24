import { describe, it, expect } from "vitest";
import { GOLDEN_CORPUS } from "../corpus/golden-corpus";
import { validateCorpus } from "../corpus/validate";
import { ADVERSARIAL_PAIRS } from "../corpus/adversarial-pairs";
import type { CorpusRecord } from "../corpus/types";

describe("golden corpus — schema validation", () => {
  it("the real corpus passes validation with zero errors", () => {
    const result = validateCorpus(GOLDEN_CORPUS);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an empty dataset", () => {
    const result = validateCorpus([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("empty_corpus");
  });

  it("rejects duplicate IDs", () => {
    const dup = [GOLDEN_CORPUS[0], { ...GOLDEN_CORPUS[1], id: GOLDEN_CORPUS[0].id }];
    const result = validateCorpus(dup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "duplicate_id")).toBe(true);
  });

  it("rejects a corpus missing an entire language group", () => {
    const englishOnly = GOLDEN_CORPUS.filter((r) => r.languageGroup === "english");
    const result = validateCorpus(englishOnly);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "missing_language_group")).toBe(true);
  });

  it("rejects a corpus missing an entire test split", () => {
    const noLocked = GOLDEN_CORPUS.filter((r) => r.testSplit !== "locked_challenge");
    const result = validateCorpus(noLocked);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "missing_split")).toBe(true);
  });

  it("rejects a malformed record shape", () => {
    const broken = [{ ...GOLDEN_CORPUS[0], intendedTranscript: "" }] as CorpusRecord[];
    const result = validateCorpus(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "invalid_record_shape")).toBe(true);
  });

  it("rejects an adversarial pair split across two different test splits", () => {
    const modified = GOLDEN_CORPUS.map((r) =>
      r.id === "en-adv-01b" ? { ...r, testSplit: "locked_challenge" as const } : r,
    );
    const result = validateCorpus(modified);
    expect(result.errors.some((e) => e.code === "adversarial_pair_split_mismatch")).toBe(true);
  });

  it("rejects an adversarial pair whose normalized transcripts collapse to the same string", () => {
    const modified = GOLDEN_CORPUS.map((r) =>
      r.id === "en-adv-01b"
        ? {
            ...r,
            normalizedReferenceTranscript: GOLDEN_CORPUS.find((x) => x.id === "en-adv-01a")!
              .normalizedReferenceTranscript,
          }
        : r,
    );
    const result = validateCorpus(modified);
    expect(result.errors.some((e) => e.code === "adversarial_pair_collapsed")).toBe(true);
  });
});

describe("golden corpus — counts and balance (Part 2/3/4)", () => {
  it("contains at least 120 unique utterances", () => {
    expect(GOLDEN_CORPUS.length).toBeGreaterThanOrEqual(120);
  });

  it("has exactly 40 utterances per language group — no group is easier by having fewer/more examples", () => {
    for (const lang of ["english", "filipino", "taglish"]) {
      expect(GOLDEN_CORPUS.filter((r) => r.languageGroup === lang).length).toBe(40);
    }
  });

  it("uses the three fixed splits summing to the full corpus, at exactly 60/30/30", () => {
    const dev = GOLDEN_CORPUS.filter((r) => r.testSplit === "development").length;
    const val = GOLDEN_CORPUS.filter((r) => r.testSplit === "validation").length;
    const locked = GOLDEN_CORPUS.filter((r) => r.testSplit === "locked_challenge").length;
    expect(dev).toBe(60);
    expect(val).toBe(30);
    expect(locked).toBe(30);
    expect(dev + val + locked).toBe(GOLDEN_CORPUS.length);
  });

  it("has at least 30 adversarial pairs", () => {
    expect(ADVERSARIAL_PAIRS.length).toBeGreaterThanOrEqual(30);
  });

  it("every adversarial pair has two distinct member records in the same language and same split", () => {
    for (const pair of ADVERSARIAL_PAIRS) {
      const a = GOLDEN_CORPUS.find((r) => r.id === pair.recordIdA);
      const b = GOLDEN_CORPUS.find((r) => r.id === pair.recordIdB);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(a!.id).not.toBe(b!.id);
      expect(a!.languageGroup).toBe(b!.languageGroup);
      expect(a!.testSplit).toBe(b!.testSplit);
    }
  });

  it("ground truth never invents a quantity the speaker did not state (honesty check)", () => {
    const rangeRecord = GOLDEN_CORPUS.find((r) => r.id === "en-18");
    expect(rangeRecord).toBeDefined();
    expect(rangeRecord!.expected.foods[0].quantity).toBeNull();
  });

  it("mixed-dish records never fabricate ingredient-level foods that weren't spoken", () => {
    const sinigang = GOLDEN_CORPUS.find((r) => r.id === "fil-03");
    expect(sinigang).toBeDefined();
    expect(sinigang!.expected.foods).toHaveLength(1);
    expect(sinigang!.expected.foods[0].food).toBe("pork sinigang");
  });
});

describe("golden corpus — locked challenge set protection", () => {
  it("the locked_challenge split is composed entirely of adversarial records", () => {
    const locked = GOLDEN_CORPUS.filter((r) => r.testSplit === "locked_challenge");
    expect(locked.every((r) => r.isAdversarial)).toBe(true);
  });

  it("development and validation splits are disjoint from locked_challenge by construction (no shared IDs)", () => {
    const lockedIds = new Set(
      GOLDEN_CORPUS.filter((r) => r.testSplit === "locked_challenge").map((r) => r.id),
    );
    const otherIds = GOLDEN_CORPUS.filter((r) => r.testSplit !== "locked_challenge").map(
      (r) => r.id,
    );
    for (const id of otherIds) {
      expect(lockedIds.has(id)).toBe(false);
    }
  });
});
