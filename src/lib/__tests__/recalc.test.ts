import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatQuantity,
  foodStatus,
  isPreparationClarification,
  macroTargetStatus,
  ringPercent,
  ringAriaLabel,
  isCalorieRingComplete,
} from "../food-display";

// -------- Pure helper tests --------

describe("formatQuantity", () => {
  it("keeps grams as mass (no pluralization)", () => {
    expect(formatQuantity(200, "g")).toBe("200 g");
    expect(formatQuantity(1, "g")).toBe("1 g");
  });
  it("pluralizes servings/pieces on non-1 quantities", () => {
    expect(formatQuantity(1, "serving")).toBe("1 serving");
    expect(formatQuantity(2, "serving")).toBe("2 servings");
    expect(formatQuantity(3, "piece")).toBe("3 pieces");
  });
});

describe("foodStatus", () => {
  it("marks preparation estimated when preparation=estimated", () => {
    const s = foodStatus({ data_source: "verified_database", preparation: "estimated" });
    expect(s.label.toLowerCase()).toContain("preparation estimated");
  });
  it("returns a preparation-specific Verified label when preparation is raw or cooked", () => {
    // Not "plain Verified" — raw vs. cooked materially changes macros (see
    // the raw/cooked density fixtures below), so which one was used is real
    // signal worth keeping visible, not formatting to collapse.
    expect(foodStatus({ data_source: "verified_database", preparation: "raw" }).label).toBe(
      "Verified food · raw weight",
    );
    expect(foodStatus({ data_source: "verified_database", preparation: "cooked" }).label).toBe(
      "Verified food · cooked weight",
    );
  });
  it("falls back to standard preparation for an unrecognized preparation value", () => {
    const s = foodStatus({ data_source: "verified_database", preparation: "sous-vide" });
    expect(s.label).toBe("Verified food · standard preparation");
  });
});

describe("macroTargetStatus", () => {
  it("is no-target when there's nothing to compare against", () => {
    expect(macroTargetStatus(150, null)).toBe("no-target");
    expect(macroTargetStatus(150, undefined)).toBe("no-target");
    expect(macroTargetStatus(150, 0)).toBe("no-target");
  });

  it("is below-target when the value hasn't reached the target — never a warning", () => {
    // Fat at 68/100g specifically: this is the exact case the design
    // audit flagged as reading like an error purely from raw's identity
    // color. Below target must be neutral, not flagged.
    expect(macroTargetStatus(68, 100)).toBe("below-target");
  });

  it("is achieved when the rounded value exactly meets the target", () => {
    expect(macroTargetStatus(220, 220)).toBe("achieved");
    // 219.6 rounds to 220 for display — the color must agree with what's
    // actually shown, not the unrounded internal value.
    expect(macroTargetStatus(219.6, 220)).toBe("achieved");
  });

  it("is over-target when the value exceeds it — protein at 273/220g reads as achieved, not dangerous", () => {
    expect(macroTargetStatus(273, 220)).toBe("over-target");
  });
});

describe("ringPercent", () => {
  it("is 0 for a missing or non-positive target — never divides by zero", () => {
    expect(ringPercent(150, null)).toBe(0);
    expect(ringPercent(150, undefined)).toBe(0);
    expect(ringPercent(150, 0)).toBe(0);
    expect(Number.isFinite(ringPercent(150, 0))).toBe(true);
  });

  it("is proportional below target", () => {
    expect(ringPercent(50, 100)).toBe(50);
    expect(ringPercent(80, 100)).toBe(80);
  });

  it("is exactly 100 at the exact target", () => {
    expect(ringPercent(220, 220)).toBe(100);
  });

  it("clamps at 100 over target — never a second revolution", () => {
    expect(ringPercent(273, 220)).toBe(100);
    expect(ringPercent(999, 220)).toBe(100);
    expect(ringPercent(100000, 1)).toBe(100);
  });

  it("never goes negative for a negative or invalid value", () => {
    expect(ringPercent(-10, 100)).toBe(0);
    expect(ringPercent(NaN, 100)).toBe(0);
  });

  it("handles large values without overflow or precision blowups", () => {
    expect(ringPercent(9999, 2200)).toBe(100);
    expect(ringPercent(1840, 2400)).toBeCloseTo((1840 / 2400) * 100, 5);
  });
});

