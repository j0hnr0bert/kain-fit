import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { startWebVitals } from "@/lib/perf";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      // KainFit is light-mode-only (locked decision) — tells the browser
      // not to apply its own dark-adapted UA styling (form controls,
      // scrollbars) even when the OS prefers dark.
      { name: "color-scheme", content: "light" },
      { title: "KainFit — The fastest way to track what you eat" },
      {
        name: "description",
        content:
          "Fast, accurate macro tracking built for the way Filipinos eat. Log meals in English, Filipino, or Taglish.",
      },
      { name: "theme-color", content: "#0F766E" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "KainFit" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { property: "og:title", content: "KainFit — The fastest way to track what you eat" },
      {
        property: "og:description",
        content:
          "Fast, accurate macro tracking built for the way Filipinos eat. Log meals in English, Filipino, or Taglish.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "KainFit — The fastest way to track what you eat" },
      {
        name: "twitter:description",
        content:
          "Fast, accurate macro tracking built for the way Filipinos eat. Log meals in English, Filipino, or Taglish.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/5705deea-2862-41c5-878c-418570f45632/id-preview-48185eb4--a3562033-69db-44b1-944e-ae2901ace288.lovable.app-1784188930228.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/5705deea-2862-41c5-878c-418570f45632/id-preview-48185eb4--a3562033-69db-44b1-944e-ae2901ace288.lovable.app-1784188930228.png",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <style>{`
          @keyframes kf-spin { to { transform: rotate(360deg); } }
          /* Light-mode-only, deliberately: no prefers-color-scheme branch
             here. This is the pre-hydration splash — it must always match
             the app's one deterministic theme, or a dark-OS user would see
             a dark-to-light flash the instant React mounts. */
          #kf-boot {
            position: fixed; inset: 0; z-index: 2147483000;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 14px; background: #f9f7f5; color: #0F766E;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          #kf-boot .kf-boot-logo {
            height: 56px; width: 56px; border-radius: 18px;
            background: #0F766E; color: #ffffff;
            display: flex; align-items: center; justify-content: center;
            font-weight: 700; font-size: 24px; letter-spacing: -0.02em;
          }
          #kf-boot .kf-boot-spinner {
            height: 18px; width: 18px; border-radius: 50%;
            border: 2px solid #0F766E; border-top-color: transparent;
            animation: kf-spin 0.8s linear infinite;
          }
          #kf-boot .kf-boot-label { font-size: 14px; color: #0F766E; font-weight: 500; }
          @media (prefers-reduced-motion: reduce) { #kf-boot .kf-boot-spinner { animation: none; } }
        `}</style>
      </head>
      <body>
        <div id="kf-boot" role="status" aria-live="polite" aria-label="Loading KainFit">
          <div className="kf-boot-logo" aria-hidden="true">
            K
          </div>
          <div className="kf-boot-spinner" aria-hidden="true" />
          <div className="kf-boot-label">Preparing KainFit…</div>
        </div>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    // Remove the pre-hydration branded splash as soon as React has mounted.
    if (typeof document !== "undefined") {
      const el = document.getElementById("kf-boot");
      if (el) el.remove();
    }
  }, []);

  useEffect(() => {
    // Background PWA registration — never blocks first paint or hydration.
    // See public/sw.js: caches only one static offline-fallback page, never
    // any API/auth/personal data.
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installability/offline fallback is a progressive enhancement —
        // never surface this to the user or block anything.
      });
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Time from navigation start to React mount.
    let ttiMs: number | undefined;
    try {
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (nav) ttiMs = Math.round(performance.now());
    } catch {
      // ignore
    }
    track("app_loaded", { time_to_react_mount_ms: ttiMs });
    startWebVitals();
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      // First-touch attribution: fire once per browser after the user is
      // signed in. The server RPC is idempotent (only writes when
      // profiles.first_touched_at IS NULL), and localStorage stops us from
      // hammering it on every SIGNED_IN / USER_UPDATED event.
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        void (async () => {
          try {
            if (localStorage.getItem("kf.firstTouchSent") === "1") return;
            const { recordFirstTouch } = await import("@/lib/beta.functions");
            const { getAcquisitionSource, getUtmParams } = await import("@/lib/analytics");
            const utm = getUtmParams();
            await recordFirstTouch({
              data: {
                source: getAcquisitionSource(),
                utm: Object.keys(utm).length > 0 ? utm : null,
              },
            });
            localStorage.setItem("kf.firstTouchSent", "1");
          } catch {
            // never break the app for attribution
          }
        })();
      }
      if (event === "SIGNED_OUT") {
        try {
          localStorage.removeItem("kf.firstTouchSent");
        } catch {
          /* ignore */
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster position="top-center" theme="light" />
    </QueryClientProvider>
  );
}
