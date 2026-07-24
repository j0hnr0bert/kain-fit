// Stage 3A corpus schema validation (Part 14).
//
// Hand-rolled rather than a zod schema: zod (already a project dependency,
// used by src/lib/food.functions.ts) was tried here first, but
// `z.object` resolves to `undefined` under this project's Vitest setup
// even in a trivial standalone repro (unrelated to this file's own code —
// reproduces with nothing but `import { z } from "zod"; z.object({})` in
// a fresh test file). That is a pre-existing environment/dependency-
// resolution quirk in this repo, not something Stage 3A introduced or is
// in scope to fix — documented here and in the Stage 3A report rather
// than silently worked around. Plain structural checks below are
// straightforward enough for this shape that zod wasn't adding much
// beyond what's already implemented.

import type { CorpusRecord, LanguageGroup, TestSplit } from "./types";

export interface CorpusValidationError {
  code: string;
  message: string;
}

export interface CorpusValidationResult {
  valid: boolean;
  errors: CorpusValidationError[];
  recordCount: number;
}

const REQUIRED_LANGUAGE_GROUPS: LanguageGroup[] = ["english", "filipino", "taglish"];
const REQUIRED_SPLITS: TestSplit[] = ["development", "validation", "locked_challenge"];
const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard", "adversarial"]);
const VALID_CORRECTION_FIELDS = new Set(["quantity", "unit", "food", "preparation"]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateRecordShape(record: CorpusRecord, errors: CorpusValidationError[]): void {
  const id = typeof record?.id === "string" ? record.id : "<unknown id>";
  const fail = (msg: string) =>
    errors.push({
      code: "invalid_record_shape",
      message: `Record ${id} failed schema validation: ${msg}`,
    });

  if (!isNonEmptyString(record?.id)) fail("id must be a non-empty string");
  if (!REQUIRED_LANGUAGE_GROUPS.includes(record?.languageGroup))
    fail("languageGroup must be one of english/filipino/taglish");
  if (!isNonEmptyString(record?.intendedTranscript))
    fail("intendedTranscript must be a non-empty string");
  if (typeof record?.normalizedReferenceTranscript !== "string")
    fail("normalizedReferenceTranscript must be a string");
  if (!VALID_DIFFICULTIES.has(record?.difficulty))
    fail("difficulty must be one of easy/medium/hard/adversarial");
  if (!Array.isArray(record?.challengeCategories) || record.challengeCategories.length === 0)
    fail("challengeCategories must be a non-empty array");
  if (!REQUIRED_SPLITS.includes(record?.testSplit))
    fail("testSplit must be one of development/validation/locked_challenge");
  if (typeof record?.isAdversarial !== "boolean") fail("isAdversarial must be a boolean");
  if (record?.adversarialPairId !== null && typeof record?.adversarialPairId !== "string")
    fail("adversarialPairId must be string or null");
  if (typeof record?.reviewerNotes !== "string") fail("reviewerNotes must be a string");

  const expected = record?.expected;
  if (!expected || typeof expected !== "object") {
    fail("expected must be an object");
    return;
  }
  if (!Array.isArray(expected.foods)) {
    fail("expected.foods must be an array");
  } else {
    for (const f of expected.foods) {
      if (!isNonEmptyString(f?.food)) fail("expected.foods[].food must be a non-empty string");
      if (!isNonEmptyString(f?.spokenAs))
        fail("expected.foods[].spokenAs must be a non-empty string");
      if (f?.quantity !== null && typeof f?.quantity !== "number")
        fail(`expected.foods[${f?.food}].quantity must be number or null`);
      if (f?.unit !== null && typeof f?.unit !== "string")
        fail(`expected.foods[${f?.food}].unit must be string or null`);
      if (!isStringArray(f?.preparation))
        fail(`expected.foods[${f?.food}].preparation must be a string array`);
      if (!isStringArray(f?.stateModifiers))
        fail(`expected.foods[${f?.food}].stateModifiers must be a string array`);
      if (f?.packedMedium !== null && typeof f?.packedMedium !== "string")
        fail(`expected.foods[${f?.food}].packedMedium must be string or null`);
      if (f?.brand !== null && typeof f?.brand !== "string")
        fail(`expected.foods[${f?.food}].brand must be string or null`);
    }
  }
  if (!isStringArray(expected.additions)) fail("expected.additions must be a string array");
  if (!isStringArray(expected.exclusions)) fail("expected.exclusions must be a string array");
  if (!isStringArray(expected.negations)) fail("expected.negations must be a string array");
  if (!Array.isArray(expected.corrections)) {
    fail("expected.corrections must be an array");
  } else {
    for (const c of expected.corrections) {
      if (
        typeof c?.from !== "string" ||
        typeof c?.to !== "string" ||
        !VALID_CORRECTION_FIELDS.has(c?.field)
      ) {
        fail("expected.corrections[] entries must have from/to strings and a valid field");
      }
    }
  }
  if (!REQUIRED_LANGUAGE_GROUPS.includes(expected.utteranceLanguage))
    fail("expected.utteranceLanguage must be one of english/filipino/taglish");
  if (
    !Array.isArray(expected.codeSwitchPoints) ||
    !expected.codeSwitchPoints.every((n: unknown) => typeof n === "number")
  ) {
    fail("expected.codeSwitchPoints must be a number array");
  }
  if (!isStringArray(expected.criticalTokens))
    fail("expected.criticalTokens must be a string array");
}

export function validateCorpus(records: CorpusRecord[]): CorpusValidationResult {
  const errors: CorpusValidationError[] = [];

  if (records.length === 0) {
    return {
      valid: false,
      errors: [
        { code: "empty_corpus", message: "Corpus is empty — an empty dataset cannot pass." },
      ],
      recordCount: 0,
    };
  }

  for (const record of records) {
    validateRecordShape(record, errors);
    if (record.isAdversarial && !record.adversarialPairId) {
      errors.push({
        code: "adversarial_missing_pair_id",
        message: `Record ${record.id} is marked adversarial but has no adversarialPairId.`,
      });
    }
  }

  const ids = records.map((r) => r.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      errors.push({ code: "duplicate_id", message: `Duplicate corpus ID: ${id}` });
    }
    seen.add(id);
  }

  const presentLanguages = new Set(records.map((r) => r.languageGroup));
  for (const lang of REQUIRED_LANGUAGE_GROUPS) {
    if (!presentLanguages.has(lang)) {
      errors.push({
        code: "missing_language_group",
        message: `No records found for language group: ${lang}`,
      });
    }
  }

  const presentSplits = new Set(records.map((r) => r.testSplit));
  for (const split of REQUIRED_SPLITS) {
    if (!presentSplits.has(split)) {
      errors.push({ code: "missing_split", message: `No records found for test split: ${split}` });
    }
  }

  // Adversarial pair integrity: every pair must have exactly 2 members,
  // both in the same split (a pair split across splits would let one half
  // leak into a split the other half is protected in).
  const pairGroups = new Map<string, CorpusRecord[]>();
  for (const r of records) {
    if (!r.adversarialPairId) continue;
    const group = pairGroups.get(r.adversarialPairId) ?? [];
    group.push(r);
    pairGroups.set(r.adversarialPairId, group);
  }
  for (const [pairId, members] of pairGroups) {
    if (members.length !== 2) {
      errors.push({
        code: "malformed_adversarial_pair",
        message: `Adversarial pair ${pairId} has ${members.length} members, expected 2.`,
      });
    } else if (members[0].testSplit !== members[1].testSplit) {
      errors.push({
        code: "adversarial_pair_split_mismatch",
        message: `Adversarial pair ${pairId} is split across two different test splits.`,
      });
    } else if (
      members[0].normalizedReferenceTranscript === members[1].normalizedReferenceTranscript
    ) {
      errors.push({
        code: "adversarial_pair_collapsed",
        message: `Adversarial pair ${pairId} normalizes both sides to the same string — normalization is erasing the intended contrast.`,
      });
    }
  }

  return { valid: errors.length === 0, errors, recordCount: records.length };
}