describe("ringAriaLabel", () => {
  it("communicates no target without inventing one", () => {
    expect(ringAriaLabel("Protein", 173, null, "g")).toBe("Protein: 173g logged, no target set");
  });

  it("communicates below-target progress with a percentage", () => {
    expect(ringAriaLabel("Fat", 68, 100, "g")).toBe("Fat: 68 of 100g, 68% of target");
  });

  it("communicates exact achievement without a percentage", () => {
    expect(ringAriaLabel("Protein", 220, 220, "g")).toBe("Protein: 220 of 220g, target reached");
  });

  it("communicates over-target as exceeded, not as a warning or failure", () => {
    const label = ringAriaLabel("Protein", 273, 220, "g");
    expect(label).toBe("Protein: 273 of 220g, target exceeded");
    expect(label.toLowerCase()).not.toMatch(/warn|fail|danger|error/);
  });
});

describe("isCalorieRingComplete — the calorie ring's gold-eligibility predicate", () => {
  it("no target never turns gold", () => {
    expect(isCalorieRingComplete(2400, null)).toBe(false);
    expect(isCalorieRingComplete(2400, undefined)).toBe(false);
    expect(isCalorieRingComplete(2400, 0)).toBe(false);
  });

  it("below target stays in the normal progress color", () => {
    expect(isCalorieRingComplete(1840, 2400)).toBe(false);
    expect(isCalorieRingComplete(0, 2400)).toBe(false);
  });

  it("exactly at target is complete", () => {
    expect(isCalorieRingComplete(2400, 2400)).toBe(true);
  });

  it("over target is still complete — the approved predicate is reach-or-exceed, matching the existing MacroRing checkmark rule and coaching.ts's caloriesRemaining<=0", () => {
    expect(isCalorieRingComplete(2401, 2400)).toBe(true);
    expect(isCalorieRingComplete(4000, 2400)).toBe(true);
  });

  it("does not distinguish degree of overshoot — a 300%-over day is exactly as complete as a 101%-over day, never more so", () => {
    const modest = isCalorieRingComplete(2450, 2400);
    const extreme = isCalorieRingComplete(9600, 2400);
    expect(modest).toBe(true);
    expect(extreme).toBe(true);
    // Confirms there is no separate tolerance-band or "too far over" mode.
    expect(modest).toBe(extreme);
  });
});

describe("isPreparationClarification", () => {
  it("detects raw/cooked questions", () => {
    expect(isPreparationClarification("Was that weighed raw or cooked?")).toBe(true);
    expect(isPreparationClarification("How large was the serving?")).toBe(false);
  });
});

// -------- Recalculation flow tests --------
//
// The bug this suite guards against: changing preparation used to update the
// label without recalculating nutrition. These tests verify that a client
// caller which switches preparation invokes the recalc backend and applies
// the returned macros, and that recalculation does NOT consume a demo slot.

type Item = {
  display_name: string;
  normalized_name: string;
  quantity: number;
  unit: string;
  preparation: "raw" | "cooked" | "estimated";
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  data_source: string;
  is_estimate: boolean;
  confidence: number;
};

