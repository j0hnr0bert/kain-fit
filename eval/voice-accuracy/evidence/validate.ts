// Hand-rolled validation for TesterEvidenceRecord, deliberately not zod —
// this repo has a documented, reproduced zod/Vitest resolution quirk (see
// corpus/validate.ts's own header), so evaluation-tooling validation uses
// plain structural checks throughout, not just here.

import type { TesterEvidenceRecord } from "./types";

export interface EvidenceValidationError {
  field: string;
  message: string;
}

export interface EvidenceValidationResult {
  valid: boolean;
  errors: EvidenceValidationError[];
}

const VALID_OS = ["iOS", "Android", "macOS", "Windows", "other"];
const VALID_BROWSER = ["Safari", "Chrome", "other"];
const VALID_LANGUAGE_GROUP = ["english", "filipino", "taglish"];
const VALID_STATUS = [
  "success",
  "transcription_failed",
  "nutrition_parse_failed",
  "cancelled_by_tester",
  "abandoned",
];

export function validateEvidenceRecord(record: unknown): EvidenceValidationResult {
  const errors: EvidenceValidationError[] = [];
  const push = (field: string, message: string) => errors.push({ field, message });

  if (typeof record !== "object" || record === null) {
    return { valid: false, errors: [{ field: "(root)", message: "record must be an object" }] };
  }
  const r = record as Record<string, unknown>;

  if (!r.sessionId || typeof r.sessionId !== "string") push("sessionId", "required, string");
  if (!r.testerAlias || typeof r.testerAlias !== "string") push("testerAlias", "required, string");
  if (typeof r.testerAlias === "string" && /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(r.testerAlias)) {
    push(
      "testerAlias",
      "looks like it might contain a real first+last name — use a short alias instead",
    );
  }
  if (r.consentGiven !== true) {
    push("consentGiven", "must be explicitly true — no record without recorded consent");
  }
  if (typeof r.device !== "string" || r.device.trim().length === 0) {
    push("device", "required, non-empty string");
  }
  if (typeof r.os !== "string" || !VALID_OS.includes(r.os)) {
    push("os", `must be one of: ${VALID_OS.join(", ")}`);
  }
  if (typeof r.browser !== "string" || !VALID_BROWSER.includes(r.browser)) {
    push("browser", `must be one of: ${VALID_BROWSER.join(", ")}`);
  }
  if (typeof r.installedAsPwa !== "boolean") push("installedAsPwa", "required boolean");
  if (typeof r.languageGroup !== "string" || !VALID_LANGUAGE_GROUP.includes(r.languageGroup)) {
    push("languageGroup", `must be one of: ${VALID_LANGUAGE_GROUP.join(", ")}`);
  }
  if (typeof r.scripted !== "boolean") push("scripted", "required boolean");
  if (r.scripted === true && (!r.corpusRecordId || typeof r.corpusRecordId !== "string")) {
    push("corpusRecordId", "required (string) when scripted is true");
  }
  if (r.scripted === false && r.corpusRecordId != null) {
    push("corpusRecordId", "must be null when scripted is false (unscripted)");
  }
  if (typeof r.rawTranscript !== "string") push("rawTranscript", "required string (may be empty)");
  if (typeof r.retryCount !== "number" || r.retryCount < 0) {
    push("retryCount", "required, non-negative number");
  }
  if (typeof r.finalStatus !== "string" || !VALID_STATUS.includes(r.finalStatus)) {
    push("finalStatus", `must be one of: ${VALID_STATUS.join(", ")}`);
  }
  for (const flagField of [
    "foodNameError",
    "quantityError",
    "unitError",
    "preparationModifierError",
    "negationError",
    "omissionError",
    "insertionError",
  ]) {
    if (typeof r[flagField] !== "boolean") push(flagField, "required boolean");
  }
  if (typeof r.recordedAt !== "string" || Number.isNaN(Date.parse(r.recordedAt))) {
    push("recordedAt", "required, valid ISO 8601 timestamp");
  }

  // Defense-in-depth: this schema has no field for audio or secrets, but
  // guard against someone pasting one in anyway.
  const forbiddenFields = ["audio", "audioBlob", "audioBase64", "apiKey", "authToken", "password"];
  for (const f of forbiddenFields) {
    if (f in r) push(f, "forbidden field — evidence must never contain audio or secrets");
  }

  return { valid: errors.length === 0, errors };
}

export function validateEvidenceSession(records: unknown[]): EvidenceValidationResult {
  const allErrors: EvidenceValidationError[] = [];
  records.forEach((rec, i) => {
    const { errors } = validateEvidenceRecord(rec);
    for (const e of errors) allErrors.push({ field: `[${i}].${e.field}`, message: e.message });
  });
  return { valid: allErrors.length === 0, errors: allErrors };
}
