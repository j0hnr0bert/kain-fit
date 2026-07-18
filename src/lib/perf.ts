// Phase 1 performance telemetry helper.
// Reports Core Web Vitals (LCP / INP / CLS) and provides a tiny timer
// utility for measuring durations from the client.

import { track } from "./analytics";

let vitalsStarted = false;

export function startWebVitals() {
  if (vitalsStarted || typeof window === "undefined") return;
  vitalsStarted = true;

  // Dynamic import so web-vitals is not part of the initial critical bundle.
  import("web-vitals")
    .then(({ onLCP, onINP, onCLS }) => {
      const report = (name: "LCP" | "INP" | "CLS") => (metric: { value: number; rating?: string; id: string }) => {
        try {
          track("web_vital", {
            metric: name,
            value: Math.round(metric.value * 1000) / 1000,
            rating: metric.rating ?? null,
            metric_id: metric.id,
          });
        } catch {
          // swallow — telemetry must never break the app
        }
      };
      onLCP(report("LCP"));
      onINP(report("INP"));
      onCLS(report("CLS"));
    })
    .catch(() => {
      // swallow — non-critical
    });
}

export function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function mark(): number {
  return now();
}

export function elapsed(start: number): number {
  return Math.round(now() - start);
}