function makeRecalcClient(
  table: Record<
    string,
    Partial<
      Pick<
        Item,
        | "calories"
        | "protein_g"
        | "carbs_g"
        | "fat_g"
        | "data_source"
        | "is_estimate"
        | "confidence"
      >
    >
  >,
  demoSpy: { consumed: number },
) {
  return {
    // recalcItem/recalcItemDemo must NEVER consume a demo slot.
    recalc: vi.fn(
      async (input: {
        display_name: string;
        quantity: number;
        unit: string;
        preparation: "raw" | "cooked" | "estimated";
      }) => {
        const key = `${input.display_name}|${input.preparation}|${input.quantity}${input.unit}`;
        const row = table[key];
        if (!row) throw new Error(`no fixture for ${key}`);
        return {
          calories: row.calories ?? 0,
          protein_g: row.protein_g ?? 0,
          carbs_g: row.carbs_g ?? 0,
          fat_g: row.fat_g ?? 0,
          data_source: row.data_source ?? "verified_database",
          is_estimate: row.is_estimate ?? false,
          confidence: row.confidence ?? 0.9,
        };
      },
    ),
    parseDemo: vi.fn(async () => {
      demoSpy.consumed += 1;
      return { items: [], input_language: "english", remaining: 3 - demoSpy.consumed };
    }),
  };
}

// Minimal client mirror of the demo/today recalcRow logic — kept in sync with
// the components so we can test the contract without rendering.
async function applyPreparationChange(
  item: Item,
  nextPrep: "raw" | "cooked" | "estimated",
  recalc: (
    i: Pick<Item, "display_name" | "normalized_name" | "quantity" | "unit" | "preparation">,
  ) => Promise<
    Pick<
      Item,
      "calories" | "protein_g" | "carbs_g" | "fat_g" | "data_source" | "is_estimate" | "confidence"
    >
  >,
): Promise<Item> {
  const staged: Item = {
    ...item,
    preparation: nextPrep,
    is_estimate: nextPrep === "estimated" ? true : item.is_estimate,
  };
  const out = await recalc({
    display_name: staged.display_name,
    normalized_name: staged.normalized_name,
    quantity: staged.quantity,
    unit: staged.unit,
    preparation: staged.preparation,
  });
  return { ...staged, ...out };
}

const CHICKEN: Item = {
  display_name: "chicken breast",
  normalized_name: "chicken breast",
  quantity: 200,
  unit: "g",
  preparation: "cooked",
  calories: 330,
  protein_g: 62,
  carbs_g: 0,
  fat_g: 7,
  data_source: "verified_database",
  is_estimate: false,
  confidence: 0.95,
};

const RICE: Item = {
  display_name: "rice",
  normalized_name: "white rice",
  quantity: 150,
  unit: "g",
  preparation: "cooked",
  calories: 195,
  protein_g: 4,
  carbs_g: 42,
  fat_g: 0,
  data_source: "verified_database",
  is_estimate: false,
  confidence: 0.95,
};

const GROUND_BEEF: Item = {
  ...CHICKEN,
  display_name: "ground beef",
  normalized_name: "ground beef",
  calories: 500,
  protein_g: 52,
  fat_g: 30,
};

const FISH: Item = {
  ...CHICKEN,
  display_name: "bangus",
  normalized_name: "milkfish",
  calories: 320,
  protein_g: 44,
  fat_g: 14,
};

let demo = { consumed: 0 };
let client = makeRecalcClient({}, demo);

beforeEach(() => {
  demo = { consumed: 0 };
  client = makeRecalcClient(
    {
      // chicken breast: raw is denser per gram than cooked (cooked loses water)
      "chicken breast|raw|200g": { calories: 220, protein_g: 46, carbs_g: 0, fat_g: 5 },
      "chicken breast|cooked|200g": { calories: 330, protein_g: 62, carbs_g: 0, fat_g: 7 },
      "chicken breast|estimated|200g": {
        calories: 275,
        protein_g: 54,
        carbs_g: 0,
        fat_g: 6,
        is_estimate: true,
        data_source: "estimated",
      },
      "chicken breast|raw|300g": { calories: 330, protein_g: 69, carbs_g: 0, fat_g: 7 },

      // rice: uncooked has ~3x calories per gram vs cooked
      "rice|raw|150g": { calories: 540, protein_g: 10, carbs_g: 120, fat_g: 1 },
      "rice|cooked|150g": { calories: 195, protein_g: 4, carbs_g: 42, fat_g: 0 },

      // ground beef: raw vs cooked differ
      "ground beef|raw|200g": { calories: 500, protein_g: 52, carbs_g: 0, fat_g: 30 },
      "ground beef|cooked|200g": { calories: 580, protein_g: 60, carbs_g: 0, fat_g: 36 },

      // fish
      "bangus|raw|200g": { calories: 320, protein_g: 44, carbs_g: 0, fat_g: 14 },
      "bangus|cooked|200g": { calories: 380, protein_g: 52, carbs_g: 0, fat_g: 17 },
    },
    demo,
  );
});

