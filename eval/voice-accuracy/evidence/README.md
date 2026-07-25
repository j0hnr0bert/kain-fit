# Tester Evidence

Structured records of real native-speaker test attempts. See
`types.ts` for the full schema and
`../../../docs/voice-beta/TEST_SESSION_RUNBOOK.md` for how this is used
during a session.

## Usage

1. Copy `session-template.json` to `sessions/<date>-<tester-alias>.json`
   (create `sessions/` if it doesn't exist — it's gitignored, so real
   session data is never committed by default).
2. Fill in one JSON object per recording attempt, as a top-level array.
3. Validate with `validateEvidenceSession()` from `validate.ts` before
   relying on the data for scoring.
4. If a session is worth preserving as reviewed evaluation evidence
   (e.g. it feeds a report), explicitly `git add -f` that specific file —
   review its contents first, same discipline as any other commit.

## What must never appear in a session file

- Raw audio in any form
- API keys, auth tokens, or passwords
- The tester's real name — alias only
- Anything a tester said that wasn't about food (per
  `CONSENT_AND_PRIVACY.md`, testers are asked not to say this in the first
  place, but don't transcribe it into a record if it happens)

`validateEvidenceRecord()` checks structurally for forbidden fields and
flags anything that looks like a real first+last name in the alias field,
but it cannot catch everything — human review before committing remains
required.
