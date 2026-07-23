// Ring identity colors are hand-picked oklch values in styles.css, not
// computed at runtime — there is no color-math module to unit-test
// directly. These tests read the actual source values (the same
// read-the-real-file pattern light-mode-only.test.ts uses) so the hue
// separation this design relies on can't silently regress if someone
// nudges a token later without re-checking distinguishability by eye.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES_PATH = join(HERE, "..", "..", "styles.css");

function readHue(css: string, token: string): number {
  const re = new RegExp(`--${token}:\\s*oklch\\(([^)]+)\\)`);
  const match = css.match(re);
  if (!match) throw new Error(`token --${token} not found in styles.css`);
  const parts = match[1].trim().split(/\s+/);
  const hue = Number(parts[2]);
  if (!Number.isFinite(hue)) throw new Error(`--${token} has no numeric hue component`);
  return hue;
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

describe("ring identity colors stay distinguishable", () => {
  const css = readFileSync(STYLES_PATH, "utf-8");

  it("all four in-progress ring tokens exist with a numeric hue", () => {
    for (const token of ["ring-protein", "ring-calories", "ring-carbs", "ring-fat"]) {
      expect(Number.isFinite(readHue(css, token))).toBe(true);
    }
  });

  it("every pair of the four in-progress ring hues is at least 40 degrees apart", () => {
    const tokens = ["ring-protein", "ring-calories", "ring-carbs", "ring-fat"];
    const hues = tokens.map((t) => readHue(css, t));
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const dist = hueDistance(hues[i], hues[j]);
        expect(dist, `${tokens[i]} vs ${tokens[j]}`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("the completed-calorie gold is a distinct hue from protein — a gold ring never reads as 'more protein'", () => {
    const gold = readHue(css, "ring-calories-complete");
    const protein = readHue(css, "ring-protein");
    expect(hueDistance(gold, protein)).toBeGreaterThanOrEqual(40);
  });

  it("the completed-calorie gold is a distinct hue from the in-progress calorie color — the transition is visible, not a shade tweak", () => {
    const gold = readHue(css, "ring-calories-complete");
    const inProgress = readHue(css, "ring-calories");
    expect(hueDistance(gold, inProgress)).toBeGreaterThanOrEqual(15);
  });

  it("gold is not reused for any other ring identity color", () => {
    const gold = readHue(css, "ring-calories-complete");
    for (const token of ["ring-protein", "ring-carbs", "ring-fat"]) {
      expect(hueDistance(gold, readHue(css, token))).toBeGreaterThanOrEqual(15);
    }
  });
});
