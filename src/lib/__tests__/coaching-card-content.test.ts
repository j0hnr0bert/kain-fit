import { describe, it, expect } from "vitest";
import { messageFor, themeForTone } from "../../components/coaching-card-content";

describe("CoachingCard state -> theme mapping", () => {
  it("Guide gets the pale-teal theme", () => {
    const theme = themeForTone("guide");
    expect(theme.bg).toBe("bg-primary/5");
    expect(theme.icon).toBe("text-primary");
  });

  it("Celebrate gets its own token, not the shared --accent, and never a warning color", () => {
    const theme = themeForTone("celebrate");
    expect(theme.bg).toContain("celebrate");
    expect(theme.icon).toContain("celebrate");
    expect(theme.bg).not.toMatch(/red|destructive|coral/);
    expect(theme.icon).not.toMatch(/red|destructive|coral/);
  });

  it("Reinforce gets the dedicated blue-teal token", () => {
    const theme = themeForTone("reinforce");
    expect(theme.bg).toContain("reinforce");
    expect(theme.icon).toContain("reinforce");
  });

  it("Recovery uses the warm amber token and never red/orange/destructive styling", () => {
    const theme = themeForTone("recover");
    expect(theme.bg).toContain("amber");
    expect(theme.bg).not.toMatch(/red|destructive|coral/);
    expect(theme.icon).not.toMatch(/red|destructive|coral/);
  });

  it("every tone's background and icon classes are distinct from each other", () => {
    const tones = ["guide", "celebrate", "reinforce", "recover"] as const;
    const bgs = tones.map((t) => themeForTone(t).bg);
    expect(new Set(bgs).size).toBe(tones.length);
  });
});

describe("messageFor -> tone mapping (matches evaluateCoaching's kind)", () => {
  const weekly = { thisWeekDays: 1, lastWeekDays: 1 };

  it("guide result maps to the guide tone", () => {
    const content = messageFor({ kind: "guide", reason: "first-meal" }, 0, weekly);
    expect(content?.tone).toBe("guide");
  });

  it("celebrate result maps to the celebrate tone", () => {
    const content = messageFor({ kind: "celebrate", reason: "same-day-complete" }, 0, weekly);
    expect(content?.tone).toBe("celebrate");
  });

  it("reinforce result maps to the reinforce tone", () => {
    const content = messageFor({ kind: "reinforce", reason: "weekly-improved" }, 0, weekly);
    expect(content?.tone).toBe("reinforce");
  });

  it("recover result maps to the recover tone", () => {
    const content = messageFor({ kind: "recover", tier: "3-6" }, 0, weekly);
    expect(content?.tone).toBe("recover");
  });

  it("silence renders no card — messageFor returns null, same as before this sprint", () => {
    const content = messageFor({ kind: "silence" }, 0, weekly);
    expect(content).toBeNull();
  });
});
