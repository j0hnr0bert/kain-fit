// Pure user-agent detection, split out from use-install-prompt.ts so it has
// zero dependencies (in particular, no analytics.ts, which transitively
// pulls in server-function machinery that fails to import inside vitest's
// plain Node test environment). Same convention this project already uses
// elsewhere: pure logic lives in its own file, side effects live on top of
// it — see coaching.ts vs coaching-card-content.ts.

export type InstallPlatform = "android_chromium" | "ios" | "desktop" | "unknown";
export type InAppBrowserApp = "instagram" | "facebook" | "messenger" | "tiktok" | null;

// UA parameter defaults to the real navigator so production call sites are
// unchanged; tests pass a literal string directly.
export function detectPlatform(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
): InstallPlatform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android_chromium";
  if (/Macintosh|Windows|Linux/i.test(ua) && !/Mobi/i.test(ua)) return "desktop";
  return "unknown";
}

// Cautious, well-known UA substrings only — false negatives (missing an
// in-app browser) are safe; false positives would incorrectly tell a
// normal Safari/Chrome user to "open in Safari" for no reason.
export function detectInAppBrowser(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
): InAppBrowserApp {
  if (/Instagram/i.test(ua)) return "instagram";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "facebook";
  if (/Messenger/i.test(ua)) return "messenger";
  if (/TikTok|BytedanceWebview/i.test(ua)) return "tiktok";
  return null;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
