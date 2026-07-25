# Voice Beta — Session Runbook (for the person administering a session)

This is the reproducible procedure for running one voice-testing session
with a native-speaking tester. Follow it in order. Every step should
produce the same result every time — if something doesn't, that's worth
noting as its own finding.

## Preflight — one-time setup (only needed once per machine)

These two files are local-only and gitignored — never commit them, never
paste their contents anywhere.

1. `supabase/functions/.env.local` must contain `OPENAI_API_KEY=<your key>`
   and `VOICE_TRANSCRIPTION_ENABLED=true`. If you don't have this yet, see
   the original Stage 3B secret-ceremony notes in project history — you
   need your own OpenAI API key.
2. Project-root `.env.local` must contain `SUPABASE_URL=http://127.0.0.1:54321`,
   `SUPABASE_PUBLISHABLE_KEY=<local publishable key from `supabase start`'s
   output>`, `SUPABASE_SERVICE_ROLE_KEY=<local service role key from the
   same output>`. These local-dev default keys are printed in plaintext by
   `supabase start` every time — they are not secrets, just don't commit
   the file.
3. Tailscale must be installed and logged in on this Mac
   (`brew install --cask tailscale-app`, then log in via the menu bar app).
4. The tester's device (iPhone or Android) must be enrolled in the same
   Tailscale tailnet, under the same account.

## Every session

### 1. Environment startup

```bash
./scripts/voice-beta/start-test-env.sh
```

This checks secrets by presence only (never prints values), starts Docker,
local Supabase, the Edge Function server, the frontend, and a Tailscale
HTTPS mapping restricted to your tailnet — then verifies both endpoints
actually respond before printing the URL. If any step fails, it stops and
tells you which one — fix that before continuing.

### 2. Preflight checks

- Confirm the script's final output shows both endpoints returning 200.
- Run `./scripts/voice-beta/status-test-env.sh` and confirm exactly the
  devices you expect show up under Tailscale peers — nothing unrecognized.
- Confirm `VOICE_TRANSCRIPTION_ENABLED` shows as present (the kill switch
  is on) — if you ever need to pause testing without tearing everything
  down, this is the switch to flip.

### 3. Tester consent

Before any recording happens, walk the tester through
`CONSENT_AND_PRIVACY.md` and get their explicit agreement — verbally is
fine, but note in the evidence record that consent was given. Do not
proceed without it.

### 4. Tester alias assignment

Assign a short, non-identifying alias (e.g. `tester-01`) — never a real
name — and use it consistently in every evidence record for this session.

### 5. Device and browser recording

Note, before starting: device model, OS version, browser (Safari/Chrome),
and whether it's the installed PWA or a regular browser tab. This goes in
every evidence record for the session (see Phase 4's schema).

### 6. Language-group selection

Decide which language group(s) this session covers — English control,
Filipino, or Taglish — and pull phrases from
`eval/voice-accuracy/corpus/golden-corpus.ts` and
`eval/voice-accuracy/corpus/native-review-extension.ts` (the latter for
newer, not-yet-reviewed phrases — see Phase 3).

### 7. Walk through the phrase set

For each phrase, in this order:

1. **English control phrase** — one simple, already-verified English
   phrase first, every session, as a sanity check that the pipeline itself
   is working before testing the language you actually care about.
2. **Filipino phrases** — from the locked corpus's `filipino` group.
3. **Taglish phrases** — from the locked corpus's `taglish` group.
4. **Natural unscripted meal descriptions** — ask the tester to describe a
   real meal in their own words, not reading a script. This is the most
   realistic signal and should not be skipped.
5. **Noisy-environment samples** — repeat a phrase or two with normal
   background noise present (TV, other people talking, a fan) — not
   engineered, just realistic.

For each recording: show the tester one phrase at a time (or let them
describe their own meal for the unscripted ones), let them record
naturally, don't coach pronunciation.

### 8. Transcript review

After each recording, **before** letting the tester submit: look at the
transcript together. Ask the tester "does this say what you said?" Record
the raw transcript exactly as shown, whether or not it's correct.

### 9. Correction recording

If the transcript is wrong, let the tester correct it as they naturally
would (or you can note what the correct version should have been), and
record both the raw and corrected transcript in the evidence.

### 10. Nutrition result inspection

Once submitted, look at the review screen together. Record whether the
food, quantity, unit, and preparation match what was actually said — this
is a distinct check from whether the transcript itself was correct (see
`TESTER_GUIDE.md`'s explanation of the two failure types).

### 11. Evidence export

Fill in one evidence record per attempt using the schema in
`eval/voice-accuracy/corpus/types.ts`'s `TesterEvidenceRecord` (see Phase 4
docs) — either directly, or via
`eval/voice-accuracy/pilot-state/session-<date>-<tester-alias>.json`. Never
include raw audio in the committed evidence file. Never include anything
identifying beyond the alias.

### 12. Environment shutdown

```bash
./scripts/voice-beta/stop-test-env.sh
```

Run this at the end of **every** session, no exceptions — confirms zero
containers, zero local processes, and the Tailscale mapping fully reset.
Do not leave the environment running between sessions.

## If something goes wrong mid-session

Stop, don't troubleshoot live in front of the tester. Thank them, note
exactly where it broke, and re-run `status-test-env.sh` to diagnose. A
partial session with clear notes is a valid, useful result.
