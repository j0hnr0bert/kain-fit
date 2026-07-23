// KainFit is light-mode-only (locked product decision, 2026-07-23). There is
// no theme-provider/context/hook in this codebase to unit-test directly —
// dark mode's entire reach was a `.dark` CSS variable block nothing ever
// applied, plus a `prefers-color-scheme: dark` branch in the pre-hydration
// boot splash. These tests prove structural absence by reading the actual
// source files, which is the correct regression coverage for "this can
// never happen" claims that have no runtime object to assert against.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", ".."); // src/lib/__tests__ -> src

// Excludes __tests__ directories — otherwise this file (and any other test
// asserting these patterns' absence) would match its own detection regexes
// and report a false positive against itself.
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("light-mode-only: dark mode cannot activate anywhere in the app", () => {
  it("styles.css defines no .dark class block — there is no dark palette to switch to", () => {
    const css = readFileSync(join(SRC_ROOT, "styles.css"), "utf-8");
    expect(css).not.toMatch(/\.dark\s*\{/);
  });

  it("styles.css registers no dark custom-variant — dark: utilities cannot be generated", () => {
    const css = readFileSync(join(SRC_ROOT, "styles.css"), "utf-8");
    expect(css).not.toMatch(/@custom-variant\s+dark/);
  });

  it("no dark: Tailwind utility class exists anywhere in the app source", () => {
    const files = listSourceFiles(SRC_ROOT).filter((f) => /\.(ts|tsx)$/.test(f));
    const offenders = files.filter((f) => /\bdark:/.test(readFileSync(f, "utf-8")));
    expect(offenders).toEqual([]);
  });

  it("the boot splash has no prefers-color-scheme media query — first paint is always light", () => {
    const root = readFileSync(join(SRC_ROOT, "routes", "__root.tsx"), "utf-8");
    // Matches actual CSS usage, not prose (e.g. an explanatory comment)
    // mentioning the term.
    expect(root).not.toMatch(/@media\s*\(\s*prefers-color-scheme/);
  });

  it("the app declares color-scheme: light so the browser never applies dark UA styling", () => {
    const root = readFileSync(join(SRC_ROOT, "routes", "__root.tsx"), "utf-8");
    expect(root).toMatch(/name:\s*"color-scheme",\s*content:\s*"light"/);
  });

  it("no localStorage theme/dark-mode key is read or restored anywhere", () => {
    const files = listSourceFiles(SRC_ROOT).filter((f) => /\.(ts|tsx)$/.test(f));
    const offenders = files.filter((f) => {
      const content = readFileSync(f, "utf-8");
      return /localStorage[^\n]*\b(theme|dark)\b/i.test(content);
    });
    expect(offenders).toEqual([]);
  });
});
