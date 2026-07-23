// Shared formatting + status-label helpers for food entries and pending items.
// Keeps quantity/unit rendering and nutrition status hierarchy consistent
// across demo and registered views.

const NON_UNIT_MASS = new Set(["g", "kg", "ml", "l", "oz", "lb"]);

/** Format a quantity + unit for display, e.g. `200 g`, `1 serving`, `2 pieces`. */
export function formatQuantity(quantity: number | string, unit: string | null | undefined): string {
  const raw = typeof quantity === "number" ? quantity : Number(quantity);
  const num = Number.isFinite(raw) ? raw : 0;
  // Trim trailing zeros for decimals like 1.0 → 1, keep 1.5.
  const qStr = Number.isInteger(num) ? String(num) : String(Number(num.toFixed(2)));
  const u = (unit ?? "").trim();
  if (!u) return qStr;
  const isMass = NON_UNIT_MASS.has(u.toLowerCase());
  let label = u;
  if (!isMass) {
    // Pluralize simple common units when quantity != 1.
    const singular = u.toLowerCase();
    if (num !== 1) {
      if (singular === "piece") label = "pieces";
      else if (singular === "serving") label = "servings";
      else if (singular === "cup") label = "cups";
      else if (singular === "bowl") label = "bowls";
      else if (singular === "tablespoon" || singular === "tbsp") label = "tbsp";
      else if (singular === "teaspoon" || singular === "tsp") label = "tsp";
      else if (singular === "slice") label = "slices";
      else if (singular === "pack") label = "packs";
      else if (singular === "can") label = "cans";
    } else {
      if (singular === "pieces") label = "piece";
      else if (singular === "servings") label = "serving";
    }
  }
  return `${qStr} ${label}`;
}

export type StatusInput = {
  data_source: string;
  is_estimate?: boolean;
  preparation?: string | null;
};

export type StatusInfo = {
  label: string;
  tooltip: string;
  tone: "verified" | "recipe" | "estimated" | "user";
};

/**
 * Single source of truth for the nutrition status shown next to a food item.
 * Never returns both "Verified" and "Estimated" simultaneously; instead uses
 * a preparation-aware secondary phrase when the identity is verified but
 * preparation or serving size was inferred.
 */
export function foodStatus({ data_source, is_estimate, preparation }: StatusInput): StatusInfo {
  const prep = (preparation ?? "").toLowerCase();
  const knownPreps: Record<string, string> = {
    raw: "raw weight",
    cooked: "cooked weight",
    grilled: "grilled",
    fried: "fried",
    boiled: "boiled",
    baked: "baked",
    steamed: "steamed",
  };
  switch (data_source) {
    case "verified_database": {
      if (prep === "estimated") {
        return {
          label: "Verified food · preparation estimated",
          tooltip:
            "We recognized this food, but raw vs. cooked wasn't specified, so we used a middle-ground estimate. You can edit the preparation any time.",
          tone: "verified",
        };
      }
      if (knownPreps[prep]) {
        return {
          label: `Verified food · ${knownPreps[prep]}`,
          tooltip: `Matched against a known food. Nutrition uses the ${knownPreps[prep]} values.`,
          tone: "verified",
        };
      }
      // Unknown / missing preparation → standard preparation
      return {
        label: "Verified food · standard preparation",
        tooltip:
          "We recognized this food and used its most commonly logged preparation because you didn't specify one. You can edit the amount or preparation any time.",
        tone: "verified",
      };
    }
    case "recipe_based":
      return {
        label: "Recipe-based",
        tooltip: "Calculated from typical ingredients for this dish. Values may vary.",
        tone: "recipe",
      };
    case "user_confirmed":
      return {
        label: "User-confirmed",
        tooltip: "You confirmed or edited these values for this item.",
        tone: "user",
      };
    default:
      return {
        label: "Estimated",
        tooltip:
          "Values were estimated from your description. Edit if the amount or preparation is different.",
        tone: "estimated",
      };
  }
}

/** True when the AI's clarification appears to be about raw-vs-cooked or preparation. */
export function isPreparationClarification(question: string | null | undefined): boolean {
  if (!question) return false;
  const q = question.toLowerCase();
  return (
    q.includes("raw") ||
    q.includes("cooked") ||
    q.includes("weighed") ||
    q.includes("preparation") ||
    q.includes("prep")
  );
}
