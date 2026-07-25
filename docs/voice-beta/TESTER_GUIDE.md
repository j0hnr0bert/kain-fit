# KainFit Voice Input — Tester Guide

Thank you for helping test KainFit's voice input. This guide is written for
testers, not engineers — no technical background needed.

## What we're testing

KainFit lets you describe a meal out loud instead of typing it — for
example, saying "two eggs and a cup of rice" instead of typing it. We're
testing whether this works well for **English, Filipino, and Taglish
(mixed Filipino/English)** speech, said naturally, the way you'd actually
talk.

## This is a beta

The feature is unfinished and being actively tested. Things will go wrong
sometimes — that's expected, and it's exactly what we're here to find. You
are not going to "break" anything by triggering an error.

## The transcript can be wrong — you are the check

After you speak, KainFit shows you the **text it thinks you said**, in the
same box where you'd normally type. **Read it before doing anything else.**
If it's wrong or incomplete, edit it or fix it before continuing — the app
will not stop you from submitting a wrong transcript, so this step is on
you. This is the single most important thing in this guide.

## Please don't say anything sensitive

Only describe food. Don't say your password, full name, address, phone
number, medical conditions, or anything else you wouldn't want recorded.
The recording is processed to create the text, and while we don't keep the
audio afterward (see the privacy document), it's simplest to just never say
anything sensitive out loud during testing.

## Microphone access

The first time you tap the microphone button, your browser will ask for
permission to use the mic. Tap **Allow**. If you accidentally tap
**Block**, you'll need to fix it in your browser's site settings — the app
will show a message telling you it can't access the mic, but it can't
un-block it for you.

## Recording — start, stop, cancel, retry

- **Start**: tap the microphone button. You'll see a listening indicator
  and a timer.
- **Stop**: tap the same button (now showing a stop icon) when you're done
  talking. It also stops automatically after 20 seconds.
- **Cancel**: if you want to throw away a recording entirely without
  transcribing it, look for the cancel option shown while recording — this
  discards it completely, nothing gets sent anywhere.
- **Retry**: if the transcript is unusable or something went wrong, just
  tap the microphone again to record a new attempt. There's no limit on
  retrying during a test session.

## Fixing a transcript

The transcript lands in an editable text box, exactly like if you'd typed
it yourself. Tap into it and edit normally — fix a wrong word, add
something it missed, delete something it invented. Only submit once it
correctly reflects what you actually said.

## Reporting a wrong result

Two different things can go wrong, and it helps us a lot if you can tell
which one:

1. **The transcript was wrong** — the text didn't match what you said
   (wrong word, missing word, wrong number).
2. **The nutrition estimate was wrong** — the transcript was *correct*, but
   after you submitted it, the food, amount, or preparation KainFit
   recorded doesn't match what you said.

When something's wrong, please note:
- What you actually said (as best you remember)
- What the transcript showed
- What the app did after you submitted it (what food/amount/prep it
  recorded)
- Which of the two categories above it falls into

## What to capture as evidence

A screenshot of the transcript screen (before you submit) and a screenshot
of the result screen (after you submit) are the most useful things you can
send. If something crashes or freezes, a screenshot of that moment helps
too. Your test administrator will tell you where to send these.

## If something feels unsafe or confusing

Stop immediately and tell your test administrator. You are never required
to keep going, retry something that felt wrong, or figure out a problem on
your own. There's no such thing as a wasted or "failed" test session — an
early stop with clear notes is exactly as useful as a full one.
