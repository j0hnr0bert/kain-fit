# KainFit 1.0 Mobile Release Smoke Test

Run once Xcode/Android Studio are available and a real build exists for
each platform (see the release execution report for exact blockers). This
is the high-risk-flow subset, not full QA — roughly 20-30 checks, execute
in order, stop and file an issue on the first failure in each section
before continuing past it.

Mobile entry point: `https://kain-fit.lovable.app/today` (see
`capacitor.config.ts`). Every check below assumes a real device or
simulator/emulator, not the web browser.

## Install / Startup

- [ ] Fresh install, online: app launches, native KainFit splash briefly
      shows, then either Today (if a session persists from a prior web
      login on the same device) or the sign-in screen.
- [ ] Fresh install, airplane mode on: native "You're offline" screen
      appears — not a blank white screen, not the OS's own browser error
      page.
- [ ] From the offline screen, turn airplane mode off, tap **Try Again**:
      transitions to the app within a couple seconds.
- [ ] Returning install (already used before), online: launches directly
      to Today if signed in.
- [ ] Simulated slow connection (Xcode Network Link Conditioner / Android
      emulator throttling): branded loading screen persists — no visible
      raw WebView/browser chrome, no flash of the marketing landing page.
- [ ] Toggle connectivity off then on again *while the app is already
      running* on the startup screen: recovers without a restart.

## Auth

- [ ] Sign up with a new email — confirm onboarding routes correctly
      afterward (not stuck on a blank screen or wrong route).
- [ ] Sign in with an existing account.
- [ ] Sign out — confirm the app returns to the sign-in screen, not a
      broken state.
- [ ] Force-quit and reopen after signing in: session restores, lands on
      Today without re-prompting for credentials.
- [ ] Let a session go stale (or manually clear stored cookies/local
      storage on-device) and reopen: cleanly redirected to sign-in, not an
      error screen.
- [ ] Tap "Continue with Google": confirm what actually happens (expected,
      per the release execution report: opens in the system browser since
      it's outside the app's navigation allowlist — confirm it does NOT
      silently fail or hang). **Known gap**: it will very likely not
      redirect back into the app automatically — confirm this is in fact
      what happens, since deep-link return handling was not implemented
      this pass.
- [ ] Password reset, if the flow is exposed in the UI — same OAuth-return
      caveat may apply if it involves an external link.

## Core Loop

- [ ] Type a food entry, submit, confirm it appears in Today's log almost
      immediately (optimistic UI from this session's earlier work) and the
      calorie/macro rings update.
- [ ] Confirm the entry is still there after the optimistic-to-real
      reconciliation (a couple seconds later) — no flicker, no duplicate.
- [ ] Force-quit the app immediately after saving, reopen: the entry
      persisted (it actually reached the database, not just local state).
- [ ] Edit an existing entry's quantity — macros recalculate correctly.
- [ ] Delete an entry, then tap **Undo** — entry reappears with the same
      values.
- [ ] Add an item from Recent/Favorites/Saved Meals (bypasses AI parsing)
      — confirm it still works from the native shell.

## UX

- [ ] Tap the food-input field: the on-screen keyboard does not cover the
      input bar (Android `adjustResize` fix from this session).
- [ ] Confirm content clears the notch/home-indicator/status-bar areas
      correctly (safe-area insets) at both the top header and bottom nav.
- [ ] Android hardware back button: navigates back through in-app
      history sensibly, does not exit the app from Today unexpectedly.
- [ ] Status bar color/style looks correct against the app's background,
      not the OS default.
- [ ] Background the app mid-session, then resume after a few minutes —
      confirm Today's data is still current (not visibly stale) and
      nothing crashed.

## Failure

- [ ] Start typing a food entry, then enable airplane mode before
      submitting: confirm a clear error, not a silent failure or an
      infinite spinner.
- [ ] Save a food entry, then kill network mid-request (toggle airplane
      mode right after tapping submit): confirm the optimistic entry
      either reconciles when connectivity returns or is rolled back with
      an error — not left stuck on-screen forever.
- [ ] With the app open and working, simulate the backend being
      unreachable (if testable) — confirm the app shows an in-app error
      state, not a native crash.
