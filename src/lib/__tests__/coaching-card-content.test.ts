import { describe, it, expect } from "vitest";
import {
  messageFor,
  themeForTone,
  isPromiseEligible,
  saveReactionMessage,
  REACTION_THEME,
  proteinRemainingTieDownVariant,
  calorieMarginTieDownVariant,
  recoveryTieDownVariant,
  REJECTED_TIE_DOWN_EXAMPLE,
  aboveCalorieTargetMessage,
  weeklyDeclineMessage,
  missedDailyTargetMessage,
} from "../../components/coaching-card-content";

// A message is "tie-down eligible" when its body ends in a short direct
// question following a clear instruction — these are the only approved
// phrasings in scope for this sprint (see the product spec's tie-down
// list). Used to detect tie-down presence in tests without hardcoding one
// specific string per call site.
const KNOWN_TIE_DOWNS =
  /Is that clear\?|Have you got that\?|Are you with me\?|Agreed\?|Clear\?|Gets\?|Kasama kita\?|right\?/;

describe("CoachingCard state -> theme mapping", () => {
  it("Guide gets the pale-teal theme", () => {
    const theme = themeForTone("guide");
    expect(theme.bg).toBe("bg-primary/8");
    expect(theme.icon).toBe("text-primary");
    expect(theme.iconWrap).toContain("primary");
  });

  it("Celebrate gets its own token, not the shared --accent, and never a warning color", () => {
    const theme = themeForTone("celebrate");
    expect(theme.bg).toContain("celebrate");
    expect(theme.icon).toContain("celebrate");
    expect(theme.iconWrap).toContain("celebrate");
    expect(theme.bg).not.toMatch(/red|destructive|coral|pink|peach/);
    expect(theme.icon).not.toMatch(/red|destructive|coral|pink|peach/);
  });

  it("Reinforce gets the dedicated blue-teal token", () => {
    const theme = themeForTone("reinforce");
    expect(theme.bg).toContain("reinforce");
    expect(theme.icon).toContain("reinforce");
    expect(theme.iconWrap).toContain("reinforce");
  });

  it("Recovery uses the warm amber token and never red/orange/destructive styling", () => {
    const theme = themeForTone("recover");
    expect(theme.bg).toContain("amber");
    expect(theme.iconWrap).toContain("amber");
    expect(theme.bg).not.toMatch(/red|destructive|coral/);
    expect(theme.icon).not.toMatch(/red|destructive|coral/);
  });

  it("every tone's background and icon classes are distinct from each other", () => {
    const tones = ["guide", "celebrate", "reinforce", "recover"] as const;
    const bgs = tones.map((t) => themeForTone(t).bg);
    expect(new Set(bgs).size).toBe(tones.length);
  });

  it("every tone has a non-empty iconWrap (the tinted icon-circle container)", () => {
    const tones = ["guide", "celebrate", "reinforce", "recover"] as const;
    tones.forEach((t) => {
      expect(themeForTone(t).iconWrap.length).toBeGreaterThan(0);
    });
  });

  it("only Celebrate gets the static glow — it's the one state meant to feel earned", () => {
    expect(themeForTone("celebrate").extra).toBe("celebrate-glow");
    expect(themeForTone("guide").extra).toBeUndefined();
    expect(themeForTone("reinforce").extra).toBeUndefined();
    expect(themeForTone("recover").extra).toBeUndefined();
  });
});

describe("isPromiseEligible", () => {
  it("is true only when manual_targets_enabled is exactly true", () => {
    expect(isPromiseEligible(true)).toBe(true);
    expect(isPromiseEligible(false)).toBe(false);
  });
});

