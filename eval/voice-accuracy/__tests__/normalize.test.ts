import { describe, it, expect } from "vitest";
import { normalizeTranscript, tokenize } from "../scoring/normalize";

describe("normalizeTranscript — safe simplifications", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeTranscript("Chicken Breast, Grilled.")).toBe("chicken breast grilled");
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeTranscript("chicken   breast    grilled")).toBe("chicken breast grilled");
  });

  it("converts standalone English number words to digits", () => {
    expect(normalizeTranscript("fifteen grams peanut butter")).toBe("15 g peanut butter");
    expect(normalizeTranscript("fifty grams peanut butter")).toBe("50 g peanut butter");
  });

  it("converts compound English number phrases correctly (not word-by-word)", () => {
    expect(normalizeTranscript("two hundred grams chicken breast")).toBe("200 g chicken breast");
    expect(normalizeTranscript("three hundred grams chicken breast")).toBe("300 g chicken breast");
    expect(normalizeTranscript("one hundred fifty grams pork")).toBe("150 g pork");
    expect(normalizeTranscript("one and a half cups of rice")).toBe("1.5 cup of rice");
  });

  it("converts Filipino number words and compound phrases correctly", () => {
    expect(normalizeTranscript("dalawang itlog")).toBe("2 itlog");
    expect(normalizeTranscript("labinlimang gramo ng peanut butter")).toBe("15 g ng peanut butter");
    expect(normalizeTranscript("dalawang daang gramo ng dibdib ng manok")).toBe(
      "200 g ng dibdib ng manok",
    );
    expect(normalizeTranscript("kalahating tasa ng kanin")).toBe("0.5 cup ng kanin");
  });

  it("maps accepted unit abbreviations without changing the unit", () => {
    expect(normalizeTranscript("200 grams")).toBe("200 g");
    expect(normalizeTranscript("200 gramo")).toBe("200 g");
    expect(normalizeTranscript("one tablespoon")).toBe("1 tbsp");
    expect(normalizeTranscript("isang kutsara")).toBe("1 tbsp");
    expect(normalizeTranscript("isang kutsarita")).toBe("1 tsp");
  });
});

describe("normalizeTranscript — must NOT erase meaning-changing differences", () => {
  it("never collapses a critical adversarial pair to the same normalized string", () => {
    const pairs: Array<[string, string]> = [
      ["fifteen grams peanut butter", "fifty grams peanut butter"],
      ["two hundred grams chicken breast", "three hundred grams chicken breast"],
      ["two eggs", "three eggs"],
      ["half a cup of rice", "one and a half cups of rice"],
      ["two hundred grams raw chicken breast", "two hundred grams cooked chicken breast"],
      ["skinless chicken thigh", "skin-on chicken thigh"],
      ["tuna packed in water", "tuna packed in oil"],
      ["one scoop whey protein", "two scoops whey protein"],
      ["chicken breast with rice", "chicken breast no rice"],
      ["two hundred grams chicken breast", "two hundred grams chicken thigh"],
      ["one tablespoon olive oil", "one teaspoon olive oil"],
      ["lean beef", "regular beef, not lean"],
      ["two hundred grams grilled bangus", "two hundred grams fried bangus"],
      ["three whole eggs", "three egg whites"],
      ["add rice", "don't add rice"],
    ];
    for (const [a, b] of pairs) {
      expect(normalizeTranscript(a)).not.toBe(normalizeTranscript(b));
    }
  });

  it("keeps tablespoon and teaspoon as distinct units after normalization", () => {
    expect(normalizeTranscript("one tablespoon")).not.toBe(normalizeTranscript("one teaspoon"));
  });

  it("keeps negation words present after normalization", () => {
    const normalized = normalizeTranscript("chicken breast, no rice.");
    expect(normalized).toContain("no");
  });

  it("preserves both sides of a spoken correction (does not delete the earlier value)", () => {
    const normalized = normalizeTranscript("two eggs, actually make that three.");
    expect(normalized).toContain("2");
    expect(normalized).toContain("3");
  });
});

describe("tokenize", () => {
  it("splits normalized text on single spaces", () => {
    expect(tokenize("200 g chicken breast")).toEqual(["200", "g", "chicken", "breast"]);
  });

  it("returns an empty array for an empty string, never a single empty-string token", () => {
    expect(tokenize("")).toEqual([]);
  });
});
