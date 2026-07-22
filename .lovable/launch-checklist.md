# KainFit Launch Checklist

Living document. Update after every meaningful PR. This exists so decisions
made once don't get re-litigated from scratch later — if something looks
missing or wrong, check "Rejected / Deferred" before re-opening it.

Last updated: 2026-07-22.

## Must Ship Before Beta

- [x] Real account deletion (was: false claim in the confirm dialog, only
      deleted 3 of 8+ relevant tables, never removed the `auth.users` row).
      Fixed via `deleteOwnAccount` server function + cascade/SET NULL
      already correctly defined in the schema.
- [x] Two silent analytics-tracking bugs: `recent_item_reused` /
      `favorite_used` / `saved_meal_reused` all logging under one event
      name; four Scale Guide funnel events silently rejected by the
      database's event allow-list since the feature shipped.
- [x] `save_mode` and `explainer_shown` properties silently stripped from
      several events by a property-level allow-list gap (same bug class,
      one layer down).
- [ ] Verify Tagalog/Taglish voice input actually transcribes correctly —
      flagged early, needs a live device test, still unverified.

## Should Ship Before Public Launch

- [x] Consolidated 4 duplicated admin-authorization checks into one
      shared `admin-guard.server.ts` helper.
- [x] Logging streak (Today header) — first retention mechanic in the
      product; previously nothing brought a user back tomorrow.
- [x] First-automatic-save explainer toast (first-ever save only) —
      targets the hypothesis that users aren't sure an auto-save worked.
- [x] History delete now has Undo + fires `food_deleted`, matching Today
      (previously irreversible with zero analytics).
- [x] CSV export fixed — numeric columns were exporting as quoted text
      (`"150"` instead of `150`).
- [x] Bilingual/Taglish companion copy: tagline (landing + auth headers),
      empty states (Today, History). Primary UI stays English; Taglish is
      a secondary voice layer, not a translation system.
- [x] Touch targets on Recent/Favorites rows brought up to ~40×40px
      (Favorite star had _no_ explicit sizing before — effectively
      ~16×16px); fixed a stale "long-press the pencil" instruction that
      didn't match the actual (tap) behavior.
- [x] Saved meals now auto-name from their actual contents instead of a
      time-of-day guess or a blank field.
- [x] Removed metric/imperial toggle from Profile — confirmed zero
      downstream consumers before removing; target market uses metric.
- [ ] Delete a saved meal (Workstream 1, PR 1b) — no affordance exists
      today, same row-action pattern as Favorites' toggle.
- [ ] Rename a saved meal after creation (Workstream 1, PR 1c) — naming
      before first save already works; there's no way to rename later.
- [ ] Protein-remaining nudge shipped ("Xg protein to go — kaya mo yan!")
      — reuses existing totals/target data, zero new queries.
- [ ] Generic rage-tap detector (`noteTapForRageDetection`) shipped and
      wired into the two touch-target fixes above, as a baseline. Not
      expanding coverage further until this produces real signal.

## Nice to Have

- Weekly/monthly trend view in History (retention reinforcement,
  deliberately not built yet — see Deferred).
- Referral/share mechanic (nothing exists today; cheapest PH growth
  channel is currently unaddressed).
