# KainFit Behavior & Coaching Engine

Specification only — no code. This is the reference every future coaching
feature should be built against, so decisions made once don't get
re-litigated. Voice and color conventions here match what's already shipped
(Taglish companion lines, teal primary, amber reserved for clarification —
never repurposed for praise or warning).

Last updated: 2026-07-23.

**Superseded by `.lovable/evidence-engine.md` for implementation.** This
document remains the source for message *wording and voice* (the catalog
below, its Taglish variations, the tone examples). For *when anything
fires at all* — frequency, priority, the decision tree — defer to
evidence-engine.md, not the notes in §3's Tier 1/2/3 labels or §6's
numeric weekly caps below; both are kept here as historical context only,
not active rules.

---

## 1. Core Philosophy

KainFit exists to reduce decision fatigue, not add to it. The coaching
layer is not a feature bolted onto the logging loop — it lives *inside* the
existing north star and must never slow it down:

> Open app → Log food in seconds → Instantly know where you stand → Close app.

Every coaching moment answers one implicit question for the user: **"Am I
doing okay?"** The honest answer is almost always yes, and the app's job is
to say so credibly, briefly, and only when it's true. A user should close
the app more confident than when they opened it — not entertained, not
gamified, just quietly more sure of themselves.

The tone model is a calm, competent coach who has seen a thousand people
build this habit and knows what actually matters: showing up again, not
perfection on any single day.

---

## 2. Behavioral Principles

