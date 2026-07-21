import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getBetaMetrics,
  exportBetaCsv,
  getDemoUsage,
  getSignupFunnel,
  getAuthDiagnostics,
  getRetentionCohorts,
} from "@/lib/beta.functions";
import { getOpsSnapshot, updateOpsSetting, warmFoodParseCache } from "@/lib/ops.functions";
import {
  listFoodReviewQueue,
  reviewFoodSubmission,
  reviewFoodRevision,
} from "@/lib/food-review.functions";
import { bulkImportFoods, parseCsv, mapCsvRows, type BulkImportRow } from "@/lib/food-catalog.functions";
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
  const fetchSignupFunnel = useServerFn(getSignupFunnel);
  const fetchAuthDiagnostics = useServerFn(getAuthDiagnostics);
  const fetchRetention = useServerFn(getRetentionCohorts);
  const fetchOps = useServerFn(getOpsSnapshot);
  const setOps = useServerFn(updateOpsSetting);
  const warmCache = useServerFn(warmFoodParseCache);
  const [warming, setWarming] = useState(false);
  const fetchReviewQueue = useServerFn(listFoodReviewQueue);
  const decideSubmission = useServerFn(reviewFoodSubmission);
  const decideRevision = useServerFn(reviewFoodRevision);
  const [pendingDecision, setPendingDecision] = useState<string | null>(null);
  const importFoods = useServerFn(bulkImportFoods);
  const [csvRows, setCsvRows] = useState<BulkImportRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<Array<{ line: number; reason: string }>>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importSource, setImportSource] = useState<
    "philfct" | "manufacturer" | "restaurant" | "openfoodfacts" | "commercial_api" | "manual"
  >("manual");

  async function onCsvFile(file: File) {
    const text = await file.text();
    const records = parseCsv(text);
    const mapped = mapCsvRows(records);
    setCsvRows(mapped.rows);
    setCsvErrors(mapped.errors);
    setImportResult(null);
    if (mapped.rows.length === 0 && mapped.errors.length === 0) {
      toast.error("CSV contained no valid rows");
    } else {
      toast.success(`Parsed ${mapped.rows.length} row(s), ${mapped.errors.length} error(s)`);
    }
  }

  async function runImport() {
    if (csvRows.length === 0 || importing) return;
    setImporting(true);
    setImportResult(null);
    try {
      // Chunk to stay under the 1000-row server-side cap and keep responses snappy.
      const CHUNK = 200;
      let imported = 0;
      let aliases = 0;
      for (let i = 0; i < csvRows.length; i += CHUNK) {
        const slice = csvRows.slice(i, i + CHUNK);
        const r = await importFoods({ data: { rows: slice, source_override: importSource } });
        imported += r.imported;
        aliases += r.aliases;
      }
      setImportResult(`Imported/updated ${imported} food record(s) and ${aliases} alias(es).`);
      toast.success(`Imported ${imported} foods`);
      setCsvRows([]);
      setCsvErrors([]);
      await qc.invalidateQueries({ queryKey: ["beta-metrics"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

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

  const { data: signupFunnel } = useQuery({
    queryKey: ["signup-funnel"],
    queryFn: () => fetchSignupFunnel(),
    retry: false,
    refetchInterval: 15000,
  });

  const { data: authDiag } = useQuery({
    queryKey: ["auth-diagnostics"],
    queryFn: () => fetchAuthDiagnostics(),
    retry: false,
    refetchInterval: 30_000,
  });

  const { data: retention } = useQuery({
    queryKey: ["retention-cohorts"],
    queryFn: () => fetchRetention(),
    retry: false,
    refetchInterval: 60_000,
  });

  const { data: ops } = useQuery({
    queryKey: ["ops-snapshot"],
    queryFn: () => fetchOps(),
    retry: false,
    refetchInterval: 5_000,
  });

  const { data: reviewQueue } = useQuery({
    queryKey: ["food-review-queue"],
    queryFn: () => fetchReviewQueue(),
    retry: false,
  });

  async function decide(
    kind: "submission" | "revision",
    id: string,
    action: "approve" | "reject",
  ) {
    const key = `${kind}:${id}:${action}`;
    if (pendingDecision) return;
    setPendingDecision(key);
    try {
      if (kind === "submission") await decideSubmission({ data: { id, action } });
      else await decideRevision({ data: { id, action } });
      await qc.invalidateQueries({ queryKey: ["food-review-queue"] });
      toast.success(`${kind} ${action}d`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Review failed");
    } finally {
      setPendingDecision(null);
    }
  }

  const [bannerDraft, setBannerDraft] = useState<string>("");
  const [allowanceDraft, setAllowanceDraft] = useState<string>("");
  const [burstDraft, setBurstDraft] = useState<string>("");
  const [userDailyDraft, setUserDailyDraft] = useState<string>("");
  const [monthlyCapDraft, setMonthlyCapDraft] = useState<string>("");
  const [dailyAlertDraft, setDailyAlertDraft] = useState<string>("");
  const [betaCapDraft, setBetaCapDraft] = useState<string>("");
  const [betaInputLenDraft, setBetaInputLenDraft] = useState<string>("");
  const [betaMaxFoodsDraft, setBetaMaxFoodsDraft] = useState<string>("");
  useEffect(() => {
    if (ops?.settings) {
      setBannerDraft(ops.settings.high_demand_banner ?? "");
      setAllowanceDraft(String(ops.settings.demo_allowance ?? 3));
      setBurstDraft(String(ops.settings.session_burst_per_min ?? 6));
      setUserDailyDraft(String(ops.settings.user_daily_ai_cap ?? 200));
      setMonthlyCapDraft(String(ops.settings.monthly_ai_call_cap ?? 0));
      setDailyAlertDraft(String(ops.settings.daily_ai_call_alert ?? 0));
      setBetaCapDraft(String(ops.settings.beta_daily_submission_cap ?? 20));
      setBetaInputLenDraft(String(ops.settings.beta_max_input_length ?? 500));
      setBetaMaxFoodsDraft(String(ops.settings.beta_max_foods_per_submission ?? 10));
    }
  }, [
    ops?.settings.high_demand_banner,
    ops?.settings.demo_allowance,
    ops?.settings.session_burst_per_min,
    ops?.settings.user_daily_ai_cap,
    ops?.settings.monthly_ai_call_cap,
    ops?.settings.daily_ai_call_alert,
    ops?.settings.beta_daily_submission_cap,
    ops?.settings.beta_max_input_length,
    ops?.settings.beta_max_foods_per_submission,
  ]);

  async function toggle(
    key: "pause_demo" | "pause_ai" | "db_only_mode" | "beta_limits_enabled",
    value: boolean,
  ) {
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
    key:
      | "session_burst_per_min"
      | "user_daily_ai_cap"
      | "monthly_ai_call_cap"
      | "daily_ai_call_alert"
      | "beta_daily_submission_cap"
      | "beta_max_input_length"
      | "beta_max_foods_per_submission",
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
                Signup funnel (email/password)
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Unique sessions that reached each step. Drop-off between rows is where people abandon.
              </p>
              {!signupFunnel ? (
                <div className="mt-3 text-sm text-muted-foreground">Loading funnel…</div>
              ) : (
                <>
                  <div className="mt-3 rounded-2xl border border-border bg-card divide-y divide-border">
                    {signupFunnel.steps.map((s, i) => {
                      const top = signupFunnel.steps[0]?.sessions ?? 0;
                      const prev = i > 0 ? signupFunnel.steps[i - 1].sessions : s.sessions;
                      const pctTop = top ? Math.round((s.sessions / top) * 100) : 0;
                      const drop = prev - s.sessions;
                      return (
                        <div key={s.step} className="flex items-center justify-between p-3 text-sm">
                          <div className="flex items-center gap-3">
                            <span className="tabular-nums text-muted-foreground w-6">{i + 1}.</span>
                            <span className="font-medium">{s.step.replace(/_/g, " ")}</span>
                          </div>
                          <div className="flex items-center gap-4 tabular-nums">
                            <span className="text-muted-foreground text-xs">{pctTop}% of top</span>
                            {i > 0 && drop > 0 && (
                              <span className="text-destructive text-xs">−{drop}</span>
                            )}
                            <span className="font-semibold">{s.sessions}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Validation failure reasons
                      </h3>
                      <div className="mt-2 rounded-2xl border border-border bg-card divide-y divide-border">
                        {Object.entries(signupFunnel.validationReasons).length === 0 && (
                          <div className="p-3 text-sm text-muted-foreground">None recorded.</div>
                        )}
                        {Object.entries(signupFunnel.validationReasons)
                          .sort((a, b) => (b[1] as number) - (a[1] as number))
                          .map(([reason, count]) => (
                            <div key={reason} className="flex items-center justify-between p-3 text-sm">
                              <span className="font-mono text-xs">{reason}</span>
                              <span className="tabular-nums text-muted-foreground">{count as number}</span>
                            </div>
                          ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Backend error reasons
                      </h3>
                      <div className="mt-2 rounded-2xl border border-border bg-card divide-y divide-border">
                        {Object.entries(signupFunnel.requestErrorReasons).length === 0 && (
                          <div className="p-3 text-sm text-muted-foreground">None recorded.</div>
                        )}
                        {Object.entries(signupFunnel.requestErrorReasons)
                          .sort((a, b) => (b[1] as number) - (a[1] as number))
                          .map(([reason, count]) => (
                            <div key={reason} className="flex items-center justify-between p-3 text-sm">
                              <span className="font-mono text-xs">{reason}</span>
                              <span className="tabular-nums text-muted-foreground">{count as number}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>

                  {signupFunnel.recentErrors.length > 0 && (
                    <div className="mt-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Recent backend errors
                      </h3>
                      <div className="mt-2 rounded-2xl border border-border bg-card divide-y divide-border">
                        {signupFunnel.recentErrors.slice(0, 10).map((e, i) => (
                          <div key={i} className="p-3 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-mono">{e.reason ?? "unknown"}</span>
                              <span className="text-muted-foreground">
                                {new Date(e.created_at).toLocaleString()}
                              </span>
                            </div>
                            {e.detail && (
                              <div className="mt-1 text-muted-foreground break-words">{e.detail}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Authentication Diagnostics
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Sanitized `auth_attempt_completed` events from the last 7 days. No passwords or tokens are stored.
              </p>
              {!authDiag ? (
                <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-1 pr-3">Provider</th>
                          <th className="py-1 pr-3">Attempts</th>
                          <th className="py-1 pr-3">Success</th>
                          <th className="py-1 pr-3">Success rate</th>
                          <th className="py-1 pr-3">p50</th>
                          <th className="py-1 pr-3">p95</th>
                          <th className="py-1 pr-3">Top errors</th>
                          <th className="py-1 pr-3">422 breakdown</th>
                        </tr>
                      </thead>
                      <tbody>
                        {authDiag.byProvider
                          .filter((r) => r.attempts > 0)
                          .map((r) => (
                            <tr key={r.provider} className="border-t border-border/50">
                              <td className="py-1 pr-3 font-medium capitalize">{r.provider}</td>
                              <td className="py-1 pr-3">{r.attempts}</td>
                              <td className="py-1 pr-3">{r.successes}</td>
                              <td className="py-1 pr-3">{Math.round(r.successRate * 100)}%</td>
                              <td className="py-1 pr-3">{r.p50Ms} ms</td>
                              <td className="py-1 pr-3">{r.p95Ms} ms</td>
                              <td className="py-1 pr-3">
                                {r.topErrors.length === 0
                                  ? "—"
                                  : r.topErrors.map((e) => `${e.code} (${e.count})`).join(", ")}
                              </td>
                              <td className="py-1 pr-3">
                                {r.status422.length === 0
                                  ? "—"
                                  : r.status422.map((e) => `${e.code} (${e.count})`).join(", ")}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {authDiag.recentFailures.length > 0 && (
                    <div className="mt-4">
                      <h3 className="text-xs font-semibold text-muted-foreground">Recent failures</h3>
                      <div className="mt-2 space-y-1 max-h-64 overflow-y-auto pr-2 text-xs">
                        {authDiag.recentFailures.map((f, i) => (
                          <div key={i} className="rounded border border-border/50 p-2">
                            <div className="flex flex-wrap justify-between gap-2">
                              <span className="font-medium capitalize">
                                {f.provider} · {f.operation}
                              </span>
                              <span className="text-muted-foreground">
                                {new Date(f.created_at).toLocaleString()}
                              </span>
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              <span className="font-mono">{f.error_code}</span>
                              {f.status ? <> · status {String(f.status)}</> : null} · {f.platform}
                            </div>
                            {f.reason && (
                              <div className="mt-1 text-muted-foreground break-words">{f.reason}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Activation &amp; Retention (Manila TZ)
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Activation = signed up and logged ≥1 food on signup day. D1 / D7 measured
                against mature cohorts only (users whose day +1 / +7 has already elapsed).
              </p>
              {!retention ? (
                <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Metric label="Signups (30d)" value={retention.overall.users} />
                    <Metric
                      label="Activation"
                      value={`${Math.round(retention.overall.activationRate * 100)}% (${retention.overall.activated}/${retention.overall.users})`}
                    />
                    <Metric
                      label="D1 retention"
                      value={`${Math.round(retention.overall.d1Rate * 100)}% (${retention.overall.d1}/${retention.overall.d1Mature})`}
                    />
                    <Metric
                      label="D7 retention"
                      value={`${Math.round(retention.overall.d7Rate * 100)}% (${retention.overall.d7}/${retention.overall.d7Mature})`}
                    />
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-1 pr-3">Cohort week</th>
                          <th className="py-1 pr-3">Signups</th>
                          <th className="py-1 pr-3">Activated</th>
                          <th className="py-1 pr-3">D1</th>
                          <th className="py-1 pr-3">D7</th>
                        </tr>
                      </thead>
                      <tbody>
                        {retention.cohorts.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-2 text-muted-foreground">
                              No signups in the last 30 days.
                            </td>
                          </tr>
                        ) : (
                          retention.cohorts.map((c) => (
                            <tr key={c.cohort} className="border-t border-border/50">
                              <td className="py-1 pr-3 font-mono">{c.cohort}</td>
                              <td className="py-1 pr-3">{c.users}</td>
                              <td className="py-1 pr-3">
                                {c.users
                                  ? `${Math.round((c.activated / c.users) * 100)}% (${c.activated}/${c.users})`
                                  : "—"}
                              </td>
                              <td className="py-1 pr-3">
                                {c.matureForD1
                                  ? `${Math.round((c.d1 / c.matureForD1) * 100)}% (${c.d1}/${c.matureForD1})`
                                  : "pending"}
                              </td>
                              <td className="py-1 pr-3">
                                {c.matureForD7
                                  ? `${Math.round((c.d7 / c.matureForD7) * 100)}% (${c.d7}/${c.matureForD7})`
                                  : "pending"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

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
                  {ops.activeBanner?.text ? (
                    <div
                      className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
                        ops.activeBanner.isAuto
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                          : "border-border bg-muted/40 text-foreground"
                      }`}
                    >
                      <div className="font-medium">
                        {ops.activeBanner.isAuto ? "Auto banner active" : "Manual banner active"}
                        <span className="ml-2 rounded bg-black/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                          {ops.activeBanner.reason}
                        </span>
                      </div>
                      <div className="mt-1 opacity-90">{ops.activeBanner.text}</div>
                    </div>
                  ) : (
                    <div className="mt-3 text-xs text-muted-foreground">
                      No banner active — system is healthy.
                    </div>
                  )}
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
                    <ToggleRow
                      label="Enforce beta usage limits"
                      description="Per-user daily submission cap, input length, and max foods per submission. Enforced server-side, PHT day boundary."
                      checked={ops.settings.beta_limits_enabled}
                      onChange={(v) => toggle("beta_limits_enabled", v)}
                    />
                    <div className="p-4 flex items-end gap-3 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <Label htmlFor="betaCap" className="text-sm">Beta daily submission cap (per user)</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">Successful parses per PHT day. 0 disables. Default 20.</p>
                      </div>
                      <Input
                        id="betaCap"
                        type="number"
                        min={0}
                        max={500}
                        value={betaCapDraft}
                        onChange={(e) => setBetaCapDraft(e.target.value)}
                        className="w-24 rounded-xl"
                      />
                      <Button
                        size="sm"
                        onClick={() => saveNumberSetting("beta_daily_submission_cap", betaCapDraft, "Beta daily cap")}
                        className="rounded-xl"
                      >
                        Save
                      </Button>
                    </div>
                    <div className="p-4 flex items-end gap-3 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <Label htmlFor="betaInputLen" className="text-sm">Max input length (chars)</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">Rejects submissions longer than this. 10–2000. Default 500.</p>
                      </div>
                      <Input
                        id="betaInputLen"
                        type="number"
                        min={10}
                        max={2000}
                        value={betaInputLenDraft}
                        onChange={(e) => setBetaInputLenDraft(e.target.value)}
                        className="w-28 rounded-xl"
                      />
                      <Button
                        size="sm"
                        onClick={() => saveNumberSetting("beta_max_input_length", betaInputLenDraft, "Input length")}
                        className="rounded-xl"
                      >
                        Save
                      </Button>
                    </div>
                    <div className="p-4 flex items-end gap-3 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <Label htmlFor="betaMaxFoods" className="text-sm">Max foods per submission</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">Caps items parsed from one submission. 1–50. Default 10.</p>
                      </div>
                      <Input
                        id="betaMaxFoods"
                        type="number"
                        min={1}
                        max={50}
                        value={betaMaxFoodsDraft}
                        onChange={(e) => setBetaMaxFoodsDraft(e.target.value)}
                        className="w-24 rounded-xl"
                      />
                      <Button
                        size="sm"
                        onClick={() => saveNumberSetting("beta_max_foods_per_submission", betaMaxFoodsDraft, "Max foods")}
                        className="rounded-xl"
                      >
                        Save
                      </Button>
                    </div>
                    <div className="p-4 flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <div className="text-sm font-medium">Pre-warm parse cache</div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Seeds the shared cache with common Filipino inputs so the first few users hit the cache instead of the AI. Safe to run anytime; entries already cached are skipped.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={runWarm}
                        disabled={warming}
                        className="rounded-xl"
                      >
                        {warming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Warm now"}
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
                Food review queue
              </h2>
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Bulk food import (CSV)
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Upload a CSV to populate the catalog in bulk. Required columns:
                <code className="mx-1 rounded bg-muted px-1 py-0.5">name</code>,
                <code className="mx-1 rounded bg-muted px-1 py-0.5">category</code>,
                <code className="mx-1 rounded bg-muted px-1 py-0.5">per_100g_calories</code>.
                Optional: alt_names (| or ; separated), brand, barcode (UPC/EAN, 8–14 digits),
                per_100g_protein_g/carbs_g/fat_g/fiber_g/sodium_mg, common_serving_label,
                common_serving_grams, verified, preparation_state, canonical_name, last_verified_date.
                Rows are upserted by canonical_name (barcode is also indexed for direct scan lookup).
                The selected source tier below auto-assigns trust rank and default verified flag.
              </p>
              <div className="mt-3 rounded-2xl border border-border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="import-source" className="text-xs">
                    Source tier
                  </Label>
                  <select
                    id="import-source"
                    value={importSource}
                    onChange={(e) =>
                      setImportSource(e.target.value as typeof importSource)
                    }
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="philfct">PhilFCT (highest trust)</option>
                    <option value="manufacturer">Manufacturer panel</option>
                    <option value="restaurant">Restaurant chain</option>
                    <option value="openfoodfacts">Open Food Facts</option>
                    <option value="commercial_api">Commercial API</option>
                    <option value="manual">Manual / placeholder</option>
                  </select>
                  <span className="text-[11px] text-muted-foreground">
                    Applied to every row in this upload. PhilFCT / manufacturer / restaurant
                    are marked verified automatically.
                  </span>
                </div>
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onCsvFile(f);
                  }}
                />
                <div className="text-xs text-muted-foreground">
                  Parsed: <strong>{csvRows.length}</strong> row(s). Errors:{" "}
                  <strong className={csvErrors.length > 0 ? "text-destructive" : ""}>
                    {csvErrors.length}
                  </strong>
                  .
                </div>
                {csvErrors.length > 0 && (
                  <div className="max-h-32 overflow-auto rounded border border-border/50 bg-muted/30 p-2 text-[11px]">
                    {csvErrors.slice(0, 20).map((err, i) => (
                      <div key={i}>
                        Line {err.line}: {err.reason}
                      </div>
                    ))}
                    {csvErrors.length > 20 && <div>…and {csvErrors.length - 20} more</div>}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={runImport} disabled={csvRows.length === 0 || importing}>
                    {importing ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Importing…
                      </>
                    ) : (
                      `Import ${csvRows.length} row(s)`
                    )}
                  </Button>
                  <a
                    href="data:text/csv;charset=utf-8,name,alt_names,brand,barcode,category,per_100g_calories,per_100g_protein_g,per_100g_carbs_g,per_100g_fat_g,per_100g_fiber_g,per_100g_sodium_mg,common_serving_label,common_serving_grams,preparation_state,last_verified_date%0AApple,mansanas,,,fruit,52,0.3,14,0.2,2.4,1,1 medium,182,raw,%0ALucky Me Pancit Canton,,Monde Nissin,4800016641046,packaged good,440,10,60,18,3,1500,1 pack,60,n_a,2026-01-01"
                    download="kainfit-foods-template.csv"
                    className="text-xs text-primary underline underline-offset-2"
                  >
                    Download template
                  </a>
                </div>
                {importResult && (
                  <div className="text-xs text-emerald-600">{importResult}</div>
                )}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                User-submitted review queue
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                User-submitted branded products and proposed edits to verified records. Approving a
                revision applies whitelisted per-100g fields and busts the resolver cache.
              </p>

              <h3 className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pending submissions ({reviewQueue?.submissions.length ?? 0})
              </h3>
              <div className="mt-2 space-y-2">
                {(reviewQueue?.submissions ?? []).length === 0 && (
                  <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                    Nothing waiting.
                  </div>
                )}
                {reviewQueue?.submissions.map((s) => (
                  <div key={s.id} className="rounded-2xl border border-border bg-card p-3 text-sm">
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{new Date(s.created_at).toLocaleString()}</span>
                      {s.barcode && <span className="font-mono">#{s.barcode}</span>}
                      <span>status: {s.review_status}</span>
                    </div>
                    <div className="mt-1 font-medium">
                      {s.brand ? `${s.brand} — ` : ""}
                      {s.product_name ?? "(unnamed)"}
                    </div>
                    {s.serving_size && (
                      <div className="text-xs text-muted-foreground">Serving: {s.serving_size}</div>
                    )}
                    {s.extracted_values && (
                      <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/40 p-2 text-[11px]">
                        {JSON.stringify(s.extracted_values, null, 2)}
                      </pre>
                    )}
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => decide("submission", s.id, "approve")}
                        disabled={pendingDecision !== null}
                        className="rounded-xl"
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decide("submission", s.id, "reject")}
                        disabled={pendingDecision !== null}
                        className="rounded-xl"
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pending revisions ({reviewQueue?.revisions.length ?? 0})
              </h3>
              <div className="mt-2 space-y-2">
                {(reviewQueue?.revisions ?? []).length === 0 && (
                  <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                    Nothing waiting.
                  </div>
                )}
                {reviewQueue?.revisions.map((r) => (
                  <div key={r.id} className="rounded-2xl border border-border bg-card p-3 text-sm">
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{new Date(r.created_at).toLocaleString()}</span>
                      <span>status: {r.review_status}</span>
                    </div>
                    <div className="mt-1 font-medium">
                      {r.food_display_name ?? r.food_record_id}
                    </div>
                    {r.change_reason && (
                      <p className="mt-1 text-xs text-muted-foreground">{r.change_reason}</p>
                    )}
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Previous
                        </div>
                        <pre className="max-h-32 overflow-auto rounded bg-muted/40 p-2 text-[11px]">
                          {JSON.stringify(r.previous_values ?? {}, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Proposed
                        </div>
                        <pre className="max-h-32 overflow-auto rounded bg-muted/40 p-2 text-[11px]">
                          {JSON.stringify(r.proposed_values ?? {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => decide("revision", r.id, "approve")}
                        disabled={pendingDecision !== null}
                        className="rounded-xl"
                      >
                        Approve & apply
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decide("revision", r.id, "reject")}
                        disabled={pendingDecision !== null}
                        className="rounded-xl"
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
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