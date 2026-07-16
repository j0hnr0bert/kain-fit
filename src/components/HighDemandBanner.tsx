import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicOpsFlags } from "@/lib/ops.functions";

// Small pill-shaped banner shown when the founder has set a high-demand
// message. Silent otherwise. Polls every 30s so it turns on/off within a
// reasonable window during a burst.
export function HighDemandBanner() {
  const fetchFlags = useServerFn(getPublicOpsFlags);
  const { data } = useQuery({
    queryKey: ["public-ops-flags"],
    queryFn: () => fetchFlags(),
    refetchInterval: 30_000,
    retry: false,
  });
  const msg = data?.high_demand_banner?.trim();
  if (!msg) return null;
  return (
    <div className="mx-4 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
      {msg}
    </div>
  );
}