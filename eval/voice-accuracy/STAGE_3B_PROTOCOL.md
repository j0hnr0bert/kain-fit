# Stage 3B — Real-Audio Collection Protocol

This document is instructions for a *later, separate, human-executed* stage. Nothing in Stage 3A performs any of the steps below — no recording, no consent collection, no upload, no storage has happened. This is the plan, not the execution.

## What Stage 3B produces

For each of the 120 golden-corpus records (or a representative subset), one or more real human recordings of that exact `intendedTranscript`, captured under the device/browser/noise/rate conditions below, with metadata that fills in the `FixtureMetadataPlaceholders` fields left `null` in Stage 3A's corpus (see `corpus/types.ts`).

## Speaker requirements

- At least **5 real speakers**.
- At least **2 male and 2 female** speakers.
- Varied Filipino accents/regional backgrounds where practical (not a strict quota — a documented best-effort).
- **Minimum 20 recordings per speaker.**

## Device/browser matrix (all four required)

- iPhone Safari (not installed as a PWA)
- Installed iPhone PWA
- Android Chrome (not installed as a PWA)
- Installed Android PWA

Every speaker should cover as much of this matrix as practical; the release gate (Part 10) requires the *aggregate* dataset to include all four, not that every individual speaker does.

## Noise conditions (all four required across the dataset)

- Quiet room
- Normal room noise
- Gym noise
- Fan/air-conditioner noise

## Speaking rate/style (all three required across the dataset)

- Normal speech
- Fast speech
- Quiet speech

## Recording duration

Each recording should land naturally between **~5 and ~20 seconds** — this is a byproduct of reading the corpus utterance naturally, not a separate constraint to force. Stage 2's client already hard-caps at 20 seconds (`MAX_RECORDING_MS`); nothing in Stage 3B should require recordings at or near that ceiling as a target.

## Per-recording metadata (required)

| Field | Description |
|---|---|
| Anonymized speaker ID | A stable pseudonymous ID (e.g. `speaker-03`), never a real name |
| Device | e.g. "iPhone 14" |
| OS | e.g. "iOS 18.1" |
| Browser/PWA | e.g. "Safari 18 (installed PWA)" |
| Codec | Whatever `MediaRecorder.mimeType` actually reports for that session (see `src/hooks/voice-state-machine.ts`'s `CANDIDATE_MIME_TYPES`) |
| Duration | Actual recorded length in seconds |
| Language category | english / filipino / taglish — must match the corpus record's `languageGroup` |
| Noise category | quiet / normal_room / gym / fan_ac |
| Speaking-rate category | normal / fast / quiet |
| Consent status | See below — must be recorded per speaker, not assumed |
| Deletion date | The date this specific recording is scheduled for deletion (see retention below) |

This maps directly onto `CorpusRecord`'s `FixtureMetadataPlaceholders` fields (`audioFixtureId`, `speakerId`, `deviceMetadata`, `browserMetadata`, `microphoneMetadata`, `noiseCondition`, `speakingRate`) — Stage 3B's job is to populate those, not redesign the schema.

## Privacy requirements

- **Obtain informed consent** from every speaker before recording — what the recording is for, how long it's kept, who can access it, and that it will be used to evaluate (not train a public model, not sold, not used for anything beyond this internal accuracy evaluation) — in writing, before the session starts.
- **Test meal descriptions only.** Speakers read the corpus's `intendedTranscript` values (or close natural paraphrases if instructed to speak naturally rather than read verbatim) — never their own real meal history, medical information, or any other personal disclosure.
- **Collect no names or other sensitive information** in the recording itself or its metadata beyond the anonymized speaker ID.
- **Do not commit raw audio to this repository automatically or otherwise.** Audio fixtures live in a storage location outside version control (see below) and are referenced by `audioFixtureId`, never embedded in `golden-corpus.ts` or any committed file.
- **Never place audio or transcripts in analytics.** This is already a hard requirement for the production Stage 2 client (`src/hooks/analytics.ts` metadata-only events) and applies identically to any Stage 3B tooling — evaluation run manifests record status/category/latency/language, never audio or transcript content, exactly like `runner/run-evaluation.ts`'s `EvaluationSummary` already does for mocked runs.

## Storage location (to be decided at Stage 3B kickoff, not here)

Recommended default, pending approval: a private, access-controlled cloud storage bucket separate from this git repository, with `audioFixtureId` in the corpus pointing to an opaque key rather than a public URL. This document does not create that bucket or grant access — that's an explicit, separate approval step.

## Retention and deletion

- Recordings are retained only as long as needed for the specific evaluation round they support.
- A default retention ceiling of **90 days** from collection is recommended, after which recordings are deleted unless a specific documented reason extends retention (e.g. an active accuracy investigation).
- Each recording's metadata carries its own `deletion date` so retention can be audited per-fixture, not just as a blanket policy.
- **A fixture must be removable without corrupting aggregate results.** This is why `CorpusRecord.audioFixtureId` is a separate, optional pointer rather than the audio being embedded in the corpus or in any run's results — deleting a fixture just means `getAudioForRecord()` (see `runner/adapters.ts`'s `LiveAdapterAudioSource`) returns `null` for that ID on the next run, which the runner already treats as a `no_audio_fixture` result for that one record, not a crash.

## What Stage 3B does NOT do

- Does not enable `VOICE_TRANSCRIPTION_ENABLED`.
- Does not deploy the Edge Function.
- Does not configure `OPENAI_API_KEY`.
- Does not run a live evaluation against the real endpoint — that's a distinct, later, explicitly-approved step once fixtures exist and the infrastructure above is actually in place.
