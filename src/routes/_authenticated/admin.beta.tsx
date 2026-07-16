import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBetaMetrics, exportBetaCsv } from "@/lib/beta.functions";
import { Button } from "@/components/ui/button";
import { Download, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";

export const Route = createFileRoute("/_authenticated/admin/beta")({
  head: () => ({ meta: [{ title: "Founder dashboard — KainFit" }, { name: "robots", content: "noindex" }] }),
  component: AdminBetaPage,
});

function AdminBetaPage() {
  const fetchMetrics = useServerFn(getBetaMetrics);
  const exportFn = useServerFn(exportBetaCsv);

  const { data, isLoading, error } = useQuery({
    queryKey: ["beta-metrics"],
    queryFn: () => fetchMetrics(),
    retry: false,
  });

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