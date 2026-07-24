// Regression coverage for two production layout defects fixed 2026-07-25:
// the Founder dashboard's header colliding with the iPhone status bar, and
// the QuickLog rail's fourth chip reading as accidentally clipped. Neither
// defect is meaningfully testable at the unit level (they're rendering/
// visual facts) — these tests only guard the specific source patterns that
// caused each one, by reading the actual files, matching the project's
// existing light-mode-only.test.ts convention. Screenshots are the real
// evidence for the fix itself; see the QA harness and the final report.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "..");

describe("Founder dashboard safe-area regression", () => {
  it("admin/beta's header container applies the project's safe-area-inset-top pattern", () => {
    const src = readFileSync(join(SRC_ROOT, "routes", "_authenticated", "admin.beta.tsx"), "utf-8");
    expect(src).toMatch(/paddingTop:\s*"calc\(env\(safe-area-inset-top\)/);
  });

  it("uses the same inline-style pattern already established on other authenticated pages, not a new one-off approach", () => {
    const pagesWithSafeArea = [
      "today.tsx",
      "profile.tsx",
      "history.tsx",
      "scale-guide.tsx",
      "admin.beta.tsx",
    ];
    for (const file of pagesWithSafeArea) {
      const src = readFileSync(join(SRC_ROOT, "routes", "_authenticated", file), "utf-8");
      expect(src, file).toMatch(/paddingTop:\s*"calc\(env\(safe-area-inset-top\)\s*\+/);
    }
  });

  it("admin/beta no longer uses a bare pt-6 on its header container (the un-safe-area'd original)", () => {
    const src = readFileSync(join(SRC_ROOT, "routes", "_authenticated", "admin.beta.tsx"), "utf-8");
    expect(src).not.toMatch(/max-w-3xl mx-auto px-5 pt-6/);
  });
});

describe("QuickLog rail clipping regression", () => {
  const src = () => readFileSync(join(SRC_ROOT, "components", "QuickLogRail.tsx"), "utf-8");

  it("the 'Save as meal' chip no longer uses a dashed border (read as broken/placeholder, not a genuine secondary action)", () => {
    expect(src()).not.toMatch(/border-dashed/);
  });

  it("the rail label is not the long form that clipped to a meaningless fragment in production", () => {
    // The reported defect showed "+ Sa…" — a fragment of "Save today as
    // meal" cut mid-word. The shorter label reduces how much content has
    // to fit before any scrolling is needed.
    expect(src()).toContain('label="Save as meal"');
    expect(src()).not.toContain('label="Save today as meal"');
  });

  it("the scroll container has trailing padding so the last chip does not sit flush with the viewport edge", () => {
    expect(src()).toMatch(/overflow-x-auto no-scrollbar px-1 -mx-1 pr-5/);
  });

  it("every rail chip is shrink-0, so a chip's own label is never CSS-truncated into a fragment", () => {
    expect(src()).toMatch(/shrink-0 flex items-center gap-1\.5/);
  });
});