**Never:** shame, punish, guilt, create anxiety, manufacture FOMO or fake
urgency, stack notifications, or interrupt the logging flow itself with a
coaching message. A coaching message must never appear *between* typing a
food and seeing it land in the log — it appears after, or on a separate
screen (Today's header, end-of-day, next-day open).

**Always celebrate:** effort, consistency, progress, recovery, returning
after absence, promises kept, better decisions, momentum. Note what's
missing from that list on purpose: *perfection*. KainFit never celebrates a
"perfect" day differently from a "good enough" day — that framing is
exactly what creates the anxiety this system exists to avoid.

**Why this works, not just what it is:** identity-based habit change
(showing someone evidence that they're already becoming the person they
want to be) reliably outperforms outcome-based praise, and self-compassion
after a lapse predicts *better* long-term adherence than guilt does — a
user who feels safe coming back after missing three days comes back more
reliably than one who fears judgment for it. Every rule below is downstream
of those two facts.

---

## 3. Message Categories

Each entry defines: **Trigger · Goal · Emotion before → after · Frequency
· Priority · Max display · Suppressed when · Variations.** Intensity tier
noted per message — praise scales with the achievement, never flat.

**Intensity tiers** (referenced throughout):
- **Tier 1 — Quiet acknowledgment.** A small UI detail, not a message.
  No words required most of the time.
- **Tier 2 — Warm note.** One short line, easy to miss if you're not
  looking for it. Most coaching lives here.
- **Tier 3 — Real celebration.** Reserved for milestones. Still calm —
  never confetti-and-fireworks, just unmistakably warmer.

### 3.1 First log of the day
- **Trigger:** first successful save, current Manila day, user already has
  history (not their first-ever log — see 3.2).
- **Goal:** confirm the day has started well, without implying anything
  was wrong about not logging earlier.
- **Emotion before → after:** neutral/slightly unsure → settled.
- **Frequency:** once/day. **Priority:** low. **Tier:** 1.
- **Max display:** 1/day. **Suppressed when:** user already saw a
  same-day coaching message (see §6 priority stacking).
- **Variations:** "Logged." / "Day's started." / "First one's in." — often
  no message at all; the totals card updating is usually enough.

### 3.2 First log ever
- **Trigger:** the very first successful save on the account.
- **Goal:** confirm the core mechanic worked and it was easy.
- **Emotion before → after:** uncertain whether it "worked" → reassured.
- **Frequency:** once, lifetime. **Priority:** high (this is activation).
- **Tier:** 2. **Max display:** 1 ever.
- **Already shipped:** this is the first-automatic-save explainer toast
  built 2026-07-22 — this spec formalizes what was already built.
- **Variations:** N/A — one-time, no repetition risk.

### 3.3 Returning after missing 1 day
- **Trigger:** a log lands where the previous logged day was 2 calendar
  days ago (one full day skipped).
- **Goal:** make a single missed day feel completely unremarkable.
- **Emotion before → after:** faint self-consciousness → none.
- **Frequency:** as triggered. **Priority:** low. **Tier:** 1 — often no
  message at all; a 1-day gap should barely register as an event.
- **Max display:** 1 per gap. **Suppressed when:** user's overall
  consistency this month is already low (don't draw attention to a pattern
  by narrating each instance of it — see §9).
- **Variations:** usually nothing. If anything: "Welcome back." — flat,
  warm, no reference to the gap itself.

### 3.4 Returning after missing 3 days
- **Trigger:** gap of 3–6 calendar days.
- **Goal:** actively signal that nothing was lost.
- **Emotion before → after:** hesitation about re-opening the app →
  relief that it's still simple.
- **Frequency:** as triggered. **Priority:** medium. **Tier:** 2.
- **Max display:** 1 per gap.
- **Never mention:** the gap length, a broken streak, or "getting back on
  track" (implies they fell off one).
- **Variations:** "Good to see you — let's log what you've got." /
  "Walang problema, tuloy lang." (no problem, just continue) / "Same as
  always — type what you ate."

### 3.5 Returning after missing 7 days
- **Trigger:** gap of 7–29 days.
- **Goal:** lower the re-entry barrier as much as possible; a week away
  is exactly when shame typically peaks and drives permanent churn.
- **Emotion before → after:** meaningful hesitation, possibly
  embarrassment → genuine relief.
- **Frequency:** as triggered. **Priority:** high. **Tier:** 2, warm end
  of the range.
- **Max display:** 1 per gap.
- **Never mention:** the week, a streak, "restarting," or "starting over"
  — "starting over" implies something was lost that needs replacing.
- **Variations:** "Good to have you back — nothing to catch up on, just
  log today." / "Kahit saan ka nagsimula, simula lang ito." (wherever
  you're starting from, this is just a start.)

### 3.6 Returning after missing 30+ days
- **Trigger:** gap of 30+ days.
- **Goal:** treat this identically to a brand-new user's first session in
  every way that matters — zero friction, zero history required.
- **Emotion before → after:** likely assumes the account/data is stale or
  that returning "doesn't count" → discovers it's exactly as easy as day one.
- **Frequency:** as triggered. **Priority:** high. **Tier:** 2 — calm, not
  a "welcome back!" cheer, which would feel performative after a month.
- **Max display:** 1 per gap.
- **Never mention:** the length of absence in any specific terms ("a
  month," "30 days"). Never show a resumed streak count starting at the
  old number or at zero with fanfare — just start counting again silently.
- **Variations:** "Good to see you. Same as before — type what you ate."
  That's it. Understatement is the correct register here, not warmth.

### 3.7 Consistent logging (ongoing streak)
- **Trigger:** the streak badge itself (already shipped) is the Tier-1
  version of this. A Tier-2 note is reserved for round numbers that feel
  earned, not arbitrary: 3, 7, 14, 30 days.
- **Goal:** reinforce identity ("I follow through"), not the number itself.
- **Emotion before → after:** unaware of the pattern → aware and proud of it.
- **Frequency:** at threshold crossings only, not daily.
- **Priority:** medium. **Tier:** 2 at 3/14 days, 3 at 7/30 days.
- **Max display:** once per threshold, lifetime (don't re-fire if the
  streak breaks and rebuilds to the same number — see §7).
- **Suppressed when:** same day as a 7-day/30-day/monthly summary (pick
  the bigger moment, not both).
- **Variations at 7 days:** "7 days of showing up. That's not luck — kaya
  mo talaga 'to." (you can really do this) / "One week in. This is what
  consistency actually looks like." At 3 days: quieter — "Three in a row."

### 3.8 Improved consistency (this week vs. last week)
- **Trigger:** computed weekly, Monday morning Manila time: this week's
  logged-day count exceeds last week's.
- **Goal:** show a trend, not a single day — trends are more durable
  motivators than daily wins.
- **Emotion before → after:** unaware of the trajectory → aware it's
  moving the right direction.
- **Frequency:** weekly, only on improvement (never on decline — a
  decline is not narrated, see §9).
- **Priority:** medium. **Tier:** 2.
- **Max display:** 1/week. **Suppressed when:** first week on the app
  (no prior week to compare).
- **Variations:** "You logged more days this week than last. That's the
  direction that matters." / "Mas madalas ka ngayong linggo — panatilihin
  mo." (more often this week — keep it going.)

### 3.9 Protein target completed
- **Trigger:** `totals.protein >= target_protein_g` for the first time
  that day, manual targets enabled.
- **Goal:** close-the-loop satisfaction on a specific, concrete win.
- **Emotion before → after:** tracking mid-progress → done, satisfied.
- **Frequency:** once/day, only if it happens. **Priority:** low-medium.
- **Tier:** 1 — a badge/checkmark on the macro pill, not a popup message.
- **Max display:** the visual state persists for the rest of the day, no
  repeat toast.
- **Variations:** N/A — this is a state change, not copy.

### 3.10 Calories on target
- **Trigger:** end-of-day (or on-demand view), totals within a reasonable
  band of target (e.g., ±5%).
- **Goal:** validate that "close" is success, not "exact."
- **Emotion before → after:** uncertain if today "counted" → confirmed
  it did.
- **Frequency:** as applicable. **Priority:** low. **Tier:** 1–2.
- **Variations:** "Right where you wanted to be today." / "Malapit sa
  target — solid." (close to target — solid.)

### 3.11 Calories exceeded
- **Trigger:** totals meaningfully over target.
- **Goal:** the single highest-risk message in this entire system to get
  wrong. Must carry zero judgment. Ideally: no message at all, just
  neutral numbers with no color-coded alarm (no red totals, no exclamation
  framing).
- **Emotion before → after:** must not create guilt where none existed.
- **Frequency:** never as a proactive message. **Priority:** N/A — this
  category should almost always be *silence*, not copy.
- **Rule:** if anything is ever shown here, it must be identical in tone
  to a normal day — "Logged for today." No commentary on the number
  itself. Over-target framing is the fastest way to make an app feel like
  a diet app instead of a tracking tool, and diet-culture tone is an
  explicit anti-goal for this product.
- **Variations:** none by design — this is the one category to actively
  resist writing more copy for.

### 3.12 Better than yesterday
- **Trigger:** any positive, specific comparison (more consistent macro
  hit, logged earlier in the day, fewer estimated/AI-fallback items).
- **Goal:** small, specific, believable comparisons beat vague praise.
- **Frequency:** opportunistic, not daily (would become noise).
- **Priority:** low. **Tier:** 1–2. **Max display:** roughly 2–3/week cap
  system-wide, shared with 3.8 and 3.13 (see §6 total budget).
- **Variations:** "Faster log than yesterday." / "Less guessing today —
  more of this was verified."

### 3.13 Better than last week / personal bests
- **Trigger:** any all-time or recent-window record (longest streak,
  most consistent week, most verified-vs-estimated ratio).
- **Goal:** genuine, rare, specific — the credibility of this category
  depends on it being uncommon.
- **Frequency:** as triggered, expected to be infrequent. **Priority:**
  medium-high when it happens. **Tier:** 2–3 depending on magnitude.
- **Max display:** once per distinct record.
- **Variations:** "Your most consistent week yet." / "Best streak so
  far — 12 days." Numbers only when they're real records, never rounded
  up or softened to sound more impressive.

### 3.14 Weekly summary
- **Trigger:** first open of the week (Monday Manila time), or a
  dedicated "This week" view if built.
- **Goal:** replace "did I do well" anxiety with a plain factual mirror.
- **Content:** days logged, not calories/macros graded pass-fail. No
  score, no letter grade, no color-coded verdict.
- **Frequency:** weekly. **Priority:** medium. **Tier:** 2.
- **Max display:** 1/week, dismissible, never blocking.
- **Variations:** rotate framing — "5 of 7 days this week." /
  "You showed up 5 times this week." Same fact, different phrasing so it
  doesn't read as a templated report card.

### 3.15 Monthly summary
- **Trigger:** first open of a new calendar month.
- **Goal:** zoom out far enough that individual off-days disappear into
  the trend — this is the view most likely to make someone feel like the
  habit is real.
- **Frequency:** monthly. **Priority:** medium. **Tier:** 2–3.
- **Max display:** 1/month.
- **Variations:** "You logged X days this month." / framed around
  identity when the number is strong: "That's a month of showing up."

### 3.16 Milestone moments
- **Trigger:** cumulative totals crossing round numbers — 7, 30, 100, 365
  total days logged (not necessarily consecutive — total logged days is a
  kinder, more inclusive milestone than pure streak, since it still counts
  progress across gaps).
- **Goal:** mark real, rare accomplishments distinctly from routine praise.
- **Frequency:** rare by construction. **Priority (locked 2026-07-23):**
  lowest of all categories, not highest — never interrupts Recovery or
  Guide; may be delayed to a later session rather than shown immediately.
  Deferred entirely from the Sprint 01 implementation. **Tier:** 3, every
  time it does show.
- **Max display:** once per threshold, lifetime.
- **Suppressed when:** Recovery or Guide would otherwise apply — shown
  only once nothing higher-priority is true, even if that means waiting
  for a later session.
- **Variations:** "100 days logged. However they went — that's real
  consistency." Identity-forward at bigger numbers: "This isn't a
  streak anymore. It's just who you are now."

### 3.17 Onboarding
- **Trigger:** account creation, first arrival on Today.
- **Goal:** zero friction, zero coaching — earn the right to coach later
  by first proving the core loop works. (Matches the already-shipped
  decision to cut the personal questionnaire entirely.)
- **Frequency:** once. **Priority:** N/A. **Tier:** 0 — deliberately no
  coaching message here at all. The empty state + rotating examples
  already do this job; adding a welcome message would be the first thing
  this document explicitly warns against — coaching before there's
  anything to coach.

### 3.18 Finishing the day
- **Trigger:** heuristic close-of-day (e.g., app opened after 9pm Manila
  with entries already logged, or explicit if a "done for today" action
  ever exists).
- **Goal:** give the day a soft, deliberate ending instead of just
  trailing off.
- **Frequency:** at most 1/day. **Priority:** low. **Tier:** 1–2.
- **Variations:** "That's today. Same time tomorrow." — calm, not
  triumphant, doesn't require the day to have gone any particular way.

### 3.19 Reopening tomorrow
- **Trigger:** first open of a new Manila calendar day.
- **Goal:** make tomorrow feel like a continuation, not a fresh test to
  pass or fail.
- **Frequency:** daily, but Tier 1 — usually just the date/greeting
  already shown, not additional copy.
- **Variations:** the existing "Magandang umaga/hapon/gabi" greeting
  already serves this function well; no expansion needed here.

### Additional categories (lighter-touch spec, per "find every meaningful moment")

- **3.20 Editing an entry.** Trigger: any manual correction. Goal:
  frame correction as engagement, not failure. Never say "fixed" or
  imply an error was made — "Updated." is sufficient. Tier 1, no praise
  needed at all, just don't make it feel like an apology is owed.
- **3.21 Reusing a saved meal / quick-log.** Trigger: any Recent/
  Favorite/My-Meal tap. Goal: reinforce that they've made their own life
  easier. Tier 1, occasional Tier 2: "You've made this quick for
  yourself." Max 1–2/week — this shouldn't fire every single tap.
- **3.22 Setting a manual target for the first time.** Trigger: first
  save of manual targets. Goal: mark a real commitment moment. Tier 2,
  once: "Targets set. KainFit will show you where you stand — the
  decisions stay yours."
- **3.23 First voice log.** Trigger: first successful voice-input save.
  Goal: capability discovery. Tier 1: no message needed beyond the save
  succeeding — the feature proving itself is the reward.
- **3.24 Weekend consistency.** Trigger: Sat/Sun logging when weekday
  logging is already established. Goal: many trackers see structural
  weekend drop-off; this is a moment to actively *not* comment on
  (silence is correct here — praising "even on a weekend" implies
  weekends are naturally an exception, which reinforces the very
  drop-off pattern being avoided). Documented specifically so nobody
  builds this message later by accident.

---

## 4. Trigger Matrix

| Trigger event | Category | Priority | Tier | Surface |
|---|---|---|---|---|
| Signup completed | Onboarding | — | 0 | none |
| First-ever save | First log ever | High | 2 | toast |
| Daily first save | First log of day | Low | 1 | none/subtle |
| Protein target hit | Macro completion | Low–Med | 1 | pill state |
| Calories in range | On-target | Low | 1–2 | totals card |
| Calories over | Over-target | — | — | silence |
| Streak day 3/7/14/30 | Consistency | Med–High | 2–3 | banner |
| Gap 1 day, new log | Recovery-1 | Low | 1 | none/subtle |
| Gap 3–6 days, new log | Recovery-3 | Med | 2 | banner |
| Gap 7–29 days, new log | Recovery-7 | High | 2 | banner |
| Gap 30+ days, new log | Recovery-30 | High | 2 | banner |
| Week better than last | Trend | Med | 2 | Monday card |
| New personal record | Personal best | Med–High | 2–3 | banner |
| Monday open | Weekly summary | Med | 2 | card |
| 1st-of-month open | Monthly summary | Med | 2–3 | card |
| 7/30/100/365 total days | Milestone | Highest | 3 | full-screen-light moment |
| Late-evening open w/ entries | End of day | Low | 1–2 | subtle |
| New-day open | Greeting | — | 1 | existing greeting |
| Manual edit saved | Edit | — | 1 | toast |
| Quick-log reuse | Efficiency | Low | 1 (occ. 2) | toast |
| Manual targets first set | Commitment | Med | 2 | toast |

---

## 5. Priority System

**Locked 2026-07-23 — see `.lovable/evidence-engine.md` for the
authoritative version and full justification; this section is kept in
sync, not restated independently.** Only **one** coaching message may
surface per app open / per screen, resolved in this order:

1. Recovery — outranks everything.
2. Guide — the everyday default; deliberately outranks Celebrate and
   Reinforce, since most sessions should end in guidance, not praise.
3. Celebrate — subject to a short-lived transient override (see
   evidence-engine.md) that lets a just-completed achievement briefly
   jump ahead of Guide in the moment it happens, without changing this
   standing order.
4. Reinforce — weekly only in the first implementation; monthly deferred.
5. Milestones — deferred entirely from the first implementation; never
   preempts Recovery or Guide even once built, may be shown a session
   later rather than interrupting anything above it.
6. Silence — the default outcome most days.

A missed macro target, an over-target day, or a broken streak never enter
this priority queue at all — they are not trigger-worthy events under
this system, by design.

---

## 6. Frequency Rules

- **Hard cap: 1 coaching message (Tier 2 or 3) per app session.** Tier-1
  ambient state (pill colors, streak badge) doesn't count against this.
- **Soft cap: no more than 3 Tier-2+ messages per week**, tracked
  per-category so no single category (e.g., "better than yesterday")
  can consume the whole budget.
- **Milestones and Recovery-7/30 are the only categories allowed to
  exceed the weekly cap** — they're too rare and too important to be
  crowded out by routine ones.
- **Never two messages in the same 30-second window** — if a save
  triggers both a macro-completion state change and (hypothetically) a
  streak threshold, the priority system in §5 already prevents this, but
  this is the hard backstop.
- **Never during the logging flow itself** — no coaching message may
  appear between text submission and the entry landing in the log. Praise
  belongs to the totals card and header, never the input/review screens.

---

## 7. Freshness Rules

"Fresh, not random." Each message category needs a rotation pool of 3–5
variants (English-primary, Taglish-companion, matching what's already
shipped for the tagline and empty states). Selection rule:

- Track the last 2 variants shown per category (small local flag,
  matching the existing `kf.*` localStorage pattern already used for
  first-save and first-touch tracking) and exclude them from the next
  pick — guarantees no immediate repeat without needing true randomness.
- Selection should still be **context-aware**, not just round-robin:
  a 7-day streak message should never randomly draw from the 30-day
  pool's more intense variants, even if the pools share a rotation
  mechanism.
- If a streak breaks and later re-crosses the same threshold (e.g., hits
  7 days again after a gap), treat it as a **new instance** for rotation
  purposes but do not re-fire the "first time hitting 7" framing — that
  specific variant is reserved for the true first occurrence, tracked
  separately from the rotation pool.

---

## 8. Identity Reinforcement

Used sparingly — identity claims are the strongest tool in this system
and lose all power if they show up daily. Reserve for **Tier 3 moments
only** (milestones, rare personal bests, 7+/30+ day recovery welcomes).

Correct pattern: name the behavior, then let the identity conclusion be
implicit or stated once, briefly — never repeated in the same message.

- Not: "Great job!" → Instead: "That's 30 days of following through. This
  isn't a streak anymore — it's just who you are now."
- Not: "You're on fire!" → Instead: "You keep showing up. That's the
  whole game."
- Not: "Amazing consistency!" → Instead: "Kaya mo talaga 'to." (you can
  really do this) — identity reinforcement can live entirely in the
  Taglish companion line without needing a separate English identity
  statement, which keeps the English primary line factual and the
  emotional weight in the voice that already carries KainFit's warmth.

Never stack two identity statements in one message. Never use identity
language for routine, Tier-1 moments — it should feel earned, not
default copy.

---

## 9. Next Action Engine

Every app open answers exactly one question: **"What's the next easiest
win?"** Exactly one action surfaces, chosen by this decision order (first
match wins, evaluated fresh each open):

1. **Recovery** — if returning from a 3+ day gap, the next action is
   always just "log something," full stop. No macro-specific suggestion
   competes with re-entry itself.
2. **Protein remaining** — if manual targets are on and protein is the
   furthest-behind macro relative to time-of-day-adjusted expectation,
   surface it. (Already shipped as the "Xg protein to go" nudge —
   this formalizes it as the Next Action Engine's default case.)
3. **One meal left** — if it's evening and fewer than 3 meals are logged,
   suggest closing out the day rather than a specific macro.
4. **Calories remaining** — if protein is already met but calories are
   meaningfully under target, surface this instead (avoid encouraging
   someone to eat more than they want just to "complete" a number they
   don't care about).
5. **Nothing required** — if targets are met or no targets are set and
   the day is on a normal trajectory, the correct next action is
   explicitly *nothing*. This state must exist and must not feel like a
   missing feature — "You're set for today" is a valid, complete answer.
6. **Rest** — reserved for a future state (see §11) where the app has
   enough signal to recognize a deliberate rest/off day and actively
   discourage forced logging rather than defaulting to silence.

**Hard rule:** never surface more than one of these at once, and never
phrase any of them as a deficit ("You're behind on protein") — always as
an opportunity ("Xg protein would round out today nicely").

---

## 10. Recovery Engine

Full specification for re-entry after absence, expanding §3.3–3.6 into a
single reference. The governing rule across every gap length: **progress
resumes immediately and silently.** The user's totals, streak-eligibility,
and Next Action all recalculate as if the gap were simply time passing —
never as a reset event that needs acknowledging as a reset.

| Gap | Tone | Mentions the gap? | Message |
|---|---|---|---|
| 1 day | Unremarkable | Never | Usually nothing; at most a flat greeting. |
| 3–6 days | Warm, brief | Never explicitly | "Good to see you — let's log what you've got." |
| 7–29 days | Warm, reassuring | Never explicitly | "Nothing to catch up on. Just log today." |
| 30+ days | Calm, understated | Never, ever | Treated identically to a new user's first return session. |

Explicitly forbidden across all four tiers: any reference to a lost
streak, a "restart," a countdown of days missed, or comparative language
("it's been a while!"). The single test for any recovery copy: would this
sentence make sense to someone who has *never* missed a day? If not,
rewrite it.

---

## 11. Future Expansion Ideas

Not specified in detail here — flagged for later, consistent with
existing deferred decisions elsewhere in this repo's launch checklist:

- **Deliberate rest-day detection** — distinguishing "forgot to log" from
  "chose not to eat structured meals today" (fasting, travel, illness),
  so the Next Action Engine can suggest rest instead of defaulting to
  silence. Needs real usage data before it's worth building.
- **Time-of-day pattern learning** — adjusting "one meal left" and
  protein-remaining nudges to an individual's actual eating schedule
  rather than fixed hour bands.
- **Push notifications carrying these messages** — explicitly deferred
  elsewhere (needs real infrastructure investment and evidence the
  activation problem is solved first); this document defines the message
  content so that work is ready to consume whenever notifications ship.
- **Habit-stacking suggestions** — "you usually log breakfast around
  this time" — requires more history than most accounts will have during
  beta; premature now.
- **Shared/social accountability** — explicitly rejected earlier as
  premature (see launch checklist); if ever revisited, it must be
  opt-in and must not introduce comparison-based framing, which would
  violate the never-shame principle at the core of this entire document.
