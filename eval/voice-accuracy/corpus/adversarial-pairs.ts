// Derives the AdversarialPair[] list from GOLDEN_CORPUS rather than
// maintaining a second, hand-written copy that could drift out of sync
// with the actual records (Part 4).

import { GOLDEN_CORPUS } from "./golden-corpus";
import type { AdversarialPair } from "./types";

const CONTRAST_DESCRIPTIONS: Record<
  string,
  { description: string; field: AdversarialPair["criticalField"] }
> = {
  "adv-pair-en-01": { description: "15g vs 50g", field: "quantity" },
  "adv-pair-en-02": { description: "200g vs 300g", field: "quantity" },
  "adv-pair-en-03": { description: "half cup vs one and a half cups", field: "quantity" },
  "adv-pair-en-04": { description: "raw vs cooked", field: "state" },
  "adv-pair-en-05": { description: "packed in water vs packed in oil", field: "packedMedium" },
  "adv-pair-en-06": { description: "one scoop vs two scoops", field: "quantity" },
  "adv-pair-en-07": { description: "with rice vs no rice", field: "negation" },
  "adv-pair-en-08": { description: "chicken breast vs chicken thigh", field: "food" },
  "adv-pair-en-09": { description: "tablespoon vs teaspoon", field: "unit" },
  "adv-pair-en-10": { description: "egg vs egg white", field: "food" },
  "adv-pair-fil-01": { description: "15g vs 50g (Filipino)", field: "quantity" },
  "adv-pair-fil-02": { description: "two eggs vs three eggs (Filipino)", field: "quantity" },
  "adv-pair-fil-03": {
    description: "half cup vs one and a half cups (Filipino)",
    field: "quantity",
  },
  "adv-pair-fil-04": { description: "skinless vs skin-on (Filipino)", field: "state" },
  "adv-pair-fil-05": { description: "packed in water vs oil (Filipino)", field: "packedMedium" },
  "adv-pair-fil-06": { description: "with rice vs without rice (Filipino)", field: "negation" },
  "adv-pair-fil-07": { description: "chicken breast vs chicken thigh (Filipino)", field: "food" },
  "adv-pair-fil-08": { description: "lean vs regular beef (Filipino)", field: "state" },
  "adv-pair-fil-09": { description: "grilled vs fried (Filipino)", field: "state" },
  "adv-pair-fil-10": { description: "add rice vs don't add rice (Filipino)", field: "negation" },
  "adv-pair-tgl-01": { description: "200g vs 300g (Taglish)", field: "quantity" },
  "adv-pair-tgl-02": { description: "two eggs vs three eggs (Taglish)", field: "quantity" },
  "adv-pair-tgl-03": { description: "raw vs cooked (Taglish)", field: "state" },
  "adv-pair-tgl-04": { description: "skinless vs skin-on (Taglish)", field: "state" },
  "adv-pair-tgl-05": { description: "one scoop vs two scoops (Taglish)", field: "quantity" },
  "adv-pair-tgl-06": { description: "with rice vs without rice (Taglish)", field: "negation" },
  "adv-pair-tgl-07": { description: "tablespoon vs teaspoon (Taglish)", field: "unit" },
  "adv-pair-tgl-08": { description: "lean vs regular beef (Taglish)", field: "state" },
  "adv-pair-tgl-09": { description: "egg vs egg white (Taglish)", field: "food" },
  "adv-pair-tgl-10": { description: "add rice vs don't add rice (Taglish)", field: "negation" },
};

export function buildAdversarialPairs(): AdversarialPair[] {
  const groups = new Map<string, string[]>();
  for (const r of GOLDEN_CORPUS) {
    if (!r.adversarialPairId) continue;
    const list = groups.get(r.adversarialPairId) ?? [];
    list.push(r.id);
    groups.set(r.adversarialPairId, list);
  }
  const pairs: AdversarialPair[] = [];
  for (const [pairId, ids] of groups) {
    const meta = CONTRAST_DESCRIPTIONS[pairId];
    pairs.push({
      pairId,
      contrastDescription: meta?.description ?? pairId,
      recordIdA: ids[0],
      recordIdB: ids[1],
      criticalField: meta?.field ?? "quantity",
    });
  }
  return pairs.sort((a, b) => a.pairId.localeCompare(b.pairId));
}

export const ADVERSARIAL_PAIRS: AdversarialPair[] = buildAdversarialPairs();
