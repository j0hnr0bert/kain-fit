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
  averageGramsPerDay: 130,
  averageAttainmentPct: 100,
  medianAttainmentPct: 100,
  attainmentStdDevPct: 5,
  averageShortfallG: 0,
  consistency: "low_variance",
  direction: "positive",
  directionTier: "strong",
};

const loggingEvidence: LoggingConsistencyEvidence = {
  insightType: "logging_consistency",
  windowDays: 60,
  activeDays: 22,
  consistencyRate: 22 / 60,
  currentStreak: 5,
  longestGapDays: 3,
  evidenceStrength: "strong_signal",
  direction: "positive",
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

// 2026-08-08 recalibration: proteinAdherenceCopy no longer derives its
// headline from evidenceStrength (describeAssociation) at all — see the
// module's own header comment for why that was the root cause of the
// production bug ("This is one of your strongest nutrition patterns" for a
// 2-of-15-days / ~13% hit-rate pattern). Every case below is keyed on
// evidence.direction + evidence.directionTier instead.
describe("proteinAdherenceCopy — direction-aware (2026-08-08 recalibration)", () => {
  function withAttainment(
    attainmentPct: number,
    overrides: Partial<ProteinAdherenceEvidence> = {},
  ) {
    return {
      ...proteinEvidence,
      averageAttainmentPct: attainmentPct,
      averageGramsPerDay: (attainmentPct / 100) * proteinEvidence.proteinTargetG,
      averageShortfallG:
        proteinEvidence.proteinTargetG - (attainmentPct / 100) * proteinEvidence.proteinTargetG,
      ...overrides,
    };
  }

  it("positive/strong: no hedge, calls it a real habit", () => {
    const evidence = withAttainment(96, {
      direction: "positive",
      directionTier: "strong",
      consistency: "low_variance",
    });
    const content = proteinAdherenceCopy(evidence);
    expect(content.headline).toBe("Protein is becoming one of your most consistent habits.");
    expect(content.observation).toContain("96%");
    expect(content.takeaway).not.toMatch(/gap|short/i);
  });

  it("positive/strong with high variance is downgraded to a 'clear' framing that avoids the word 'consistent'", () => {
    const evidence = withAttainment(95, {
      direction: "positive",
      directionTier: "clear", // detector would compute "clear" here specifically because of high variance
      consistency: "high_variance",
    });
    const content = proteinAdherenceCopy(evidence);
    expect(content.headline).toBe("Protein is trending close to your target.");
    expect(content.evidence).toMatch(/swung/i);
    expect(content.takeaway).not.toMatch(/consistent/i);
  });

  it("positive/clear (85-90%): trending language, not 'mastered'", () => {
    const evidence = withAttainment(87, {
      direction: "positive",
      directionTier: "clear",
      consistency: "low_variance",
    });
    const content = proteinAdherenceCopy(evidence);
    expect(content.headline).toBe("Protein is trending close to your target.");
    expect(content.headline).not.toMatch(/mastered|strongest/i);
  });

  it("neutral/borderline (80-85%): 'consistently close', never 'mastered' or 'strong habit'", () => {
    const evidence = withAttainment(82, { direction: "neutral", directionTier: "borderline" });
    const content = proteinAdherenceCopy(evidence);
    expect(content.headline).toBe("You're consistently close on protein.");
    const allText = Object.values(content).join(" ").toLowerCase();
    expect(allText).not.toMatch(/mastered|strong habit|workable habit/);
  });

  it("negative/clear (75-80%): names it a gap, not a success", () => {
    const evidence = withAttainment(78, { direction: "negative", directionTier: "clear" });
    const content = proteinAdherenceCopy(evidence);
    expect(content.headline).toBe("Protein is a gap worth noticing.");
    expect(content.headline).not.toMatch(/strongest|habit|success/i);
  });

  it("negative/strong (<75%): the exact production-bug shape — 2 of 15 days, ~13% hit rate", () => {
    // The production example, reconstructed: target 220g, 15 qualified
    // days, protein hit the target on only 2 of them, and average
    // attainment is well below 75%.
    const evidence: ProteinAdherenceEvidence = {
      insightType: "protein_adherence",
      daysEvaluated: 15,
      daysAtOrAboveTarget: 2,
      adherenceRate: 2 / 15,
      proteinTargetG: 220,
      evidenceStrength: "strong_signal", // 15 >= strong:14 — this is exactly why sample size alone was mistaken for quality
      averageGramsPerDay: 154, // ~70% average attainment
      averageAttainmentPct: 70,
      medianAttainmentPct: 69,
      attainmentStdDevPct: 8,
      averageShortfallG: 66,
      consistency: "low_variance",
      direction: "negative",
      directionTier: "strong",
    };
    const content = proteinAdherenceCopy(evidence);
    expect(content.headline).toBe("Protein is your clearest nutrition gap right now.");
    const allText = Object.values(content).join(" ").toLowerCase();
    expect(allText).not.toMatch(
      /strongest nutrition pattern|strong habit|workable habit|consistently hitting/,
    );
    expect(content.observation).toContain("70%");
    expect(content.observation).toContain("66g short");
  });

  it("every number in the copy comes directly from the evidence object", () => {
    const content = proteinAdherenceCopy(proteinEvidence);
    expect(content.observation).toContain("8 qualified days");
    expect(content.observation).toContain("130g protein target");
    expect(content.evidence).toContain("5 of 8 days");
  });

  it("provides a fixed, non-personalized whyItMatters statement with no evidence-derived numbers", () => {
    const content = proteinAdherenceCopy(proteinEvidence);
    expect(content.whyItMatters.length).toBeGreaterThan(0);
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
    proteinAdherenceCopy({
      ...proteinEvidence,
      averageAttainmentPct: 70,
      direction: "negative",
      directionTier: "strong",
      averageShortfallG: 39,
    }),
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

  it("no generated copy, across every direction/tier combination and every fixture, contains a prohibited word", () => {
    const strengths: EvidenceStrength[] = ["early_signal", "clear_signal", "strong_signal"];
    const directionFixtures: ProteinAdherenceEvidence[] = [
      {
        ...proteinEvidence,
        averageAttainmentPct: 96,
        direction: "positive",
        directionTier: "strong",
      },
      {
        ...proteinEvidence,
        averageAttainmentPct: 95,
        direction: "positive",
        directionTier: "clear",
        consistency: "high_variance",
      },
      {
        ...proteinEvidence,
        averageAttainmentPct: 87,
        direction: "positive",
        directionTier: "clear",
      },
      {
        ...proteinEvidence,
        averageAttainmentPct: 82,
        direction: "neutral",
        directionTier: "borderline",
      },
      {
        ...proteinEvidence,
        averageAttainmentPct: 78,
        direction: "negative",
        directionTier: "clear",
      },
      {
        ...proteinEvidence,
        averageAttainmentPct: 65,
        direction: "negative",
        directionTier: "strong",
      },
    ];
    const samples: SignalCardContent[] = [
      ...strengths.map((evidenceStrength) =>
        proteinAdherenceCopy({ ...proteinEvidence, evidenceStrength }),
      ),
      ...strengths.map((evidenceStrength) =>
        loggingConsistencyCopy({ ...loggingEvidence, evidenceStrength }),
      ),
      ...directionFixtures.map((evidence) => proteinAdherenceCopy(evidence)),
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
