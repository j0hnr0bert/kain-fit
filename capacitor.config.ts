import type { CapacitorConfig } from "@capacitor/cli";

// This app is TanStack Start with SSR (Nitro + Cloudflare Workers) — only
// the /_authenticated routes opt out of SSR (see route.tsx). A bundled
// static `webDir` alone cannot correctly render the SSR'd landing/auth/demo
// routes, so the native shell loads the live deployed site via `server.url`
// instead of shipping a local static build. This means the app always
// requires network connectivity — there is no offline-first mode.
//
// `server.url` below is intentionally NOT set to a guessed production
// domain. The production Supabase project identity is unresolved as of
// this writing (see the session's standing blocker), so the actual
// deployed app URL has not been confirmed either. A human must set this to
// the real production URL before shipping — see the Phase 4 report's
// "Exact Human Actions Required" list.
const PRODUCTION_APP_URL = ""; // TODO(human): set to the confirmed production URL before release builds.

const config: CapacitorConfig = {
  appId: "com.kainfit.app",
  appName: "KainFit",
  webDir: ".output/public",
  server: PRODUCTION_APP_URL
    ? { url: PRODUCTION_APP_URL, cleartext: false }
    : { url: "http://localhost:8080", cleartext: true },
  plugins: {
    SplashScreen: {
      launchShowDuration: 400,
      backgroundColor: "#F9F7F5",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#F9F7F5",
    },
  },
};

export default config;
