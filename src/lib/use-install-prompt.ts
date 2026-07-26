// Device-aware PWA installation state (2026-07-26). There is no native app
// yet — this is entirely the web-standard `beforeinstallprompt` +
// `display-mode: standalone` API surface. No new dependency, no Capacitor,
// no App Store integration.
//
// Platform detection is best-effort user-agent sniffing, same convention
// already used by auth.tsx's platformTag() — there is no reliable
// feature-detection alternative for "is this iOS Safari" vs "is this
// Android Chrome" from the page alone.

import { useEffect, useState } from "react";
import { track } from "./analytics";
import {
  detectPlatform,
  detectInAppBrowser,
  isStandaloneDisplay,
  type InstallPlatform,
  type InAppBrowserApp,
} from "./device-detection";

export type { InstallPlatform, InAppBrowserApp };

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_STORAGE_KEY = "kf.installPromptDismissedAt";
// Once explicitly dismissed, the CONTEXTUAL (post-demo) placement stays
// quiet for this long — the persistent landing-page button is never
// suppressed, since it's a normal always-available control, not a prompt.
const RECONTEXTUAL_SUPPRESS_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function useInstallPrompt() {
  const [platform, setPlatform] = useState<InstallPlatform>("unknown");
  const [inAppBrowser, setInAppBrowser] = useState<InAppBrowserApp>(null);
  const [installed, setInstalled] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [shownTracked, setShownTracked] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setInAppBrowser(detectInAppBrowser());
    setInstalled(isStandaloneDisplay());

    function onBeforeInstallPrompt(e: Event) {
      // Chrome fires this automatically when install criteria are met —
      // we only store it. The trusted browser prompt itself is never
      // triggered here, only from an explicit tap (see promptInstall).
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (shownTracked) return;
    if (platform === "unknown") return;
    setShownTracked(true);
    // Client-side 1s de-dupe (see analytics.ts) absorbs the case where more
    // than one InstallKainFitCTA instance mounts on the same page.
    if (installed) {
      track("already_installed", { platform });
    } else {
      track("install_cta_shown", { platform, native_prompt_available: deferredPrompt !== null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed, platform, deferredPrompt]);

  async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
    track("install_cta_selected", { platform });
    if (!deferredPrompt) return "unavailable";
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    track(choice.outcome === "accepted" ? "install_accepted" : "install_dismissed", { platform });
    if (choice.outcome === "dismissed") {
      try {
        localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
      } catch {
        // ignore
      }
    }
    // A given deferred prompt is single-use; Chrome may fire a fresh
    // beforeinstallprompt later, at which point the effect above replaces it.
    setDeferredPrompt(null);
    return choice.outcome;
  }

  function wasRecentlyDismissed(): boolean {
    try {
      const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
      if (!raw) return false;
      return Date.now() - Number(raw) < RECONTEXTUAL_SUPPRESS_MS;
    } catch {
      return false;
    }
  }

  return {
    platform,
    inAppBrowser,
    installed,
    canPromptNatively: deferredPrompt !== null,
    promptInstall,
    wasRecentlyDismissed,
  };
}
