import { describe, it, expect } from "vitest";
import {
  describeAssociation,
  loggingConsistencyCopy,
  proteinAdherenceCopy,
  type SignalCardContent,
} from "../kain-signal-copy";
import type {
  EvidenceStrength,
  LoggingConsistencyEvidence,
  ProteinAdherenceEvidence,
} from "../kain-signal-types";

const proteinEvidence: ProteinAdherenceEvidence = {
  insightType: "protein_adherence",
  daysEvaluated: 8,
  daysAtOrAboveTarget: 5,
  adherenceRate: 0.625,
  proteinTargetG: 130,
  evidenceStrength: "clear_signal",
};

const loggingEvidence: LoggingConsistencyEvidence = {
  insightType: "logging_consistency",
  windowDays: 60,
  activeDays: 22,
  consistencyRate: 22 / 60,
  currentStreak: 5,
  longestGapDays: 3,
  evidenceStrength: "strong_signal",
};

describe("describeAssociation", () => {
  it("returns the doctrine's exact three canonical strength phrases", () => {
    const cases: [EvidenceStrength, string][] = [
      ["early_signal", "An early pattern may be forming."],
      ["clear_signal", "A clear pattern is emerging."],
      ["strong_signal", "This is one of your strongest nutrition patterns."],
    ];
    for (const [strength, expected] of cases) {
      expect(describeAssociation(strength)).toBe(expected);
    }
  });
});

describe("proteinAdherenceCopy", () => {
  it("every number in the copy comes directly from the evidence object (the 8-day/130g example)", () => {
    const content = proteinAdherenceCopy(proteinEvidence);
    expect(content.headline).toBe("A clear pattern is emerging.");
    expect(content.observation).toContain("8 complete days");
    expect(content.observation).toContain("130g protein target");
    expect(content.observation).toContain("5 of them");
    expect(content.evidence).toContain("5 of your last 8 complete days");
    expect(content.evidence).toContain("63%"); // Math.round(0.625 * 100)
  });

  it("provides a fixed, non-personalized whyItMatters statement (the copy contract's fourth part)", () => {
    const content = proteinAdherenceCopy(proteinEvidence);
    expect(content.whyItMatters.length).toBeGreaterThan(0);
    // whyItMatters is a general principle, never a number from the evidence.
    expect(content.whyItMatters).not.toMatch(/\d/);
  });
});

describe("loggingConsistencyCopy", () => {
  it("reflects the exact active-day count, window, and streak from the evidence object", () => {
    const content = loggingConsistencyCopy(loggingEvidence);
    expect(content.headline).toBe("This is one of your strongest nutrition patterns.");
    expect(content.observation).toContain("22 of your last 60 days");
    expect(content.observation).toContain("streak of 5 days");
    expect(content.evidence).toContain("22 active days out of your last 60");
  });

  it("omits the streak clause entirely when currentStreak is 0, rather than saying 'streak of 0 days'", () => {
    const content = loggingConsistencyCopy({ ...loggingEvidence, currentStreak: 0 });
    expect(content.observation).not.toContain("streak");
  });

  it("uses singular 'day' for a streak of exactly 1", () => {
    const content = loggingConsistencyCopy({ ...loggingEvidence, currentStreak: 1 });
    expect(content.observation).toContain("streak of 1 day");
    expect(content.observation).not.toContain("1 days");
  });

  it("provides a fixed, non-personalized whyItMatters statement (the copy contract's fourth part)", () => {
    const content = loggingConsistencyCopy(loggingEvidence);
    expect(content.whyItMatters.length).toBeGreaterThan(0);
  });
});

describe("copy ownership — KainSignal interprets, it never instructs (2026-07-27 correction)", () => {
  const allContent: SignalCardContent[] = [
    proteinAdherenceCopy(proteinEvidence),
    loggingConsistencyCopy(loggingEvidence),
  ];

  it("uses `takeaway`, not `action`, as the field name", () => {
    for (const content of allContent) {
      expect(content).toHaveProperty("takeaway");
      expect(content).not.toHaveProperty("action");
    }
  });

  // Semantic guards on phrasing shape, not one exact sentence — these must
  // survive future copy edits as long as the ownership boundary holds.
  const SAME_DAY_INSTRUCTION_PATTERNS = [
    /\btoday\b/i,
    /\btonight\b/i,
    /remaining\b/i,
    /\bnext meal\b/i,
    /\badd\b.*\bto your\b/i,
    /\beat\b/i,
    /\blog today\b/i,
  ];

  it("no field mentions today's remaining protein or calories, or instructs an immediate action", () => {
    for (const content of allContent) {
      for (const [field, text] of Object.entries(content)) {
        for (const pattern of SAME_DAY_INSTRUCTION_PATTERNS) {
          expect(
            pattern.test(text),
            `${field} matched same-day-instruction pattern ${pattern}: "${text}"`,
          ).toBe(false);
        }
      }
    }
  });

  it("takeaway interprets the pattern rather than issuing an instruction (no imperative verb opening)", () => {
    const IMPERATIVE_OPENERS =
      /^(eat|add|log|keep|choose|build|make sure|try|avoid|reduce|increase)\b/i;
    for (const content of allContent) {
      expect(IMPERATIVE_OPENERS.test(content.takeaway.trim())).toBe(false);
    }
  });
});

describe("prohibited-language enforcement", () => {
  const PROHIBITED_WORDS = ["always", "never", "failed", "guaranteed", "caused", "will result in"];

  function allStrings(content: SignalCardContent): string[] {
    return [
      content.headline,
      content.observation,
      content.evidence,
      content.whyItMatters,
      content.takeaway,
    ];
  }

  it("no generated copy, across every fixture and every evidence-strength tier, contains a prohibited word", () => {
    const strengths: EvidenceStrength[] = ["early_signal", "clear_signal", "strong_signal"];
    const samples: SignalCardContent[] = [
      ...strengths.map((evidenceStrength) =>
        proteinAdherenceCopy({ ...proteinEvidence, evidenceStrength }),
      ),
      ...strengths.map((evidenceStrength) =>
        loggingConsistencyCopy({ ...loggingEvidence, evidenceStrength }),
      ),
      // Boundary-flavored fixtures: zero adherence, full adherence, zero streak.
      proteinAdherenceCopy({ ...proteinEvidence, daysAtOrAboveTarget: 0, adherenceRate: 0 }),
      proteinAdherenceCopy({
        ...proteinEvidence,
        daysAtOrAboveTarget: proteinEvidence.daysEvaluated,
        adherenceRate: 1,
      }),
      loggingConsistencyCopy({ ...loggingEvidence, currentStreak: 0 }),
    ];

    for (const content of samples) {
      for (const text of allStrings(content)) {
        for (const word of PROHIBITED_WORDS) {
          expect(text.toLowerCase()).not.toContain(word);
        }
      }
    }
  });
});
