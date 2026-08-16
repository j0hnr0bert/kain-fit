// KainFit 1.0 guard: KainSignal was removed from the product (no cards, no
// generation, no server functions, no client queries). This test fails if
// any of it comes back into the app source, so a future change can't
// silently reintroduce automatic insight generation, DB writes, or AI calls.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const SOURCE_FILES = walk("src").filter(
  (f) =>
    /\.(ts|tsx)$/.test(f) &&
    !f.endsWith("routeTree.gen.ts") &&
    !f.includes("integrations/supabase/types.ts") &&
    !f.includes("kainsignal-removed.test.ts"),
);

describe("KainSignal removal", () => {
  it("has no KainSignal modules or components left in src", () => {
    const offenders = SOURCE_FILES.filter((f) => /kain-?signal/i.test(f));
    expect(offenders).toEqual([]);
  });

  it("has no runtime references to KainSignal generation or queries", () => {
    const offenders = SOURCE_FILES.filter((f) => /kain[-_]?signal/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
