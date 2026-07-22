# KainFit "Under 10 Seconds" Sprint

Delivered in small, testable stages. After each stage I'll verify logging, editing, delete, daily totals, history, and auth still work on mobile widths before moving on.

## Stage 0 — Audit (no code)

- Read: `today.tsx`, `history.tsx`, `food.functions.ts`, `food-records.server.ts`, `verified-foods.server.ts`, `food-catalog.functions.ts`, `beta.functions.ts`, `admin.beta.tsx`, `saved_foods` schema, `food_records` schema, existing indexes.
- Confirm what already exists (a lot does: verified DB, parse cache, ai-guard, funnel events, perf telemetry, auto-save + Undo, swipe delete, manual targets) so we only build the gaps.
- Output: short gap list before Stage 1 code.

## Stage 1 — Instant logging (optimistic UI + tap protection)

- `today.tsx`: on "Add to Today", insert a temp row into local log + bump totals immediately; reconcile on server ack; on failure roll back and toast "Couldn't save — Retry".
- Disable Add button only while its request is in flight (per-item, not global).
- Kill any remaining "Calculated" frozen state / full-page spinners in the log path.
- Verify: tap→visual feedback under 500ms on throttled 3G in devtools.

## Stage 2 — Repeat-logging rail (Recent / Favorites / My Meals)

- New compact row above the input on Today: three chips.
- **Recent**: last ~10 distinct confirmed items from `food_entries` for this user (already indexed).
- **Favorites**: new `is_favorite` flag on `saved_foods` (already exists as table) + star toggle on log rows.
- **My Meals**: new `saved_meals` table (name + items[] jsonb). "Save this meal" action from Today's current log; one-tap add-all with a grams tweak sheet.
- Migration: `saved_meals` (user_id, name, items jsonb, created_at, updated_at) with RLS + GRANTs; index on (user_id, updated_at desc).
- All three paths bypass AI (count as DB matches, not AI quota).

## Stage 3 — Cooked/raw memory & clarification hygiene

- Persist `prep_state` ('cooked'|'raw'|'not_sure') on the log entry when the user answers; do not re-show the yellow box for that entry.
- "Not sure" → deterministic middle estimate, label the row **Estimated from typical preparation**.
- Only prompt when the verified food's cooked vs raw ratio would shift kcal >~10%.

## Stage 4 — Trust labels

- Compute one label per resolved item from existing fields:
  - `KainFit Verified` (verified=true, source in philfct/manual-verified)
  - `Brand Label` (source manufacturer/restaurant + brand present)
  - `Community Confirmed` (from user's own prior confirmations)
  - `Estimated` (AI or not_sure)
- Tap chip → small sheet with source, last_verified_date, prep assumption.
- Report-macros dialog: add field-level target (calories / protein / carbs / fat) + optional correct value.

## Stage 5 — Edit any logged item

- Tap row → bottom sheet: grams, cooked/raw, prep method, "change match" (opens search).
- Save recalculates locally from stored per-100g when possible; only re-hits AI if match changed to an unresolved query.

### Decision log — 2026-07-22: keeping `searchFoods` dormant

- `searchFoods` (`src/lib/food-catalog.functions.ts`) is retained, not deleted — it's the backend this stage's "change match" search needs, already built.
- It is not currently reachable from any shipped UI — zero callers today, confirmed by full-repo audit.
- Deleting it now would only create avoidable rebuild work once this stage starts.
- **Must not be wired into any UI until the input-handling issue below is fixed first.** See the `BUG (deferred)` comment directly above `searchFoods` in that file for the exact scope.

## Stage 6 — Filipino food coverage expansion

- Seed additional verified `food_records` + aliases: carinderia staples, lechon manok, rice varieties (kanin/sinangag portions), Jollibee/Mang Inasal common items, PH supermarket + canned/sauces, common PH protein powders.
- All per-100g with aliases (EN + FIL), preparation, source, verified=true where sourced.
- Ranking already exists (source_priority); confirm ordering: user history → verified → brand → OFF → AI.

## Stage 7 — Cost / abuse guards (top-up existing)

- Confirm daily AI cap only counts `resolution_path='ai'`; DB / cache / favorite / meal reuse never decrement.
- Friendly "Daily AI limit reached — DB search still works" banner when hit.
- Verify no secrets in client bundle (grep VITE\_ vs process.env in build).

## Stage 8 — Funnel + founder metrics

- Add missing analytics events: `favorite_created`, `saved_meal_reused`, `recent_item_reused`, `entry_edited`, `entry_failed`, `day_two_return`, `day_seven_return`.
- Founder dashboard "Logging performance" card: median + p90 time-to-log (from existing perf events), calc success %, add-to-today success %, clarification rate, AI-fallback rate, DB-match rate, D1/D7 retention.

## Stage 9 — Perf pass

- History: paginate (already fetches all — switch to 50/page + infinite).
- Query cache: ensure TanStack Query keys on verified search / recent / favorites so repeat opens are instant.
- Lazy-load report/edit sheets.
- Verify LCP <2s on simulated slow 4G via the existing web-vitals telemetry.

## Stage 10 — Brand sweep

- Grep for "KineFit" / "Kain Fit" / "Kain-Fit" → replace with "KainFit".
- Add tagline "Know what you ate. Instantly." / "Kain mo. Klaro agad." to landing + auth headers (no redesign).
- Confirm token usage: teal `#0F8B83` primary, coral `#FF6B5E` only on primary CTAs and destructive emphasis, amber only in clarification blocks.

## Technical notes

- New tables: `saved_meals` (RLS: owner only, GRANT authenticated + service_role).
- New columns: `saved_foods.is_favorite bool default false`; `food_entries.prep_state text`, `food_entries.prep_locked bool`.
- No changes to auth, founder dashboard shell, or existing verified-food schema beyond additive columns.
- Every stage: manual mobile-width smoke test (auth → today → log → edit → delete → history) before advancing.

## Out of scope (explicitly)

- Coaching, meal plans, recommended targets, social, extra onboarding, visual redesign.

Ready to start Stage 0 (audit) on approval; I'll pause after each stage for you to sanity-check on your phone before I move on.
