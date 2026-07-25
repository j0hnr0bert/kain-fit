# Voice Beta — Consent and Privacy

**This document is not a legal agreement.** It explains, in plain language,
what testing involves and what happens to your data. Anything requiring a
formal legal guarantee is marked below and should go through proper legal
review before this feature reaches a public beta — this document does not
substitute for that review.

## What is being tested

KainFit's voice input feature: speaking a meal description out loud
instead of typing it, in English, Filipino, or Taglish (mixed
Filipino/English). We're testing whether the app correctly turns your
speech into text, and separately, whether it correctly turns that text
into a food/nutrition estimate.

## What data is collected

- The **text transcript** of what you said (not the audio itself — see
  below), for as long as needed to evaluate that specific test.
- Basic technical details: device type, browser, approximate recording
  duration, and which language group you were testing.
- Your own notes about what worked or didn't.
- An **alias** you're assigned for testing (e.g. `tester-01`) — never your
  real name, in the evidence records themselves.

## Is raw audio retained?

**No, by default.** The audio is sent to be transcribed and is not saved
by KainFit's servers or by the test administrator afterward. If a specific
recording needs to be kept for deeper investigation of a bug, that only
happens with your **separate, explicit, in-the-moment agreement** for that
one recording — never as a default or blanket practice.

## Are transcripts retained?

Yes, transcript **text** (not audio) is kept as part of the test evidence,
because that's what's being evaluated. This is limited to what you
actually said about food — see "please don't say anything sensitive"
below.

## How your alias is used

Your alias links your test attempts together within a session so patterns
can be found (e.g. "this tester's Taglish attempts all had the same
issue") without needing your name. The mapping from alias to your real
identity, if kept at all, is kept separately from the evidence data, by
the test administrator only.

## Withdrawing

You can stop a test session at any time, for any reason, without needing
to explain why. You can also ask afterward for your specific session's
evidence to be deleted — tell your test administrator directly.

## Please don't say anything sensitive

Only describe food during testing. Don't speak passwords, full legal
names, addresses, phone numbers, medical information, or anything else
you wouldn't want written down. This is testing infrastructure, not a
secure vault — the simplest protection is to never say it out loud in the
first place.

## What never goes into analytics or server logs

Raw audio and transcript **content** are never written to KainFit's
production analytics or server logs, in beta or otherwise — this is an
existing, verified property of the production code (see the transcription
Edge Function's logging behavior), not something specific to this test
program. Test evidence is a separate, deliberately-scoped record kept for
this evaluation only.

## Optional evaluation evidence requires your separate consent

If we ever want to use your specific test session as a named example in a
report (rather than aggregated, anonymous statistics), that requires
asking you again, specifically, for that use — your general agreement to
test the feature does not automatically cover this.

## Questions or concerns

Raise them with your test administrator before, during, or after your
session — there's no wrong time to ask.
