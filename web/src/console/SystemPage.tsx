/* System — health, readiness, and the Prometheus exposition at /metrics.
   Metrics are operator-facing text; rendered read-only. */

import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingRows } from "../components/States";
import { api, type Health, type Readiness } from "../lib/api";
import { fmtUptime } from "../lib/format";
import { PageHead } from "./ConsoleLayout";

export function SystemPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [readyErr, setReadyErr] = useState<unknown>(null);
  const [metrics, setMetrics] = useState<string | null>(null);
  const [metricsErr, setMetricsErr] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setReadyErr(null);
    setMetricsErr(null);
    Promise.allSettled([
      api<Health>("/health"),
      api<Readiness>("/ready"),
      fetch("/metrics", { headers: { Accept: "text/plain" } }).then(
        async (r) => {
          if (!r.ok) throw new Error(`metrics returned HTTP ${r.status}`);
          return r.text();
        },
      ),
    ]).then(([h, r, m]) => {
      setHealth(h.status === "fulfilled" ? h.value : null);
      if (r.status === "fulfilled") setReady(r.value);
      else setReadyErr(r.reason);
      if (m.status === "fulfilled") setMetrics(m.value);
      else setMetricsErr(m.reason);
      setLoading(false);
    });
  }, []);

  useEffect(load, [load]);

  const checkBadge = (v?: string) =>
    v === "ok" ? "badge-ok" : v === "degraded" ? "badge-warn" : "badge-plain";

  return (
    <>
      <PageHead
        title="System"
        subtitle="Liveness, readiness, and Prometheus metrics exposed by the API process."
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

      {loading ? (
        <LoadingRows rows={4} cols={2} />
      ) : (
        <div className="c-grid" style={{ gap: "var(--sp-4)" }}>
          <div className="c-grid c-grid-2" style={{ alignItems: "start" }}>
            <section className="c-panel">
              <div className="c-panel-head">
                <span className="label">Liveness</span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--text-3)" }}
                >
                  GET /health
                </span>
              </div>
              <div className="c-panel-body">
                {health ? (
                  <dl className="c-kv">
                    <dt>Status</dt>
                    <dd>
                      <span className="badge badge-ok">{health.status}</span>
                    </dd>
                    <dt>Uptime</dt>
                    <dd className="mono">{fmtUptime(health.uptime_seconds)}</dd>
                  </dl>
                ) : (
                  <ErrorState
                    error={
                      new Error(
                        "Health endpoint unreachable — is the API running?",
                      )
                    }
                  />
                )}
              </div>
            </section>

            <section className="c-panel">
              <div className="c-panel-head">
                <span className="label">Readiness</span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--text-3)" }}
                >
                  GET /ready
                </span>
              </div>
              <div className="c-panel-body">
                {ready ? (
                  <dl className="c-kv">
                    <dt>Status</dt>
                    <dd>
                      <span
                        className={`badge ${ready.status === "ok" ? "badge-ok" : "badge-warn"}`}
                      >
                        {ready.status}
                      </span>
                    </dd>
                    <dt>Database</dt>
                    <dd>
                      <span
                        className={`badge ${checkBadge(ready.checks?.database)}`}
                      >
                        {ready.checks?.database ?? "—"}
                      </span>
                    </dd>
                    <dt>Object store</dt>
                    <dd>
                      <span
                        className={`badge ${checkBadge(ready.checks?.object_store)}`}
                      >
                        {ready.checks?.object_store ?? "—"}
                      </span>
                    </dd>
                    <dt>Queue</dt>
                    <dd>
                      <span
                        className={`badge ${checkBadge(ready.checks?.queue)}`}
                      >
                        {ready.checks?.queue ?? "—"}
                      </span>
                    </dd>
                  </dl>
                ) : (
                  <ErrorState error={readyErr} onRetry={load} />
                )}
              </div>
            </section>
          </div>

          <section className="c-panel">
            <div className="c-panel-head">
              <span className="label">Prometheus metrics</span>
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--text-3)" }}
              >
                GET /metrics
              </span>
            </div>
            <div className="c-panel-body">
              {metrics ? (
                <pre
                  style={{
                    margin: 0,
                    maxHeight: 480,
                    overflow: "auto",
                    fontSize: 11.5,
                    lineHeight: 1.5,
                    color: "var(--text-2)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {metrics}
                </pre>
              ) : metricsErr ? (
                <ErrorState error={metricsErr} onRetry={load} />
              ) : (
                <p style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>
                  No metrics body.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
