# KainFit Evidence Engine v1 (Implementation Specification)

Refines `.lovable/behavior-engine.md` into something an engineer can build
directly from. Behavior Engine remains the source for message *wording*
and *voice* (the Taglish variations, the tone examples) — this document is
the source for *when anything shows at all*, and it changes two things in
Behavior Engine outright (see §7). No code. No implementation here — this
is the blueprint.

Last updated: 2026-07-23.

---

## Core Principle

A user should close KainFit more confident than when they opened it. Not
entertained, not pressured — more capable of their next decision. The app
does not optimize for time spent inside it; if clear guidance means
someone closes the app in four seconds, that is the product working
correctly, not underperforming.

---

## The Four Purposes

**1. Celebrate** — recognize a completed action, at the moment it
completes. Protein target hit, a meal logged, a milestone of total days
crossed.

**2. Reinforce** — objective, measurable evidence of improvement. A
number, always. "Average protein up 18g vs. last week" beats "great
job" every time — evidence is stronger than compliments, so wherever a
genuine comparative number exists, prefer it over a plain completion
announcement.

**3. Guide** — remove uncertainty by answering exactly one question:
*what's the easiest next win?* Never more than one action. Never phrased
as a deficit.

**4. Recover** — re-entry after an absence, activated only when needed,
never the default state. Never names the gap, the streak, or failure.
Transitions back into Guide the instant the first meal is logged — Recover
is a doorway, not a destination.

Identity-reinforcing language (Behavior Engine §8) is not a fifth purpose
— it's a voice property that may color a Celebrate or Recover message at
rare, high-value moments (milestones, long-gap returns). It never gets
its own decision-tree branch, and never stacks two identity statements in
one message.

---

## Priority Hierarchy, with justification

**Locked 2026-07-23, supersedes the ordering below from the prior
revision of this document.** Only one message per app open.

1. **Recover** — a user who's been gone outranks everything else; the
   cost of getting this wrong (making a returning user feel worse) is
   far higher than the cost of delaying anything else by a day.
2. **Guide** — the everyday, highest-frequency purpose; this is the
   product's actual job on a normal day, and it now outranks Celebrate
   and Reinforce deliberately — most sessions should end in guidance,
   not praise.
3. **Celebrate** (same-day completion) — see the transient-override rule
   immediately below; otherwise ranks here.
4. **Reinforce** — weekly comparison only in Sprint 01 (see scope note).
5. **Milestones** — excluded from Sprint 01 entirely (see scope note).
   When implemented, milestones never interrupt Recovery or Guide and
   may be delayed to the next session where nothing higher-priority
   applies — they do not get a preemptive slot the way earlier drafts of
   this document specified.
6. **Silence** — the default, expected outcome on most days once
   established.

**Transient Celebrate override (new, approved 2026-07-23):** this is a
scoped exception, not a reordering of the list above. The instant a save
causes both macro targets to become met for the first time that day (a
true state transition, not "still true from earlier"), Celebrate is
shown once, immediately, ahead of Guide — the achievement gets
acknowledged in the moment it happens. This override does not persist:
the very next time the tree is evaluated (next app open, next
navigation back to Today), the standing hierarchy above applies again
normally. Implemented as in-memory-only state, never written to
storage, so it cannot outlive the session in which it fired — that's
what makes it "short-lived" by construction rather than by a rule
someone has to remember to expire.

**Sprint 01 scope note:** Monthly Reinforce and Milestones are
intentionally not implemented in the first vertical slice — weekly
Reinforce is sufficient to prove the mechanism, and both excluded
branches need a wider historical query than anything currently fetched
anywhere in the app. Excluding them is a scope decision, not an
oversight; see the launch checklist for when to revisit.

---

## Message Rules (confirmed, not new)

Every message: increases confidence, reduces uncertainty, supports
identity only where earned, encourages one action. Never interrupts
logging, never requires dismissal, never repeats verbatim, never sounds
like social media or a motivational speaker. Voice: an experienced coach
who quietly notices — not a cheerleader.

---

## Freshness System

Mechanism unchanged from Behavior Engine §7 (track last-2-shown variant
per leaf, exclude from next pick, context-aware not random) — it now
operates per decision-tree *leaf* rather than per the old 24-category
list, which is a smaller, cleaner surface to maintain. Meaning stays
constant across variants; only wording moves.

---

## Decision Hierarchy

Evaluated fresh on every app open. Descends until one branch fires; every
branch is a hard stop — nothing downstream is ever also evaluated.
**Sprint 01 implements every step below except 0a/0b (struck through) —
Milestones and Monthly Reinforce are out of scope for this slice.**