- Bilingual success toast and primary CTA copy (Workstream: bilingual
  PR #2/#3) — needs founder sign-off on exact phrasing before shipping,
  higher-stakes than the empty-state copy already shipped.
- Smart Favorites (automatic "you eat this often" detection) —
  deliberately sequenced after manual Saved Meals has real usage data.

## Technical Debt

- **`foodStatus()` (`src/lib/food-display.ts`) doesn't fully implement its
  own documented contract.** Discovered 2026-07-22 while running the test
  suite for the first time ever in this environment (no CI, and Bun
  wasn't even installed locally until tonight — see below). Two bugs
  tangled together: (1) the function's own doc comment says preparation
  `"estimated"` should get a preparation-aware label, but `knownPreps`
  doesn't include `"estimated"`, so it silently falls back to a generic
  "standard preparation" label — losing the "this was estimated" signal
  the UI is supposed to show. (2) `recalc.test.ts` has a stale assertion
  expecting a plain `"Verified"` label for raw/cooked items, but the
  actual (and doc-comment-intended) behavior is the more detailed
  "Verified food · raw weight" — the test predates a real behavior
  change and was never updated. Pre-existing, unrelated to any change
  made 2026-07-22; not fixed same day since it wasn't part of that
  night's actual diff. Needs its own small, focused fix: add
  `"estimated"` to `knownPreps`, then correct the stale test assertion.
- **No CI, and the test suite had apparently never been run in this
  local environment before 2026-07-22** — Bun wasn't installed until
  that session. This is exactly the kind of thing a basic CI check (lint
  + typecheck + test on push) would have caught the day it was
  introduced instead of however long it actually sat there.
- **Two competing food-catalog schemas** (`verified_foods` vs
  `food_records`). Deterministic today (food_records checked first,
  verified_foods as fallback) so not causing wrong answers, but doubles
  the data-entry burden and risks drift over time.
- **`searchFoods`** (`food-catalog.functions.ts`) — 631 lines, zero live
  callers, kept intentionally dormant. Backs the planned Stage 5 "change
  match" search flow (see `.lovable/plan.md`). **Has a real, currently
  dormant input-handling bug** (unescaped comma/paren in a PostgREST
  filter string) — full ticket is the code comment directly above
  `searchFoods`. Must be fixed before that function is ever wired into a
  UI, not before.
- Unbounded admin-dashboard queries (`getBetaMetrics`, `exportBetaCsv`,
  `getSignupFunnel`) — `select("*")` with no limit/date window. Fine at
  current volume; revisit once `product_events` crosses roughly
  50–100k rows.
- `ai_call_timing`, `db_query_timing`, `error_boundary`,
  `food_calc_timing`, `food_save_timing`, `route_load_timing` exist in
  the server-side event allow-list but nowhere else (not in the client
  `EventName` type, not called anywhere) — leftover from an earlier
  telemetry design, likely renamed. Dead weight, not a bug.
- `preferred_units` database column is now unused (client-side removed
  2026-07-22) but not dropped — dropping a column is a higher-risk
  migration category than removing the code that read it; do both in
  one pass later if it's worth a migration on its own.
- `food-scale.ts` deleted (was dead code, zero callers, zero relation to
  `QuickLogRail`'s similarly-named but functionally different local
  `scaleMacros`, despite an earlier, incorrect claim that they were
  duplicates).

## Experiments

- **Activation drop-off location** — "Post-signup activation" funnel
  panel now live on the founder dashboard (signed up → submitted a food
  → got a result → saved it). Built, not yet read. This is the highest-
  priority open question in the entire product.
- Hypothesis: a first-time user's literal first entry (a weighed meat/
  grain/fish with no prep word) triggers a raw/cooked clarification that
  breaks the "Instantly" promise before anything saves. Unconfirmed —
  needs the SQL query documented a few sessions back (compare same-day
  confirm rate for first parses that needed clarification vs. didn't).
- Rage-tap data on the two just-fixed touch targets — will tell us
  whether the sizing fix actually mattered, once there's enough volume.

## Rejected / Deferred

- **History "edit any field" parity with Today** — ran through a full
  Decision Review; consequence of doing nothing was "almost nothing"
  (no evidence of harm, low-frequency action, safe workaround already
  exists via delete+undo+retype). Rejected. Don't re-propose without new
  evidence.
- **Long-press action menu on Recent/Favorite rows** (Favorite/Save as
  Meal/Edit/Remove) — a long-press is strictly slower than the direct
  taps it would replace for 2 of the 4 actions, doesn't map cleanly onto
  Recent's data model (no "remove a computed-from-history item" concept
  exists), and "Remove" would be redundant with the existing Favorite
  toggle on the Favorites tab. Fixed the actual evidenced problem
  (touch-target size) directly instead.
- **Smart Favorites (automatic detection)** — not rejected, deliberately
  sequenced last. Automating on top of a manual feature that hasn't
  accumulated real usage yet is premature; revisit once Saved Meals
  (manual) has real data.
- **Daily push notifications** — real infrastructure investment (service
  worker, permission UX, scheduling), and iOS Safari only supports web
  push for an installed home-screen PWA, not a regular tab — a real
  platform gap for part of the target market. Deferred in favor of the
  cheaper, more universal email-reminder path, which itself is deferred
  further behind the activation question.
- **Scheduled email reminders** — reversed mid-session. Cheaper and
  safer than push, but still unjustified until the activation question
  (why do ~60% of signups never log a food) is actually answered —
  building a return-loop feature before confirming _why_ people leave in
  the first place risks solving the wrong problem.
- **`entry_edited` instrumentation** — reasonable in isolation (closes a
  real measurement gap for a hypothetical future editing question), but
  still local optimization one level up. Not built. The unresolved
  question that actually matters is activation, not editing frequency.
- **A full i18n/translation system** — explicitly rejected in favor of
  curated Taglish copy in specific high-value spots. Avoids the
  maintenance cost of a translation framework neither the team size nor
  the current evidence justifies.
- **Full-file deletion of `searchFoods`** — reversed after a Final
  Deletion Audit found it backs an explicitly planned roadmap stage
  (Stage 5, "change match"). See Technical Debt above for the one thing
  that _does_ need to happen before it's ever wired up.
