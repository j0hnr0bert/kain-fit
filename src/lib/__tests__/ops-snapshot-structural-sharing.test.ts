import { describe, it, expect } from "vitest";
import { replaceEqualDeep } from "@tanstack/react-query";

// admin.beta.tsx's settings-draft-sync effect (the useEffect that seeds
// bannerDraft/allowanceDraft/etc. from ops.settings) depends on the single
// `ops?.settings` object rather than nine separate primitive fields. That's
// only safe against getOpsSnapshot's 5s
// refetchInterval poll because TanStack Query's default structuralSharing
// (replaceEqualDeep, used internally by useQuery on every fetch) reuses the
// previous `settings` reference whenever its content is unchanged — even
// while sibling fields like `capacity`/`lastMinute` change every tick and
// force a new top-level object. If that ever stopped being true (e.g.
// structuralSharing disabled on the QueryClient, or getOpsSnapshot started
// returning non-JSON-safe values that break deep-equality), the effect
// would re-fire on every poll and silently overwrite the founder's
// in-progress draft edits mid-typing. These tests pin the exact invariant
// the fix relies on.
describe("ops-snapshot structural sharing (admin.beta.tsx draft-sync precondition)", () => {
  it("reuses the previous `settings` reference when only unrelated live fields change", () => {
    const prev = {
      capacity: { inFlight: 0, queued: 0 },
      lastMinute: { aiCalls: 3 },
      settings: { high_demand_banner: "", demo_allowance: 3 },
    };
    const next = {
      capacity: { inFlight: 1, queued: 2 },
      lastMinute: { aiCalls: 7 },
      settings: { high_demand_banner: "", demo_allowance: 3 },
    };
    const merged = replaceEqualDeep(prev, next);
    expect(merged).not.toBe(prev);
    expect(merged.capacity).not.toBe(prev.capacity);
    expect(merged.settings).toBe(prev.settings);
  });

  it("produces a new `settings` reference when a setting value actually changes", () => {
    const prev = {
      capacity: { inFlight: 0 },
      settings: { high_demand_banner: "", demo_allowance: 3 },
    };
    const next = {
      capacity: { inFlight: 0 },
      settings: { high_demand_banner: "Busy right now", demo_allowance: 3 },
    };
    const merged = replaceEqualDeep(prev, next);
    expect(merged.settings).not.toBe(prev.settings);
    expect(merged.settings.high_demand_banner).toBe("Busy right now");
  });

  it("stays stable across several polls with identical settings, matching the 5s refetchInterval scenario", () => {
    const pollResponse = (tick: number) => ({
      capacity: { inFlight: tick },
      settings: { high_demand_banner: "", demo_allowance: 3 },
    });
    let ops: ReturnType<typeof pollResponse> = pollResponse(0);
    const settingsRef = ops.settings;
    for (let tick = 1; tick <= 5; tick++) {
      ops = replaceEqualDeep(ops, pollResponse(tick));
    }
    expect(ops.settings).toBe(settingsRef);
  });
});
