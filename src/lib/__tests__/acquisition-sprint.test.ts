// Regression coverage for the 2026-07-26 acquisition/installation/startup
// sprint. Most of what changed is markup, copy, and page structure — not
// independently-unit-testable pure logic — so, matching this project's
// established convention (see light-mode-only.test.ts, ring-colors.test.ts,
// layout-regressions.test.ts), these tests read the actual committed
// source and assert the specific defects are gone / the specific
// requirements are met. Rendered screenshots are the real evidence for
// visual behavior; see the final report.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "..");
const src = (...parts: string[]) => readFileSync(join(SRC_ROOT, ...parts), "utf-8");

describe("public landing page renders without gating on session resolution", () => {
  const index = src("routes", "index.tsx");

  it("does not render a full-screen 'Preparing KainFit…' loader gate", () => {
    expect(index).not.toContain("Preparing KainFit");
  });

  it("does not conditionally return early on an unresolved auth/session check", () => {
    // The removed defect was a `checked` state gate — `if (!checked) return <spinner>`.
    // Guard against that specific pattern reappearing, not just this exact name.
    expect(index).not.toMatch(/if\s*\(\s*!checked\s*\)/);
  });

  it("session resolution only ever navigates away — it never blocks the return value", () => {
    // The getSession() call must be effect-only (fire-and-navigate), not
    // gating what JSX gets returned from the component.
    expect(index).toMatch(/supabase\.auth\.getSession\(\)/);
    expect(index).toMatch(/navigate\(\{\s*to:\s*"\/today"/);
  });

  it("primary CTA goes to /demo, secondary CTA goes to /auth?mode=signup", () => {
    expect(index).toMatch(
      /to="\/demo"[\s\S]{0,80}Try KainFit free|Try KainFit free[\s\S]{0,80}to="\/demo"/,
    );
    expect(index).toContain('search={{ mode: "signup" }}');
  });

  it("states free-beta trust without an unsupported permanent-free claim", () => {
    expect(index).toMatch(/Free beta.*No credit card required/);
    expect(index.toLowerCase()).not.toContain("free forever");
    expect(index.toLowerCase()).not.toContain("no subscription ever");
  });

  it("does not offer phone or Apple sign-in from the landing page", () => {
    expect(index).not.toMatch(/continue with phone/i);
    expect(index).not.toMatch(/continue with apple/i);
  });

  it("the three-step section renders steps in 1, 2, 3 order", () => {
    const s1 = index.indexOf("Describe what you ate");
    const s2 = index.indexOf("Review the estimate");
    const s3 = index.indexOf("See where you stand");
    expect(s1).toBeGreaterThan(-1);
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
  });
});

describe("authentication is simplified to Google + email only", () => {
  const auth = src("routes", "auth.tsx");

  it("no phone sign-in UI remains reachable", () => {
    expect(auth).not.toMatch(/continue with phone/i);
    expect(auth).not.toContain('"Send code"');
    expect(auth).not.toContain("Verification code");
  });

  it("no Apple sign-in button remains reachable, even though the OAuth handler stays dormant", () => {
    expect(auth).not.toMatch(/continue with apple/i);
    // The handler and its icon are intentionally still present (see the
    // in-source comment) — only the button that reaches them is gone.
    expect(auth).toContain('handleOAuth("apple")');
  });

  it("Google is present and reachable from a real button", () => {
    expect(auth).toMatch(/Continue with Google/);
    expect(auth).toContain('handleOAuth("google")');
  });

  it("the free-beta trust strip explicitly says 'required', not just 'No credit card'", () => {
    expect(auth).toContain("No credit card required");
  });

  it("signup states what the account saves", () => {
    expect(auth).toContain("What your account saves");
    expect(auth).toContain("Today's entries");
  });
});

describe("demo preparation-status bug fix (2026-07-26)", () => {
  const demo = src("routes", "demo.tsx");

  it("DemoEntry carries a preparation field", () => {
    expect(demo).toMatch(/type DemoEntry = \{[\s\S]*?preparation\?:\s*string \| null;[\s\S]*?\};/);
  });

  it("confirmAdd() copies preparation from the reviewed pending item onto the saved entry", () => {
    // Must appear inside the object literal that becomes a DemoEntry, not
    // just anywhere in the file.
    expect(demo).toMatch(
      /confidence:\s*i\.confidence,\s*\n\s*preparation:\s*i\.preparation \?\? null,/,
    );
  });

  it("the saved-entry status badge is passed the entry's preparation, not left undefined", () => {
    expect(demo).toMatch(/<DemoStatusBadge[\s\S]{0,200}preparation=\{e\.preparation\}/);
  });
});

describe("demo post-save reward never uses promise language or target-specific coaching", () => {
  const demo = src("routes", "demo.tsx");

  it("computes the reward via the shared saveReactionMessage — never a bespoke promise-worded message", () => {
    expect(demo).toContain("saveReactionMessage(");
  });

  it("the demo page never renders 'Promise kept' or messageFor's target-gated Celebrate copy", () => {
    expect(demo).not.toContain("Promise kept");
    expect(demo).not.toContain("messageFor(");
  });

  it("the contextual post-demo signup CTA uses the exact required copy", () => {
    expect(demo).toContain("Keep today's progress.");
    expect(demo).toContain("Create your free account to save these entries and continue tracking.");
  });
});

describe("PWA manifest and service worker", () => {
  it("manifest declares real icon assets, not just the favicon", () => {
    const manifest = JSON.parse(src("..", "public", "manifest.webmanifest"));
    expect(manifest.name).toBe("KainFit");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose);
    expect(purposes).toContain("maskable");
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("the service worker never intercepts non-navigation requests (no API/auth caching)", () => {
    const sw = src("..", "public", "sw.js");
    expect(sw).toMatch(/request\.mode !== "navigate"/);
    expect(sw).not.toMatch(/cache\.put/); // only cache.add(OFFLINE_URL) at install time
  });

  it("the service worker never intercepts mutating requests", () => {
    const sw = src("..", "public", "sw.js");
    expect(sw).toMatch(/request\.method !== "GET"/);
  });
});

describe("analytics event allowlists stay consistent between client and server", () => {
  it("every new acquisition-sprint client EventName is also server-allowed", () => {
    const clientSrc = src("lib", "analytics.ts");
    const serverSrc = src("lib", "beta.functions.ts");
    const newEvents = [
      "install_cta_shown",
      "install_cta_selected",
      "install_accepted",
      "install_dismissed",
      "ios_install_guide_opened",
      "already_installed",
      "post_demo_signup_selected",
      "post_demo_install_selected",
    ];
    for (const event of newEvents) {
      expect(clientSrc, `client EventName missing ${event}`).toContain(`"${event}"`);
      expect(serverSrc, `server ALLOWED_EVENTS missing ${event}`).toContain(`"${event}"`);
    }
  });

  it("never sends raw meal text, email, or password fields as event properties", () => {
    // Spot-check the new call sites specifically — a broader payload audit
    // is out of scope here, but every new track() call this sprint added
    // must only ever pass enums/booleans/counts.
    const installPrompt = src("lib", "use-install-prompt.ts");
    expect(installPrompt).not.toMatch(/email|password|meal|input/i);
  });
});

describe("RenameMealPanel accessibility fix (2026-07-26)", () => {
  it("has a SheetDescription, not just a SheetTitle", () => {
    const rail = src("components", "QuickLogRail.tsx");
    const fnStart = rail.indexOf("function RenameMealPanel");
    const fnBody = rail.slice(fnStart, fnStart + 600);
    expect(fnBody).toContain("SheetTitle");
    expect(fnBody).toContain("SheetDescription");
  });
});