describe("messageFor -> tone mapping (matches evaluateCoaching's kind)", () => {
  const weekly = { thisWeekDays: 1, lastWeekDays: 1 };

  it("guide result maps to the guide tone", () => {
    const content = messageFor({ kind: "guide", reason: "first-meal" }, 0, weekly, true);
    expect(content?.tone).toBe("guide");
  });

  it("celebrate result maps to the celebrate tone", () => {
    const content = messageFor({ kind: "celebrate", reason: "same-day-complete" }, 0, weekly, true);
    expect(content?.tone).toBe("celebrate");
  });

  it("reinforce result maps to the reinforce tone", () => {
    const content = messageFor({ kind: "reinforce", reason: "weekly-improved" }, 0, weekly, true);
    expect(content?.tone).toBe("reinforce");
  });

  it("recover result maps to the recover tone", () => {
    const content = messageFor({ kind: "recover", tier: "3-6" }, 0, weekly, true);
    expect(content?.tone).toBe("recover");
  });

  it("silence renders no card — messageFor returns null regardless of promise eligibility", () => {
    expect(messageFor({ kind: "silence" }, 0, weekly, true)).toBeNull();
    expect(messageFor({ kind: "silence" }, 0, weekly, false)).toBeNull();
  });

  it("recovery copy never contains the flagged weak/apologetic line, at any tier", () => {
    (["3-6", "7-29", "30+"] as const).forEach((tier) => {
      const content = messageFor({ kind: "recover", tier }, 0, weekly, true);
      expect(content?.body.toLowerCase()).not.toContain("no pressure to catch up");
      expect(content?.headline).toBe("You're back. Good.");
    });
  });

  it("reinforce copy reflects the actual day counts, not a fixed example", () => {
    const content = messageFor(
      { kind: "reinforce", reason: "weekly-improved" },
      0,
      { thisWeekDays: 4, lastWeekDays: 2 },
      true,
    );
    expect(content?.headline).toContain("4 disciplined days");
    expect(content?.headline).toContain("up from 2");
  });

  it("reinforce copy handles singular day phrasing correctly", () => {
    const content = messageFor(
      { kind: "reinforce", reason: "weekly-improved" },
      0,
      { thisWeekDays: 1, lastWeekDays: 0 },
      true,
    );
    expect(content?.headline).toBe("1 disciplined day—up from 0.");
  });

  it("reinforce includes a future-pacing sentence tied to the 90-day horizon, without guaranteeing a result", () => {
    const content = messageFor({ kind: "reinforce", reason: "weekly-improved" }, 0, weekly, true);
    expect(content?.body).toContain("Day 90");
    expect(content?.body.toLowerCase()).not.toMatch(/will have your dream|guarantee|promise you/);
  });
});

describe("promise-language eligibility gates Celebrate's copy", () => {
  const weekly = { thisWeekDays: 3, lastWeekDays: 2 };
  const result = { kind: "celebrate", reason: "same-day-complete" } as const;

  it("uses 'Promise kept' only when promiseEligible is true", () => {
    const content = messageFor(result, 0, weekly, true);
    expect(content?.headline).toBe("Promise kept.");
  });

  it("falls back to 'Targets handled' when promiseEligible is false — automatic targets cannot trigger promise language", () => {
    const content = messageFor(result, 0, weekly, false);
    expect(content?.headline).toBe("Targets handled.");
    expect(content?.headline.toLowerCase()).not.toContain("promise");
    expect(content?.body.toLowerCase()).not.toContain("promise");
  });

  it("Celebrate never carries a tie-down in either eligibility branch — recognition should land, not ask for confirmation", () => {
    expect(messageFor(result, 0, weekly, true)?.body).not.toMatch(KNOWN_TIE_DOWNS);
    expect(messageFor(result, 0, weekly, false)?.body).not.toMatch(KNOWN_TIE_DOWNS);
  });
});