```
STEP 0 — Transient override (scoped exception, not part of the standing
         hierarchy — see "Transient Celebrate override" above)
  Did the save that just happened cause both macro targets to become
  met for the first time today (a genuine transition, not "still true
  from earlier")?
  → CELEBRATE — same-day completion, shown immediately. STOP.
  (This check only ever applies in the render immediately following the
  triggering save. Any other evaluation skips straight to Step 1.)

STEP 1 — Recovery
  Gap since last logged day ≥ 3 calendar days?
  → RECOVER (tone scales: 3–6d / 7–29d / 30+d). STOP.
  (Gaps of 1–2 days are deliberately not "recovery" — see Behavior
  Engine §3.3. They produce no message here; they fall through to Step 2
  exactly like any other day.)

STEP 2 — Today's first action
  Has anything been logged yet today?
  → NO: GUIDE — log your first meal. STOP.
  → YES: continue.

STEP 3 — Guide (macro-based)
  Manual targets on AND protein not yet met?
  → GUIDE — protein remaining, framed as opportunity. STOP.
  Manual targets on AND protein met AND calories nearly met?
  → GUIDE — close-out nudge ("lean protein if still hungry" style). STOP.
  No targets set, or everything already met?
  → continue.

STEP 4 — Celebrate (same-day completion, steady-state)
  Protein AND calories both met today, AND this has not already been
  shown once already today?
  → CELEBRATE — same-day completion. STOP.
  → otherwise: continue.

STEP 5 — Reinforce (weekly only in Sprint 01)
  Distinct days logged this week > distinct days logged last week?
  → REINFORCE — weekly improvement. STOP.

  0a/0b — Milestones and Monthly Reinforce: NOT IMPLEMENTED in Sprint 01.

STEP 6 — Silence
  Nothing above applied. Show nothing. Expected majority outcome on any
  steady-state day — not a failure of the system, the system working.
```

**Repetition guard, simplified from the prior revision:** Step 4 no
longer compares against yesterday's state — it only needs "has this
already been shown once today," tracked locally. A genuine same-day
completion is real and worth acknowledging every day it happens; the
thing to guard against is showing it more than once *within* the same
day, not across days.

---

## Challenging the Behavior Engine

Three real conflicts, not cosmetic ones:

**1. The three-tier intensity system (Behavior Engine §3 preamble,
"Tier 1/2/3") is now redundant.** The Celebrate-vs-Reinforce split *is*
the intensity system — Reinforce (a number) is inherently the stronger
form, Celebrate (an announcement) the lighter one. Keeping both the old
tier labels and the new four-purpose split means every message needs
double-tagging for the same underlying idea. **Recommendation: drop Tier
1/2/3 language from Behavior Engine; use Celebrate/Reinforce/Guide/Recover
as the only intensity signal.**

**2. Behavior Engine §6's explicit frequency caps ("max 3 Tier-2+ per
week") are now structurally unnecessary.** A decision tree that produces
exactly one output per session, where Reinforce can only fire on specific
calendar days and Milestone can only fire once per threshold ever,
already enforces frequency by construction — a standalone numeric cap is
bookkeeping for a problem the architecture no longer has. The one gap
this exposed: same-day Celebrate *could* repeat daily if a user hits both
targets every day, which the old numeric cap would have caught by
accident. **That's the actual reason Step 4 above needs its own explicit
repetition guard — not because the general cap is missing, but because
Celebrate specifically has no other source of freshness the way Reinforce
does (Reinforce's content changes by definition; Celebrate's doesn't).
Recommendation: delete the general weekly numeric cap from Behavior
Engine §6; keep only the targeted Celebrate repetition guard now
specified in Step 4.**

**3. The old 8-field-per-message template (Trigger, Goal, Emotion,
Frequency, Priority, Max display, Suppression, Variations) has three
fields — Frequency, Priority, Max display — that are now fully determined
by *where a message sits in the decision tree*, not by anything specific
to the message itself.** Specifying them again per-message risks drifting
out of sync with the tree that actually governs them. **Recommendation:
for implementation, use a leaner 4-field template per message going
forward — Trigger (which leaf), Goal, Emotion before → after, Variations
— and treat the decision tree as the single source for frequency and
priority. Behavior Engine's existing 24-entry catalog doesn't need to be
rewritten; just read its Frequency/Priority/Max-display fields as
historical context, not active rules — the tree in this document
supersedes them.**

No conflict found in: the four-gap Recovery model, the Next Action
Engine's ordering, the never-shame/never-mention-streak rules, or the
Freshness rotation mechanism — all of that carries forward unchanged.
