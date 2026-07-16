import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getBetaMetrics, exportBetaCsv, getDemoUsage } from "@/lib/beta.functions";
import { getOpsSnapshot, updateOpsSetting, warmFoodParseCache } from "@/lib/ops.functions";
import { Button } from "@/components/ui/button";
import { Download, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/beta")({
  head: () => ({ meta: [{ title: "Founder dashboard — KainFit" }, { name: "robots", content: "noindex" }] }),
  component: AdminBetaPage,
});

function AdminBetaPage() {
  const qc = useQueryClient();
  const fetchMetrics = useServerFn(getBetaMetrics);
  const exportFn = useServerFn(exportBetaCsv);
  const fetchDemoUsage = useServerFn(getDemoUsage);
  const fetchOps = useServerFn(getOpsSnapshot);
  const setOps = useServerFn(updateOpsSetting);
  const warmCache = useServerFn(warmFoodParseCache);
  const [warming, setWarming] = useState(false);

  async function runWarm() {
    if (warming) return;
    setWarming(true);
    try {
      const r = await warmCache();
      toast.success(
        `Warmed cache: ${r.cacheHits} already cached, ${r.aiCalls} newly cached, ${r.errors} errors (${r.durationMs} ms)`,
      );
      await qc.invalidateQueries({ queryKey: ["ops-snapshot"] });
      await qc.invalidateQueries({ queryKey: ["beta-metrics"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Warm failed");
    } finally {
      setWarming(false);
    }
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ["beta-metrics"],
    queryFn: () => fetchMetrics(),
    retry: false,
  });

  const { data: demoUsage } = useQuery({
    queryKey: ["beta-demo-usage"],
    queryFn: () => fetchDemoUsage(),
    retry: false,
  });

  const { data: ops } = useQuery({
    queryKey: ["ops-snapshot"],
    queryFn: () => fetchOps(),
    retry: false,
    refetchInterval: 5_000,
  });

  const [bannerDraft, setBannerDraft] = useState<string>("");
  const [allowanceDraft, setAllowanceDraft] = useState<string>("");
  const [burstDraft, setBurstDraft] = useState<string>("");
  const [userDailyDraft, setUserDailyDraft] = useState<string>("");
  const [monthlyCapDraft, setMonthlyCapDraft] = useState<string>("");
  const [dailyAlertDraft, setDailyAlertDraft] = useState<string>("");
  useEffect(() => {
    if (ops?.settings) {
      setBannerDraft(ops.settings.high_demand_banner ?? "");
      setAllowanceDraft(String(ops.settings.demo_allowance ?? 3));
      setBurstDraft(String(ops.settings.session_burst_per_min ?? 6));
      setUserDailyDraft(String(ops.settings.user_daily_ai_cap ?? 200));
      setMonthlyCapDraft(String(ops.settings.monthly_ai_call_cap ?? 0));
      setDailyAlertDraft(String(ops.settings.daily_ai_call_alert ?? 0));
    }
  }, [
    ops?.settings.high_demand_banner,
    ops?.settings.demo_allowance,
    ops?.settings.session_burst_per_min,
    ops?.settings.user_daily_ai_cap,
    ops?.settings.monthly_ai_call_cap,
    ops?.settings.daily_ai_call_alert,
  ]);

  async function toggle(key: "pause_demo" | "pause_ai" | "db_only_mode", value: boolean) {
    try {
      await setOps({ data: { key, value } });
      await qc.invalidateQueries({ queryKey: ["ops-snapshot"] });
      toast.success(`${key} → ${value ? "on" : "off"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  }

  async function saveAllowance() {
    const n = Number(allowanceDraft);
    if (!Number.isFinite(n) || n < 0 || n > 50) {
      toast.error("Allowance must be 0–50");
      return;
    }
    try {
      await setOps({ data: { key: "demo_allowance", value: n } });
      await qc.invalidateQueries({ queryKey: ["ops-snapshot"] });
      toast.success("Demo allowance updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  }

  async function saveBanner() {
    if (bannerDraft.length > 200) {
      toast.error("Banner must be under 200 chars");
      return;
    }
    try {
      await setOps({ data: { key: "high_demand_banner", value: bannerDraft } });
      await qc.invalidateQueries({ queryKey: ["ops-snapshot"] });
      toast.success("Banner updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  }

  async function saveNumberSetting(
    key: "session_burst_per_min" | "user_daily_ai_cap" | "monthly_ai_call_cap" | "daily_ai_call_alert",
    raw: string,
    label: string,
  ) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      toast.error(`${label} must be a non-negative number`);
      return;
    }
    try {
      await setOps({ data: { key, value: n } });
      await qc.invalidateQueries({ queryKey: ["ops-snapshot"] });
      toast.success(`${label} updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  }

  const [exporting, setExporting] = useState<null | "metrics" | "feedback">(null);

  async function download(kind: "metrics" | "feedback") {
    setExporting(kind);
    try {
      const { csv } = await exportFn({ data: { kind } });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kainfit-beta-${kind}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }

  useEffect(() => {
    document.title = "Founder dashboard — KainFit";
    track("admin_dashboard_viewed");
  }, []);

  if (error) {
    return (
      <div className="min-h-[100dvh] bg-background px-6 py-10 max-w-md mx-auto">
        <h1 className="text-xl font-semibold">Not authorised</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Only KainFit administrators can view this page.
        </p>
        <Link to="/today" className="text-primary underline text-sm mt-4 inline-block">
          Back to Today
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background pb-24">
      <div className="max-w-3xl mx-auto px-5 pt-6">
        <div className="flex items-center justify-between">
          <Link to="/profile" className="inline-flex items-center gap-1 text-sm text-muted-foreground -ml-2 px-2 py-1">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => download("metrics")}
              disabled={exporting !== null}
              className="rounded-xl"
            >
              {exporting === "metrics" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="ml-1">Metrics CSV</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => download("feedback")}
              disabled={exporting !== null}
              className="rounded-xl"
            >
              {exporting === "feedback" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="ml-1">Feedback CSV</span>
            </Button>
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight mt-4">Founder dashboard</h1>
        <p className="text-sm text-muted-foreground">Aggregated metrics only. No raw food text is shown here.</p>

        {isLoading || !data ? (
          <div className="mt-8 text-sm text-muted-foreground">Loading metrics…</div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
              <Metric label="Unique visitors" value={data.uniqueVisitors} />
              <Metric label="Demo starts" value={data.demoStarts} />
              <Metric label="Signups completed" value={data.signupsCompleted} />
              <Metric label="Signups started" value={data.signupsStarted} />
              <Metric label="Users w/ 1st entry" value={data.firstConfirmedByUser} />
              <Metric label="Median parse time" value={`${data.medianProcessingMs} ms`} />
              <Metric label="Parse fail rate" value={`${(data.parseFailureRate * 100).toFixed(1)}%`} />
              <Metric label="Correction rate" value={`${(data.correctionRate * 100).toFixed(1)}%`} />
              <Metric label="Incorrect-macro reports" value={data.incorrectMacroReports} />
              <Metric label="Day-1 returning" value={data.day1Return} />
              <Metric label="Day-7 returning" value={data.day7Return} />
              <Metric label="Avg entries / active" value={data.avgConfirmedPerActiveUser} />
            </div>

            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Performance
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                End-to-end parse latency measured client-side. AI stage measured server-side.
              </p>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric label="Samples" value={data.performance?.samples ?? 0} />
                <Metric label="p50 (total)" value={`${data.performance?.p50 ?? 0} ms`} />
                <Metric label="p75 (total)" value={`${data.performance?.p75 ?? 0} ms`} />
                <Metric label="p90 (total)" value={`${data.performance?.p90 ?? 0} ms`} />
                <Metric label="p95 (total)" value={`${data.performance?.p95 ?? 0} ms`} />
                <Metric label="% under 3s" value={`${((data.performance?.under3s ?? 0) * 100).toFixed(0)}%`} />
                <Metric label="% under 5s" value={`${((data.performance?.under5s ?? 0) * 100).toFixed(0)}%`} />
                <Metric label="% under 8s" value={`${((data.performance?.under8s ?? 0) * 100).toFixed(0)}%`} />
                <Metric label="% under 10s" value={`${((data.performance?.under10s ?? 0) * 100).toFixed(0)}%`} />
                <Metric label="AI p50" value={`${data.performance?.aiP50 ?? 0} ms`} />
                <Metric label="AI p95" value={`${data.performance?.aiP95 ?? 0} ms`} />
                <Metric label="Timeout rate" value={`${((data.performance?.timeoutRate ?? 0) * 100).toFixed(1)}%`} />
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Resolution pipeline
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Where confirmed parses came from. Cache hits skip the AI call entirely.
              </p>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric
                  label="Cache hit rate"
                  value={`${((data.resolution?.cacheHitRate ?? 0) * 100).toFixed(0)}%`}
                />
                <Metric label="Cache hits (all-time)" value={data.resolution?.cacheHits ?? 0} />
                <Metric label="Cache entries (live)" value={data.resolution?.cacheStats?.live_entries ?? 0} />
                <Metric label="Cache hits (24h)" value={data.resolution?.cacheStats?.hits_last_24h ?? 0} />
              </div>
              <div className="mt-3 rounded-2xl border border-border bg-card divide-y divide-border">
                {Object.entries(data.resolution?.counts ?? {}).length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">No resolutions recorded yet.</div>
                )}
                {Object.entries(data.resolution?.counts ?? {})
                  .sort((a, b) => (b[1] as number) - (a[1] as number))
                  .map(([path, count]) => (
                    <div key={path} className="flex items-center justify-between p-3 text-sm">
                      <span className="font-medium">{path}</span>
                      <span className="tabular-nums text-muted-foreground">{count as number}</span>
                    </div>
                  ))}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Operations (live)
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Refreshes every 5s. Capacity numbers reflect one server instance; queued may fan out across instances during a burst.
              </p>
              {!ops ? (
                <div className="mt-2 text-sm text-muted-foreground">Loading ops…</div>
              ) : (
                <>
                  <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Metric label="In-flight AI" value={ops.capacity.inFlight} />
                    <Metric label="Queued" value={ops.capacity.queued} />
                    <Metric label="Max concurrent" value={ops.capacity.maxConcurrent} />
                    <Metric label="Circuit breaker" value={ops.breaker} />
                    <Metric label="AI calls / min" value={ops.lastMinute.aiCalls} />
                    <Metric label="Rate-limited (1m)" value={ops.lastMinute.rateLimited} />
                    <Metric label="Retries (1m)" value={ops.lastMinute.retries} />
                    <Metric label="Error rate (1m)" value={`${(ops.lastMinute.errorRate * 100).toFixed(1)}%`} />
                    <Metric label="p50 latency (1m)" value={`${ops.lastMinute.p50Ms} ms`} />
                    <Metric label="p95 latency (1m)" value={`${ops.lastMinute.p95Ms} ms`} />
                    <Metric label="Cache hit rate (1m)" value={`${(ops.lastMinute.cacheHitRate * 100).toFixed(0)}%`} />
                  </div>

                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Metric label="AI calls today" value={ops.globals?.aiCallsToday ?? 0} />
                    <Metric label="AI calls this month" value={ops.globals?.aiCallsMonth ?? 0} />
                    <Metric
                      label="Monthly cap"
                      value={ops.settings.monthly_ai_call_cap > 0 ? ops.settings.monthly_ai_call_cap : "off"}
                    />
                    <Metric
                      label="Daily alert"
                      value={
                        ops.settings.daily_ai_call_alert > 0
                          ? `${ops.settings.daily_ai_call_alert}${ops.globals?.dailyAlertHit ? " (hit)" : ""}`
                          : "off"
                      }
                    />
                  </div>

                  <div className="mt-4 rounded-2xl border border-border bg-card divide-y divide-border">
                    <ToggleRow
                      label="Pause anonymous demo"
                      description="New demo calculations are rejected. Existing signups unaffected."
                      checked={ops.settings.pause_demo}
                      onChange={(v) => toggle("pause_demo", v)}
                    />
                    <ToggleRow
                      label="Pause all AI calculations"
                      description="Every parse call returns AI_UNAVAILABLE. History and manual editing still work."
                      checked={ops.settings.pause_ai}
                      onChange={(v) => toggle("pause_ai", v)}
                    />
                    <ToggleRow
                      label="Database-only mode"
                      description="Same effect as pausing AI, but signals the app to steer users to manual entry."
                      checked={ops.settings.db_only_mode}
                      onChange={(v) => toggle("db_only_mode", v)}
                    />
                    <div className="p-4 flex items-end gap-3 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <Label htmlFor="allowance" className="text-sm">Demo allowance (per browser)</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">Applies to new demo attempts.</p>
                      </div>
                      <Input
                        id="allowance"
                        type="number"
                        min={0}
                        max={50}
                        value={allowanceDraft}
                        onChange={(e) => setAllowanceDraft(e.target.value)}
                        className="w-24 rounded-xl"
                      />
                      <Button size="sm" onClick={saveAllowance} className="rounded-xl">Save</Button>
                    </div>
                    <div className="p-4 flex items-end gap-3 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <Label htmlFor="banner" className="text-sm">High-demand banner</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">Empty = no banner. Max 200 chars.</p>
                      </div>
                      <Input
                        id="banner"
                        value={bannerDraft}
                        onChange={(e) => setBannerDraft(e.target.value)}
                        placeholder="e.g. Very busy right now — thanks for your patience."
                        maxLength={200}
                        className="flex-1 min-w-[220px] rounded-xl"
                      />
                      <Button size="sm" onClick={saveBanner} className="rounded-xl">Save</Button>
                    </div>
                    <div className="p-4 flex items-end gap-3 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <Label htmlFor="burst" className="text-sm">Burst limit (per session, /min)</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">0 disables the check. Default 6.</p>
                      </div>
                      <Input
                        id="burst"
                        type="number"
                        min={0}
                        max={120}
                        value={burstDraft}
                        onChange={(e) => setBurstDraft(e.target.value)}
                        className="w-24 rounded-xl"
                      />
                      <Button
                        size="sm"
                        onClick={() => saveNumberSetting("session_burst_per_min", burstDraft, "Burst limit")}
                        className="rounded-xl"
                      >
                        Save
                      </Button>
                    </div>
                    <div className="p-4 flex items-end gap-3 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <Label htmlFor="userDaily" className="text-sm">User daily AI cap</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">Max successful parses per user per day. 0 disables.</p>
                      </div>
                      <Input
                        id="userDaily"
                        type="number"
                        min={0}
                        max={10000}
                        value={userDailyDraft}
                        onChange={(e) => setUserDailyDraft(e.target.value)}
                        className="w-28 rounded-xl"
                      />
                      <Button
                        size="sm"
                        onClick={() => saveNumberSetting("user_daily_ai_cap", userDailyDraft, "User daily cap")}
                        className="rounded-xl"
                      >
                        Save
                      </Button>
                    </div>
                    <div className="p-4 flex items-end gap-3 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <Label htmlFor="monthlyCap" className="text-sm">Monthly AI-call cap (global)</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">Hard stop for the whole app. 0 disables.</p>
                      </div>
                      <Input
                        id="monthlyCap"
                        type="number"
                        min={0}
                        value={monthlyCapDraft}
                        onChange={(e) => setMonthlyCapDraft(e.target.value)}
                        className="w-32 rounded-xl"
                      />
                      <Button
                        size="sm"
                        onClick={() => saveNumberSetting("monthly_ai_call_cap", monthlyCapDraft, "Monthly cap")}
                        className="rounded-xl"
                      >
                        Save
                      </Button>
                    </div>
                    <div className="p-4 flex items-end gap-3 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <Label htmlFor="dailyAlert" className="text-sm">Daily volume alert</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">Highlights the dashboard when daily calls reach this number. 0 disables.</p>
                      </div>
                      <Input
                        id="dailyAlert"
                        type="number"
                        min={0}
                        value={dailyAlertDraft}
                        onChange={(e) => setDailyAlertDraft(e.target.value)}
                        className="w-32 rounded-xl"
                      />
                      <Button
                        size="sm"
                        onClick={() => saveNumberSetting("daily_ai_call_alert", dailyAlertDraft, "Daily alert")}
                        className="rounded-xl"
                      >
                        Save
                      </Button>
                    </div>
                  </div>

                  <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Recent operational changes
                  </h3>
                  <div className="mt-2 rounded-2xl border border-border bg-card divide-y divide-border">
                    {ops.recentAudit.length === 0 && (
                      <div className="p-4 text-sm text-muted-foreground">No changes yet.</div>
                    )}
                    {ops.recentAudit.map((a) => (
                      <div key={a.id} className="p-3 text-sm flex justify-between gap-3">
                        <div>
                          <div className="font-medium">{a.key}</div>
                          <div className="text-xs text-muted-foreground">
                            {String(a.old_value ?? "∅")} → {String(a.new_value ?? "∅")}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(a.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Acquisition source
              </h2>
              <div className="mt-2 rounded-2xl border border-border bg-card divide-y divide-border">
                {Object.entries(data.acquisitionBreakdown).length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">No sources recorded yet.</div>
                )}
                {Object.entries(data.acquisitionBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([src, count]) => (
                    <div key={src} className="flex items-center justify-between p-3 text-sm">
                      <span className="font-medium">{src}</span>
                      <span className="text-muted-foreground">{count}</span>
                    </div>
                  ))}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Recent feedback
              </h2>
              <div className="mt-2 space-y-2">
                {data.recentFeedback.length === 0 && (
                  <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                    No feedback yet.
                  </div>
                )}
                {data.recentFeedback.map((f) => (
                  <div key={f.id} className="rounded-2xl border border-border bg-card p-3 text-sm">
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{new Date(f.created_at).toLocaleString()}</span>
                      {f.ease_rating != null && <span>Ease {f.ease_rating}/5</span>}
                      {f.accuracy_rating != null && <span>Accuracy {f.accuracy_rating}/5</span>}
                      {f.would_use_tomorrow && <span>Tomorrow: {f.would_use_tomorrow}</span>}
                      {f.acquisition_source && <span>src: {f.acquisition_source}</span>}
                      {f.allow_contact && <span className="text-primary">Contact ok</span>}
                    </div>
                    {f.confusing && <p className="mt-1"><span className="text-muted-foreground">Confusing:</span> {f.confusing}</p>}
                    {f.missed_food && <p className="mt-1"><span className="text-muted-foreground">Missed:</span> {f.missed_food}</p>}
                    {f.comment && <p className="mt-1">{f.comment}</p>}
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Recent incorrect-macro reports
              </h2>
              <div className="mt-2 space-y-2">
                {data.recentReports.length === 0 && (
                  <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                    No reports yet.
                  </div>
                )}
                {data.recentReports.map((r) => (
                  <div key={r.id} className="rounded-2xl border border-border bg-card p-3 text-sm">
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{new Date(r.created_at).toLocaleString()}</span>
                      <span>Issue: {r.issue_type}</span>
                      <span>Status: {r.resolution_status}</span>
                    </div>
                    {r.explanation && <p className="mt-1">{r.explanation}</p>}
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Demo quota (anonymous sessions)
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Server-side authoritative count. No food text, IPs, or tokens.
              </p>
              <div className="mt-2 overflow-x-auto rounded-2xl border border-border bg-card">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="p-2 font-medium">Session</th>
                      <th className="p-2 font-medium">Used</th>
                      <th className="p-2 font-medium">Left</th>
                      <th className="p-2 font-medium">Last success</th>
                      <th className="p-2 font-medium">Last reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(demoUsage?.sessions ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-3 text-muted-foreground">
                          No demo sessions yet.
                        </td>
                      </tr>
                    )}
                    {demoUsage?.sessions.map((s) => (
                      <tr key={s.session_id} className="border-t border-border">
                        <td className="p-2 font-mono text-[11px]">{s.session_id.slice(0, 12)}…</td>
                        <td className="p-2">{s.used}</td>
                        <td className="p-2">{s.remaining}</td>
                        <td className="p-2 text-muted-foreground">
                          {s.last_success_at
                            ? new Date(s.last_success_at).toLocaleString()
                            : "—"}
                        </td>
                        <td className="p-2 text-muted-foreground">{s.last_reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="p-4 flex items-center gap-3">
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}