# End-to-end tests (Playwright)

These tests exercise real routes against the running dev server at
`http://localhost:8080`. They are **not** run by `vitest`; run them
manually with Python + Playwright.

## Prereqs

- Dev server running on `http://localhost:8080` (Lovable sandbox does this
  automatically; locally run `bun run dev`).
- A managed Supabase session for the target project. In the Lovable
  sandbox the harness injects:
  - `LOVABLE_BROWSER_SUPABASE_STORAGE_KEY`
  - `LOVABLE_BROWSER_SUPABASE_SESSION_JSON`
  - `LOVABLE_BROWSER_SUPABASE_COOKIES_JSON` (optional, for SSR cookie clients)

  When `LOVABLE_BROWSER_AUTH_STATUS=signed_out`, the test exits with code
  `2` and a clear "sign in via the preview, then re-run" message — no
  false pass.

## Run

```bash
python3 tests/e2e/log_meal_flow.py
```

Screenshots land under `/tmp/browser/log_meal_flow/screenshots/`.

## What `log_meal_flow.py` verifies

Meal: `"150g cooked chicken adobo and 150g cooked white rice"`.

1. **Save once**: submitting once produces exactly one new row per parsed
   item in `food_entries` (idempotent under a double-click).
2. **Immediate Today display**: both items appear on `/today` without a
   manual refresh.
3. **Deterministic daily totals**: the header totals equal the sum of
   per-entry macros using the shared `sumNutrients` contract.
4. **Edit**: changing grams recalculates macros locally and the totals
   update accordingly.
5. **Delete**: swipe/click-delete removes the entry and the totals shrink
   by exactly that entry's macros.
6. **Refresh persistence**: after `page.reload()`, remaining entries and
   totals are unchanged.
7. **Relogin persistence**: after `supabase.auth.signOut()` +
   session-restore round trip, remaining entries and totals are still
   unchanged.