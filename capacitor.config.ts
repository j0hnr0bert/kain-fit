import type { CapacitorConfig } from "@capacitor/cli";

// This app is TanStack Start with SSR (Nitro + Cloudflare Workers) — only
// the /_authenticated routes opt out of SSR (see route.tsx). A bundled
// static `webDir` alone cannot correctly render the SSR'd landing/auth/demo
// routes, so the native shell loads the live deployed site via `server.url`
// instead of shipping a local static build. This means the app always
// requires network connectivity — there is no offline-first mode. This is a
// deliberate 1.0 architecture choice (see the mobile architecture review),
// not a placeholder — do not "fix" this into a bundled build without
// re-reading that review first.
//
// Confirmed production URL and Supabase project identity — see the release
// execution report. Verified live: the deployed bundle at this origin
// embeds vqcugocdbapmljtozfpo.supabase.co, and unauthenticated /today
// correctly redirects to /auth (no 404, clean auth gate).
const PRODUCTION_APP_URL = "https://kain-fit.lovable.app";
// Cold-start destination: land signed-in users on Today directly, and
// bounce signed-out users into the sign-in gate immediately — skips the
// marketing landing page, which a mobile user who already installed the
// app has no need to see (see the mobile architecture review's §8).
const PRODUCTION_START_PATH = "/today";
const PRODUCTION_HOST = new URL(PRODUCTION_APP_URL).host;

const config: CapacitorConfig = {
  appId: "com.kainfit.app",
  appName: "KainFit",
  webDir: ".output/public",
  server: {
    url: `${PRODUCTION_APP_URL}${PRODUCTION_START_PATH}`,
    cleartext: false,
    // Narrowest reasonable allowlist: the production app domain (for
    // in-app navigation, e.g. /auth, /today, /profile) plus Supabase's own
    // domain (auth callbacks, magic links). Anything else — "Use a food
    // scale" external links, etc. — should open in the system browser via
    // @capacitor/browser, not navigate the primary WebView. No wildcards.
    allowNavigation: [PRODUCTION_HOST, "*.supabase.co"],
  },
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
