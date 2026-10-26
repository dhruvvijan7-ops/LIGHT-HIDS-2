/* Run detail — status, scope, summary, and per-rule accounting. */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { JsonBlock } from "../components/Json";
import { EmptyState, ErrorState, LoadingRows } from "../components/States";
import { api, type DetectionRun, type RuleRun } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtNum, fmtTime, runStatusClass, shortHash } from "../lib/format";
import { PageHead } from "./ConsoleLayout";

export function RunDetailPage() {
  const { runId = "" } = useParams();
  const { session } = useAuth();
  const key = session?.apiKey ?? "";
  const ws = session?.workspaceId ?? "";

  const [run, setRun] = useState<DetectionRun | null>(null);
  const [ruleRuns, setRuleRuns] = useState<RuleRun[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.allSettled([
      api<DetectionRun>(
        `/v1/workspaces/${encodeURIComponent(ws)}/runs/${encodeURIComponent(runId)}`,
        {
          apiKey: key,
        },
      ),
      api<{ items: RuleRun[] }>(
        `/v1/workspaces/${encodeURIComponent(ws)}/runs/${encodeURIComponent(runId)}/rule-runs`,
        { apiKey: key },
      ),
    ]).then(([r, rr]) => {
      if (r.status === "fulfilled") setRun(r.value);
      else setError(r.reason);
      if (rr.status === "fulfilled") setRuleRuns(rr.value.items ?? []);
      setLoading(false);
    });
  }, [ws, key, runId]);

  useEffect(load, [load]);

  return (
    <>
      <PageHead
        title={`Run ${runId.slice(0, 8)}…`}
        subtitle="Detection run — scope, configuration fingerprint, and per-rule accounting."
        actions={
          <>
            <Link to="/console/runs" className="btn btn-sm btn-ghost">
              ← All runs
            </Link>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={load}
              disabled={loading}
            >
              Refresh
            </button>
          </>
        }
      />

      {loading ? (
        <LoadingRows rows={5} cols={2} />
      ) : error ? (
        <ErrorState error={error} onRetry={load} />
      ) : run ? (
        <div className="c-grid" style={{ gap: "var(--sp-4)" }}>
          <section className="c-panel">
            <div className="c-panel-head">
              <span className="label">Run</span>
              <span className={`badge ${runStatusClass(run.status)}`}>
                {run.status.replace(/_/g, " ")}
              </span>
            </div>
            <div className="c-panel-body">
              <dl className="c-kv">
                <dt>Run ID</dt>
                <dd className="mono">{run.run_id}</dd>
                <dt>Status</dt>
                <dd>
                  <span className={`badge ${runStatusClass(run.status)}`}>
                    {run.status.replace(/_/g, " ")}
                  </span>
                </dd>
                <dt>Config hash</dt>
                <dd className="mono" title={run.config_hash}>
                  {run.config_hash ? shortHash(run.config_hash, 20) : "—"}
                </dd>
                <dt>Created</dt>
                <dd className="mono">{fmtTime(run.created_at)}</dd>
                <dt>Started</dt>
                <dd className="mono">{fmtTime(run.started_at)}</dd>
                <dt>Finished</dt>
                <dd className="mono">{fmtTime(run.finished_at)}</dd>
              </dl>
            </div>
          </section>

          {run.scope && Object.keys(run.scope).length > 0 ? (
            <section className="c-panel">
              <div className="c-panel-head">
                <span className="label">Scope</span>
              </div>
              <div className="c-panel-body">
                <JsonBlock data={run.scope} maxHeight={220} copyable={false} />
              </div>
            </section>
          ) : null}

          {run.summary ? (
            <section className="c-panel">
              <div className="c-panel-head">
                <span className="label">Summary</span>
              </div>
              <div className="c-panel-body">
                <JsonBlock
                  data={run.summary}
                  maxHeight={280}
                  copyable={false}
                />
              </div>
            </section>
          ) : null}

          <section className="c-panel">
            <div className="c-panel-head">
              <span className="label">Per-rule accounting</span>
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--text-3)" }}
              >
                GET …/rule-runs
              </span>
            </div>
            {ruleRuns.length === 0 ? (
              <div style={{ padding: 14 }}>
                <EmptyState
                  title="No rule-run rows yet"
                  body="Per-rule accounting appears once the run's rules have executed."
                />
              </div>
            ) : (
              <div
                className="table-wrap"
                style={{ border: "none", borderRadius: 0 }}
              >
                <table className="data">
                  <thead>
                    <tr>
                      <th>Rule</th>
                      <th>Outcome</th>
                      <th>Path</th>
                      <th>Events</th>
                      <th>Findings</th>
                      <th>SQL ms</th>
                      <th>Native ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ruleRuns.map((rr) => (
                      <tr key={rr.rule_id}>
                        <td className="mono">{rr.rule_id.slice(0, 12)}…</td>
                        <td>
                          <span
                            className={`badge ${
                              rr.outcome === "ok"
                                ? "badge-ok"
                                : rr.outcome === "ok_partial" ||
                                    rr.outcome === "skipped"
                                  ? "badge-warn"
                                  : rr.outcome === "error" ||
                                      rr.outcome === "rejected"
                                    ? "badge-error"
                                    : "badge-plain"
                            }`}
                          >
                            {rr.outcome.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="mono">{rr.detection_path ?? "—"}</td>
                        <td className="mono">{fmtNum(rr.processed_events)}</td>
                        <td className="mono">{fmtNum(rr.findings)}</td>
                        <td className="mono">{fmtNum(rr.sql_ms)}</td>
                        <td className="mono">{fmtNum(rr.native_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
