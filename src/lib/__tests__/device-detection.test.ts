import { describe, it, expect } from "vitest";
import { detectPlatform, detectInAppBrowser } from "../device-detection";

const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const IOS_INSTAGRAM = `${IOS_SAFARI} Instagram 312.0.0.0.0`;
const ANDROID_FACEBOOK = `${ANDROID_CHROME} [FB_IAB/FB4A]`;
const IOS_MESSENGER = `${IOS_SAFARI} MessengerForiOS`;
const ANDROID_TIKTOK = `${ANDROID_CHROME} musical_ly_2024 BytedanceWebview/d8a21c6`;

describe("detectPlatform", () => {
  it("identifies iPhone/iPad/iPod as ios", () => {
    expect(detectPlatform(IOS_SAFARI)).toBe("ios");
  });

  it("identifies Android as android_chromium", () => {
    expect(detectPlatform(ANDROID_CHROME)).toBe("android_chromium");
  });

  it("identifies Mac/Windows/Linux desktop UAs as desktop", () => {
    expect(detectPlatform(DESKTOP_CHROME)).toBe("desktop");
    expect(detectPlatform(WINDOWS_CHROME)).toBe("desktop");
  });

  it("falls back to unknown for an unrecognized UA", () => {
    expect(detectPlatform("SomeOtherBrowser/1.0")).toBe("unknown");
  });

  it("an Android UA is never misclassified as desktop despite containing 'Linux'", () => {
    // Android UAs literally contain "Linux;" — the desktop branch's
    // Mobi-exclusion guard is what prevents this misclassification.
    expect(detectPlatform(ANDROID_CHROME)).not.toBe("desktop");
  });
});

describe("detectInAppBrowser", () => {
  it("detects Instagram's in-app browser on iOS", () => {
    expect(detectInAppBrowser(IOS_INSTAGRAM)).toBe("instagram");
  });

  it("detects Facebook's in-app browser on Android", () => {
    expect(detectInAppBrowser(ANDROID_FACEBOOK)).toBe("facebook");
  });

  it("detects Messenger's in-app browser", () => {
    expect(detectInAppBrowser(IOS_MESSENGER)).toBe("messenger");
  });

  it("detects TikTok's in-app browser", () => {
    expect(detectInAppBrowser(ANDROID_TIKTOK)).toBe("tiktok");
  });

  it("returns null for ordinary Safari/Chrome — no false positive", () => {
    expect(detectInAppBrowser(IOS_SAFARI)).toBeNull();
    expect(detectInAppBrowser(ANDROID_CHROME)).toBeNull();
    expect(detectInAppBrowser(DESKTOP_CHROME)).toBeNull();
  });
});