describe("default (live) coaching copy never repeats a tie-down on repeat-prone states", () => {
  const weekly = { thisWeekDays: 2, lastWeekDays: 2 };

  it("protein-remaining Guide (can fire after every meal) has no tie-down by default", () => {
    const content = messageFor({ kind: "guide", reason: "protein-remaining" }, 42, weekly, true);
    expect(content?.body).not.toMatch(KNOWN_TIE_DOWNS);
  });

  it("calories-near Guide (can fire after every meal) has no tie-down by default", () => {
    const content = messageFor({ kind: "guide", reason: "calories-near" }, 0, weekly, true);
    expect(content?.body).not.toMatch(KNOWN_TIE_DOWNS);
  });

  it("Recovery (can persist across many renders in one return session) has no tie-down by default", () => {
    const content = messageFor({ kind: "recover", tier: "3-6" }, 0, weekly, true);
    expect(content?.body).not.toMatch(KNOWN_TIE_DOWNS);
  });

  it("first-meal Guide (fires at most once per day) is the one default state that does carry a tie-down", () => {
    const content = messageFor({ kind: "guide", reason: "first-meal" }, 0, weekly, true);
    expect(content?.body).toMatch(KNOWN_TIE_DOWNS);
  });

  it("no default card contains more than one tie-down", () => {
    const cases = [
      messageFor({ kind: "guide", reason: "first-meal" }, 0, weekly, true),
      messageFor({ kind: "guide", reason: "protein-remaining" }, 20, weekly, true),
      messageFor({ kind: "guide", reason: "calories-near" }, 0, weekly, true),
      messageFor({ kind: "celebrate", reason: "same-day-complete" }, 0, weekly, true),
      messageFor({ kind: "reinforce", reason: "weekly-improved" }, 0, weekly, true),
      messageFor({ kind: "recover", tier: "7-29" }, 0, weekly, true),
    ];
    for (const content of cases) {
      const matches = content?.body.match(new RegExp(KNOWN_TIE_DOWNS.source, "g")) ?? [];
      expect(matches.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("tie-down alternates — approved phrasing, demonstrated in the QA harness, not wired into the repeat-prone live path", () => {
  it("protein-remaining variant follows a clear instruction with a grammatically sensible question", () => {
    const content = proteinRemainingTieDownVariant(68);
    expect(content.body).toBe(
      "You have 68g left. Build the next meal around protein. Is that clear?",
    );
    expect(content.body).toMatch(KNOWN_TIE_DOWNS);
  });

  it("calorie-margin variant follows a clear instruction with a grammatically sensible question", () => {
    const content = calorieMarginTieDownVariant(410);
    expect(content.body).toBe(
      "410 calories remain. Lean protein is the move now. Have you got that?",
    );
  });

  it("recovery variant follows a clear instruction, not a bare greeting", () => {
    const content = recoveryTieDownVariant();
    expect(content.body).toBe(
      "Do not reconstruct the missing days. Start with the next meal. Are you with me?",
    );
  });

  it("every tie-down variant contains exactly one tie-down question", () => {
    const variants = [
      proteinRemainingTieDownVariant(10),
      calorieMarginTieDownVariant(100),
      recoveryTieDownVariant(),
    ];
    for (const v of variants) {
      const matches = v.body.match(new RegExp(KNOWN_TIE_DOWNS.source, "g")) ?? [];
      expect(matches.length).toBe(1);
    }
  });

  it("the documented rejected example has no logical object for its question — kept as a negative fixture, never used by any real function", () => {
    expect(REJECTED_TIE_DOWN_EXAMPLE).toBe("Great protein. Are you with me?");
    // None of the real content-producing functions ever emit this exact
    // construction — "great <noun>." immediately followed by a tie-down.
    const liveOutputs = [
      messageFor(
        { kind: "guide", reason: "first-meal" },
        0,
        { thisWeekDays: 1, lastWeekDays: 1 },
        true,
      )?.body,
      proteinRemainingTieDownVariant(10).body,
      calorieMarginTieDownVariant(10).body,
      recoveryTieDownVariant().body,
    ];
    for (const body of liveOutputs) {
      expect(body).not.toBe(REJECTED_TIE_DOWN_EXAMPLE);
      expect(body ?? "").not.toMatch(/^(Great|Nice|Good) \w+\. Are you with me\?$/);
    }
  });
});

describe("designed-but-not-wired copy (hierarchy gaps — see final report)", () => {
  it("above-calorie-target copy never recommends dangerous compensation", () => {
    const content = aboveCalorieTargetMessage();
    const banned = /skip|purge|fast(ing)?|extra cardio|double.*cardio|punish|restrict/i;
    expect(content.body).not.toMatch(banned);
    expect(content.taglish).not.toMatch(banned);
    expect(content.headline.toLowerCase()).toContain("above");
  });

  it("weekly-decline copy reflects real counts and confronts the behavior, not the person", () => {
    const content = weeklyDeclineMessage({ thisWeekDays: 2, lastWeekDays: 5 });
    expect(content.body).toContain("2 logging days");
    expect(content.body).toContain("Last week was 5");
    expect(content.headline.toLowerCase()).not.toMatch(
      /you are|you're (weak|lazy|pathetic|undisciplined)/,
    );
  });

  it("missed-daily-target copy owns the data without shame or aggressive compensation", () => {
    const content = missedDailyTargetMessage();
    const banned = /skip|purge|fast(ing)?|extra cardio|punish|weak|lazy|pathetic/i;
    expect(content.body).not.toMatch(banned);
    expect(content.headline).not.toMatch(banned);
  });
});

describe("saveReactionMessage — the post-save 'doggy-biscuit moment'", () => {
  it("recognizes a protein-dense meal as a strong reaction with the actual grams cited", () => {
    const r = saveReactionMessage({ protein: 38, calories: 300, carbs: 5, fat: 8 });
    expect(r.quality).toBe("strong");
    expect(r.headline).toBe("That's execution.");
    expect(r.body).toContain("38g protein added");
  });

  it("does not call a small meal 'strong' just because its ratio is high", () => {
    // 6g protein at 24 kcal is a 100% protein-calorie share, but the
    // absolute amount is trivial — must not read as a meaningful "hit".
    const r = saveReactionMessage({ protein: 6, calories: 24, carbs: 0, fat: 0 });
    expect(r.quality).toBe("standard");
  });

  it("cites the actual remaining grams when post-save context is provided — 'prefer specificity'", () => {
    const r = saveReactionMessage(
      { protein: 20, calories: 500, carbs: 40, fat: 15 },
      { proteinRemainingAfter: 62 },
    );
    expect(r.quality).toBe("standard");
    expect(r.body).toBe("20g protein added. You have 62g remaining.");
  });

  it("falls back to a generic acknowledgment without remaining-grams context", () => {
    const r = saveReactionMessage({ protein: 12, calories: 400, carbs: 40, fat: 15 });
    expect(r.quality).toBe("standard");
    expect(r.body).toBe("12g protein added.");
  });

  it("still acknowledges a meal with no protein at all — every honest log is rewarded", () => {
    const r = saveReactionMessage({ protein: 0, calories: 150, carbs: 35, fat: 1 });
    expect(r.body).toBe("Your numbers are updated. Keep moving.");
    expect(r.quality).toBe("standard");
  });

  it("a save during an active Recovery gap gets 'Back in motion' regardless of macro content", () => {
    const ordinary = saveReactionMessage(
      { protein: 0, calories: 150, carbs: 35, fat: 1 },
      { wasRecovering: true },
    );
    expect(ordinary.headline).toBe("Back in motion.");
    const proteinDense = saveReactionMessage(
      { protein: 40, calories: 300, carbs: 2, fat: 5 },
      { wasRecovering: true },
    );
    expect(proteinDense.headline).toBe("Back in motion.");
  });

  it("never produces shaming, judgmental, or moralizing language for any input", () => {
    const scenarios = [
      { protein: 0, calories: 900, carbs: 100, fat: 60 },
      { protein: 0, calories: 50, carbs: 12, fat: 0 },
      { protein: 45, calories: 200, carbs: 0, fat: 2 },
      { protein: 0, calories: 0, carbs: 0, fat: 0 },
    ];
    const banned = /bad|unhealthy|too much|shouldn't|guilt|fail|warn/i;
    scenarios.forEach((s) => {
      const r = saveReactionMessage(s);
      expect(r.headline).not.toMatch(banned);
      expect(r.body).not.toMatch(banned);
      expect(r.taglish).not.toMatch(banned);
    });
  });

  it("the immediate reaction never carries a tie-down — 'the tie-down belongs to the instruction, not the achievement'", () => {
    const scenarios = [
      saveReactionMessage({ protein: 38, calories: 300, carbs: 5, fat: 8 }),
      saveReactionMessage({ protein: 12, calories: 400, carbs: 40, fat: 15 }),
      saveReactionMessage({ protein: 0, calories: 150, carbs: 35, fat: 1 }),
      saveReactionMessage({ protein: 0, calories: 0, carbs: 0, fat: 0 }, { wasRecovering: true }),
    ];
    for (const r of scenarios) {
      expect(r.body).not.toMatch(KNOWN_TIE_DOWNS);
    }
  });

  it("every reaction quality has a themed treatment distinct from the other", () => {
    expect(REACTION_THEME.standard.bg).not.toBe(REACTION_THEME.strong.bg);
    expect(REACTION_THEME.standard.icon).not.toBe(REACTION_THEME.strong.icon);
  });
});
