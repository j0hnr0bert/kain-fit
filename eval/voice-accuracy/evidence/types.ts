// Stage 3C tester-evidence schema.
//
// One TesterEvidenceRecord per recording attempt during a native-speaker
// test session (see docs/voice-beta/TEST_SESSION_RUNBOOK.md). Deliberately
// a plain data shape, not a database table or a new service — evidence is
// collected as JSON files under eval/voice-accuracy/evidence/sessions/
// (gitignored, same as pilot-state/), one file per session, reviewed and
// selectively committed like any other evaluation artifact.
//
// NEVER include: raw audio, API keys, auth tokens, or the tester's real
// name — alias only. See docs/voice-beta/CONSENT_AND_PRIVACY.md.

export type EvidenceLanguageGroup = "english" | "filipino" | "taglish";
export type EvidenceOs = "iOS" | "Android" | "macOS" | "Windows" | "other";
export type EvidenceBrowser = "Safari" | "Chrome" | "other";
export type EvidenceFinalStatus =
  | "success"
  | "transcription_failed"
  | "nutrition_parse_failed"
  | "cancelled_by_tester"
  | "abandoned";

export interface TesterEvidenceRecord {
  sessionId: string; // e.g. "2026-07-26-session-1"
  testerAlias: string; // never a real name — see CONSENT_AND_PRIVACY.md
  consentGiven: boolean; // must be true before any record is created
  device: string; // e.g. "iPhone 14"
  os: EvidenceOs;
  osVersion: string;
  browser: EvidenceBrowser;
  installedAsPwa: boolean;
  languageGroup: EvidenceLanguageGroup;
  scripted: boolean; // false for natural unscripted meal descriptions
  corpusRecordId: string | null; // links to golden-corpus.ts or native-review-extension.ts when scripted; null when unscripted
  intendedPhrase: string | null; // what the tester was asked to say; null when unscripted
  rawTranscript: string; // exactly what the app showed, before any edit
  correctedTranscript: string | null; // what the tester changed it to, if anything; null if unchanged
  recordingDurationMs: number | null;
  transcriptionLatencyMs: number | null;
  retryCount: number;
  finalStatus: EvidenceFinalStatus;
  // Each true only if that specific error type was observed for this attempt.
  foodNameError: boolean;
  quantityError: boolean;
  unitError: boolean;
  preparationModifierError: boolean;
  negationError: boolean;
  omissionError: boolean; // expected content missing entirely
  insertionError: boolean; // fabricated content that was never said
  nutritionParserResult: string | null; // brief plain-text summary of what the review screen showed, if it got that far
  testerNotes: string;
  administratorNotes: string;
  recordedAt: string; // ISO 8601
}

export function newEmptyEvidenceRecord(
  sessionId: string,
  testerAlias: string,
): TesterEvidenceRecord {
  return {
    sessionId,
    testerAlias,
    consentGiven: false,
    device: "",
    os: "other",
    osVersion: "",
    browser: "other",
    installedAsPwa: false,
    languageGroup: "english",
    scripted: true,
    corpusRecordId: null,
    intendedPhrase: null,
    rawTranscript: "",
    correctedTranscript: null,
    recordingDurationMs: null,
    transcriptionLatencyMs: null,
    retryCount: 0,
    finalStatus: "abandoned",
    foodNameError: false,
    quantityError: false,
    unitError: false,
    preparationModifierError: false,
    negationError: false,
    omissionError: false,
    insertionError: false,
    nutritionParserResult: null,
    testerNotes: "",
    administratorNotes: "",
    recordedAt: new Date().toISOString(),
  };
}