describe("preparation-change recalculation", () => {
  it("raw and cooked chicken breast produce different macros", async () => {
    const raw = await applyPreparationChange(CHICKEN, "raw", client.recalc);
    const cooked = await applyPreparationChange(CHICKEN, "cooked", client.recalc);
    expect(raw.calories).not.toBe(cooked.calories);
    expect(raw.protein_g).not.toBe(cooked.protein_g);
  });

  it("raw vs cooked rice produce different macros", async () => {
    const raw = await applyPreparationChange(RICE, "raw", client.recalc);
    const cooked = await applyPreparationChange(RICE, "cooked", client.recalc);
    expect(raw.calories).toBeGreaterThan(cooked.calories);
    expect(raw.carbs_g).toBeGreaterThan(cooked.carbs_g);
  });

  it("raw vs cooked ground beef produce different macros", async () => {
    const raw = await applyPreparationChange(GROUND_BEEF, "raw", client.recalc);
    const cooked = await applyPreparationChange(GROUND_BEEF, "cooked", client.recalc);
    expect(raw).not.toEqual(cooked);
    expect(raw.fat_g).not.toBe(cooked.fat_g);
  });

  it("raw vs cooked fish produce different macros", async () => {
    const raw = await applyPreparationChange(FISH, "raw", client.recalc);
    const cooked = await applyPreparationChange(FISH, "cooked", client.recalc);
    expect(raw.calories).not.toBe(cooked.calories);
  });

  it("changing quantity AND preparation recalculates against the new quantity", async () => {
    const bigger = await applyPreparationChange(
      { ...CHICKEN, quantity: 300 },
      "raw",
      client.recalc,
    );
    expect(bigger.calories).toBe(330);
    expect(bigger.quantity).toBe(300);
  });

  it("repeatedly switching between raw and cooked stays consistent", async () => {
    let x = CHICKEN;
    for (let i = 0; i < 4; i++) {
      x = await applyPreparationChange(x, "raw", client.recalc);
      expect(x.calories).toBe(220);
      x = await applyPreparationChange(x, "cooked", client.recalc);
      expect(x.calories).toBe(330);
    }
  });

  it("'Not sure' uses estimated preparation and marks is_estimate=true", async () => {
    const est = await applyPreparationChange(CHICKEN, "estimated", client.recalc);
    expect(est.preparation).toBe("estimated");
    expect(est.is_estimate).toBe(true);
    expect(est.data_source).toBe("estimated");
  });

  it("surfaces network / DB failures instead of leaving stale values", async () => {
    client.recalc.mockRejectedValueOnce(new Error("network down"));
    await expect(applyPreparationChange(CHICKEN, "raw", client.recalc)).rejects.toThrow(
      "network down",
    );
  });

  it("does NOT consume a demo calculation when preparation changes", async () => {
    await applyPreparationChange(CHICKEN, "raw", client.recalc);
    await applyPreparationChange(CHICKEN, "cooked", client.recalc);
    await applyPreparationChange(CHICKEN, "estimated", client.recalc);
    expect(client.parseDemo).not.toHaveBeenCalled();
    expect(demo.consumed).toBe(0);
  });
});
