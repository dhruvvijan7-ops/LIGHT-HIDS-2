/* Overview — live system health plus honest recent-activity feeds from the
   endpoints this API build actually serves. No invented counters: list
   endpoints here do not return totals, so we show the latest page only. */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState, LoadingRows } from "../components/States";
import {
  api,
  type Finding,
  type Health,
  type Readiness,
  type Upload,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  fmtBytes,
  fmtTime,
  fmtUptime,
  severityClass,
  triageClass,
} from "../lib/format";
import { PageHead } from "./ConsoleLayout";

export function OverviewPage() {
  const { session } = useAuth();
  const ws = session?.workspaceId ?? "";
  const key = session?.apiKey ?? "";

  const [health, setHealth] = useState<Health | null>(null);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [readyErr, setReadyErr] = useState<unknown>(null);
  const [uploads, setUploads] = useState<Upload[] | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [feedErr, setFeedErr] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setReadyErr(null);
    setFeedErr(null);
    Promise.allSettled([
      api<Health>("/health"),
      api<Readiness>("/ready"),
      api<{ items: Upload[] }>(
        `/v1/workspaces/${encodeURIComponent(ws)}/uploads`,
        {
          apiKey: key,
          query: { limit: 5 },
        },
      ),
      api<{ items: Finding[] }>(
        `/v1/workspaces/${encodeURIComponent(ws)}/findings`,
        {
          apiKey: key,
          query: { limit: 5 },
        },
      ),
    ]).then(([h, r, u, f]) => {
      setHealth(h.status === "fulfilled" ? h.value : null);
      if (r.status === "fulfilled") {
        setReady(r.value);
        setReadyErr(null);
      } else {
        setReady(null);
        setReadyErr(r.reason);
      }
      setUploads(u.status === "fulfilled" ? u.value.items : []);
      setFindings(f.status === "fulfilled" ? f.value.items : []);
      if (u.status === "rejected") setFeedErr(u.reason);
      else if (f.status === "rejected") setFeedErr(f.reason);
      setLoading(false);
    });
  }, [ws, key]);

  useEffect(load, [load]);

  const checkBadge = (v?: string) =>
    v === "ok" ? "badge-ok" : v === "degraded" ? "badge-warn" : "badge-plain";

  return (
    <>
      <PageHead
        title="Overview"
        subtitle={`Session scoped to workspace ${ws}. Health probes are unauthenticated; activity feeds require your key.`}
        actions={
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={load}
            disabled={loading}
          >
            Refresh
          </button>
        }
      />

      <div
        className="c-grid c-grid-stats"
        style={{ marginBottom: "var(--sp-5)" }}
      >
        <div className="c-stat">
          <span className="k">API process</span>
          <span
            className="v"
            style={{ color: health ? "var(--ok)" : "var(--text-3)" }}
          >
            {health ? "online" : "—"}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            uptime {health ? fmtUptime(health.uptime_seconds) : "unreachable"}
          </span>
        </div>
        <div className="c-stat">
          <span className="k">Readiness</span>
          <span className="v">
            {ready ? (
              <span
                className={`badge ${ready.status === "ok" ? "badge-ok" : "badge-warn"}`}
              >
                {ready.status}
              </span>
            ) : readyErr ? (
              <span className="badge badge-error">degraded</span>
            ) : (
              "—"
            )}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            {ready
              ? [
                  `db ${ready.checks?.database ?? "—"}`,
                  `store ${ready.checks?.object_store ?? "—"}`,
                  `queue ${ready.checks?.queue ?? "—"}`,
                ].join(" · ")
              : readyErr
                ? "probe failed"
                : "checking…"}
          </span>
        </div>
        <div className="c-stat">
          <span className="k">Latest uploads</span>
          <span className="v">{uploads ? uploads.length : "…"}</span>
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            most recent page (max 5)
          </span>
        </div>
        <div className="c-stat">
          <span className="k">Latest findings</span>
          <span className="v">{findings ? findings.length : "…"}</span>
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            most recent page (max 5)
          </span>
        </div>
      </div>

      {loading ? (
        <LoadingRows rows={4} cols={3} />
      ) : (
        <div className="c-grid c-grid-2">
          <section className="c-panel">
            <div className="c-panel-head">
              <span className="label">Recent uploads</span>
              <Link to="/console/uploads" style={{ fontSize: "var(--fs-sm)" }}>
                All uploads
              </Link>
            </div>
            {feedErr ? (
              <div style={{ padding: 14 }}>
                <ErrorState error={feedErr} onRetry={load} />
              </div>
            ) : uploads && uploads.length === 0 ? (
              <div style={{ padding: 14 }}>
                <p style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>
                  No artifacts uploaded yet.{" "}
                  <Link to="/console/uploads">Upload one</Link> to start the
                  pipeline.
                </p>
              </div>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Triage</th>
                    <th>Size</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {(uploads ?? []).map((u) => (
                    <tr key={u.artifact_id}>
                      <td>
                        <Link to={`/console/uploads/${u.artifact_id}`}>
                          {u.display_name}
                        </Link>
                      </td>
                      <td>
                        <span
                          className={`badge ${u.triage_state === "done" ? "badge-ok" : u.triage_state === "failed" || u.triage_state === "rejected_by_policy" ? "badge-error" : "badge-info"}`}
                        >
                          {u.triage_state.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="mono">{fmtBytes(u.size)}</td>
                      <td className="mono">{fmtTime(u.received_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="c-panel">
            <div className="c-panel-head">
              <span className="label">Recent findings</span>
              <Link to="/console/findings" style={{ fontSize: "var(--fs-sm)" }}>
                All findings
              </Link>
            </div>
            {feedErr ? (
              <div style={{ padding: 14 }}>
                <ErrorState error={feedErr} onRetry={load} />
              </div>
            ) : findings && findings.length === 0 ? (
              <div style={{ padding: 14 }}>
                <p style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>
                  No findings yet. Upload artifacts, then request a detection
                  run.
                </p>
              </div>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Severity</th>
                    <th>Triage</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(findings ?? []).map((f) => (
                    <tr key={f.finding_uid}>
                      <td>
                        <Link to={`/console/findings/${f.finding_uid}`}>
                          {f.rule_name}
                        </Link>
                      </td>
                      <td>
                        <span className={`badge ${severityClass(f.severity)}`}>
                          {f.severity}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${triageClass(f.triage_state)}`}
                        >
                          {f.triage_state.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="mono">{fmtTime(f.time_utc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      <section className="c-panel" style={{ marginTop: "var(--sp-5)" }}>
        <div className="c-panel-head">
          <span className="label">Health probes</span>
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)" }}
          >
            GET /health · GET /ready
          </span>
        </div>
        <div className="c-panel-body">
          <dl className="c-kv">
            <dt>Process</dt>
            <dd>
              {health ? (
                <>
                  <span className="badge badge-ok">ok</span>{" "}
                  <span className="mono">
                    uptime {fmtUptime(health.uptime_seconds)}
                  </span>
                </>
              ) : (
                "unreachable — is the API running?"
              )}
            </dd>
            <dt>Database</dt>
            <dd>
              {ready ? (
                <span className={`badge ${checkBadge(ready.checks?.database)}`}>
                  {ready.checks?.database ?? "—"}
                </span>
              ) : (
                "—"
              )}
            </dd>
            <dt>Object store</dt>
            <dd>
              {ready ? (
                <span
                  className={`badge ${checkBadge(ready.checks?.object_store)}`}
                >
                  {ready.checks?.object_store ?? "—"}
                </span>
              ) : (
                "—"
              )}
            </dd>
            <dt>Job queue</dt>
            <dd>
              {ready ? (
                <span className={`badge ${checkBadge(ready.checks?.queue)}`}>
                  {ready.checks?.queue ?? "—"}
                </span>
              ) : (
                "—"
              )}
            </dd>
          </dl>
        </div>
      </section>
    </>
  );
}
