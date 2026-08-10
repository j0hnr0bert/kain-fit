// Shared pure statistics helpers, extracted from kain-signal-detector-
// protein.ts (2026-08-10 insight-quality upgrade) once the new relational
// detectors (kain-signal-detector-protein-calorie.ts,
// kain-signal-detector-weekday-weekend.ts, kain-signal-detector-trend-
// shift.ts) needed the same mean/median/stdDev math protein's detector
// already had — duplicating it a third and fourth time was the wrong call.
// No behavior changed by this extraction; every call site's output is
// identical to before.

export function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Population standard deviation — describing the actual observed window,
// not estimating a wider population, so population (not sample) is the
// correct statistic here.
export function stdDev(values: readonly number[], avg: number): number {
  if (values.length === 0) return 0;
  const variance = mean(values.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
}
