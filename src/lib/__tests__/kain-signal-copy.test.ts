import { describe, it, expect } from "vitest";
import {
  describeAssociation,
  loggingConsistencyCopy,
  proteinAdherenceCopy,
  signalCardCopy,
  validSilenceCopy,
  type SignalCardContent,
} from "../kain-signal-copy";
import type {
  EvidenceStrength,
  LoggingConsistencyEvidence,
  ProteinAdherenceEvidence,
} from "../kain-signal-types";
import type { RankedCandidate } from "../kain-signal-ranking";

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
    expect(content.oneBetterMove).toContain("63%"); // Math.round(0.625 * 100)
    expect(content.whyThis).toContain("5 of your last 8 complete days");
  });
});

describe("loggingConsistencyCopy", () => {
  it("reflects the exact active-day count, window, and streak from the evidence object", () => {
    const content = loggingConsistencyCopy(loggingEvidence);
    expect(content.headline).toBe("This is one of your strongest nutrition patterns.");
    expect(content.observation).toContain("22 of your last 60 days");
    expect(content.observation).toContain("streak of 5 days");
    expect(content.whyThis).toContain("22 active days out of your last 60");
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
});

describe("validSilenceCopy / signalCardCopy", () => {
  it("silence copy is calm and truthful, not generic filler", () => {
    const content = validSilenceCopy();
    expect(content.headline).toBe("Nothing urgent today.");
    expect(content.oneBetterMove).toContain("Keep logging normally");
  });

  it("signalCardCopy(null) dispatches to the silence variant", () => {
    expect(signalCardCopy(null)).toEqual(validSilenceCopy());
  });

  it("signalCardCopy dispatches by insightType for a ranked candidate", () => {
    const ranked: RankedCandidate = {
      insightType: "protein_adherence",
      evidence: proteinEvidence,
      rankScore: 2.1,
      suppressed: false,
    };
    expect(signalCardCopy(ranked)).toEqual(proteinAdherenceCopy(proteinEvidence));
  });
});

describe("prohibited-language enforcement", () => {
  const PROHIBITED_WORDS = ["always", "never", "failed", "guaranteed", "caused", "will result in"];

  function allStrings(content: SignalCardContent): string[] {
    return [content.headline, content.observation, content.oneBetterMove, content.whyThis];
  }

  it("no generated copy, across every fixture and every evidence-strength tier, contains a prohibited word", () => {
    const strengths: EvidenceStrength[] = ["early_signal", "clear_signal", "strong_signal"];
    const samples: SignalCardContent[] = [
      validSilenceCopy(),
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
