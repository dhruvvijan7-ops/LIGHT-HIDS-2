/* Upload detail — GET …/uploads/{artifactId}. Metadata only; raw bytes are
   served by the storage tier, not this endpoint. The "Explore" panel resolves
   the auto-chained detection run via runs?harvest_run_id and deep-links to
   this upload's events / run / findings / rules / jobs. */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CopyButton } from "../components/Json";
import { ErrorState, LoadingRows } from "../components/States";
import { api, type DetectionRun, type Page, type Upload } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtBytes, fmtTime, runStatusClass } from "../lib/format";
import { PageHead } from "./ConsoleLayout";

type RunState = "resolving" | "ready" | "none";

export function UploadDetailPage() {
  const { artifactId = "" } = useParams();
  const { session } = useAuth();
  const key = session?.apiKey ?? "";
  const ws = session?.workspaceId ?? "";

  const [item, setItem] = useState<Upload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [detRun, setDetRun] = useState<DetectionRun | null>(null);
  const [detDetail, setDetDetail] = useState<DetectionRun | null>(null);
  const [runState, setRunState] = useState<RunState>("resolving");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<Upload>(
      `/v1/workspaces/${encodeURIComponent(ws)}/uploads/${encodeURIComponent(artifactId)}`,
      {
        apiKey: key,
      },
    )
      .then(setItem)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [ws, key, artifactId]);

  useEffect(load, [load]);

  // Resolve the detection run chained from this upload (scope.harvest_run_id).
  // Polls while ingest is still in flight; gives up on terminal-failed triage
  // or after the deadline.
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    let timer = 0;
    const deadline = Date.now() + 90_000;
    setRunState("resolving");
    setDetRun(null);
    setDetDetail(null);

    const giveUp = () => {
      if (!cancelled) setRunState("none");
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        const runs = await api<Page<DetectionRun>>(
          `/v1/workspaces/${encodeURIComponent(ws)}/runs`,
          {
            apiKey: key,
            query: { harvest_run_id: item.run_id, limit: 10 },
          },
        );
        const found = (runs.items ?? [])[0];
        if (found) {
          if (cancelled) return;
          setDetRun(found);
          setRunState("ready");
          api<DetectionRun>(
            `/v1/workspaces/${encodeURIComponent(ws)}/runs/${encodeURIComponent(found.run_id)}`,
            { apiKey: key },
          )
            .then((d) => {
              if (!cancelled) setDetDetail(d);
            })
            .catch(() => {
              /* summary is optional */
            });
          return;
        }
      } catch {
        /* transient — retry below */
      }
      if (
        item.triage_state === "failed" ||
        item.triage_state === "rejected_by_policy" ||
        Date.now() > deadline
      ) {
        giveUp();
        return;
      }
      timer = window.setTimeout(tick, 2000);
    };

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [item, key, ws]);

  const summary = (detDetail?.summary ?? null) as null | {
    events?: number;
    findings?: number;
  };
  const findingCount =
    summary && typeof summary.findings === "number" ? summary.findings : null;
  const eventCount =
    summary && typeof summary.events === "number" ? summary.events : null;

  return (
    <>
      <PageHead
        title={item?.display_name ?? "Artifact"}
        subtitle="Accepted-upload record: hashes, gate state, and triage status."
        actions={
          <Link to="/console/uploads" className="btn btn-sm btn-ghost">
            ← All uploads
          </Link>
        }
      />

      {loading ? (
        <LoadingRows rows={5} cols={2} />
      ) : error ? (
        <ErrorState error={error} onRetry={load} />
      ) : item ? (
        <>
          <div className="c-grid c-grid-2" style={{ alignItems: "start" }}>
            <section className="c-panel">
              <div className="c-panel-head">
                <span className="label">Metadata</span>
                <span
                  className={`badge ${
                    item.triage_state === "done"
                      ? "badge-ok"
                      : item.triage_state === "failed" ||
                          item.triage_state === "rejected_by_policy"
                        ? "badge-error"
                        : "badge-info"
                  }`}
                >
                  {item.triage_state.replace(/_/g, " ")}
                </span>
              </div>
              <div className="c-panel-body">
                <dl className="c-kv">
                  <dt>Artifact ID</dt>
                  <dd className="mono">{item.artifact_id}</dd>
                  <dt>Run ID</dt>
                  <dd className="mono">
                    <Link
                      to={`/console/runs?harvest_run_id=${encodeURIComponent(item.run_id)}`}
                      title="Show detection runs chained from this upload"
                    >
                      {item.run_id}
                    </Link>
                  </dd>
                  <dt>Size</dt>
                  <dd className="mono">{fmtBytes(item.size)}</dd>
                  <dt>Received</dt>
                  <dd className="mono">{fmtTime(item.received_at)}</dd>
                  <dt>Agent</dt>
                  <dd className="mono">{item.agent_id ?? "—"}</dd>
                  <dt>Collection kind</dt>
                  <dd className="mono">{item.collection_kind ?? "—"}</dd>
                </dl>
              </div>
            </section>

            <section className="c-panel">
              <div className="c-panel-head">
                <span className="label">Content hashes</span>
              </div>
              <div
                className="c-panel-body"
                style={{ display: "grid", gap: 12 }}
              >
                {(["sha256", "sha1", "md5"] as const).map((alg) => (
                  <div key={alg} style={{ display: "grid", gap: 4 }}>
                    <span className="label">{alg}</span>
                    <div
                      style={{ display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <code
                        className="mono"
                        style={{
                          fontSize: 12,
                          color: "var(--text-2)",
                          wordBreak: "break-all",
                          flex: 1,
                        }}
                      >
                        {item[alg] ?? "—"}
                      </code>
                      {item[alg] ? (
                        <CopyButton text={item[alg] as string} />
                      ) : null}
                    </div>
                  </div>
                ))}
                {item.gate_warnings && item.gate_warnings.length > 0 ? (
                  <div>
                    <span className="label">Gate warnings</span>
                    <ul
                      style={{
                        margin: "6px 0 0",
                        paddingLeft: 18,
                        color: "var(--warn)",
                        fontSize: "var(--fs-sm)",
                      }}
                    >
                      {item.gate_warnings.map((w) => (
                        <li key={w} className="mono">
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p
                    style={{ fontSize: "var(--fs-sm)", color: "var(--text-3)" }}
                  >
                    No gate warnings recorded for this artifact.
                  </p>
                )}
                <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>
                  Raw object bytes are not served by this endpoint; evidence
                  access goes through a finding's evidence bundle while the
                  object is hot.
                </p>
              </div>
            </section>
          </div>

          <section className="c-panel" style={{ marginTop: "var(--sp-5)" }}>
            <div className="c-panel-head">
              <span className="label">Explore this upload</span>
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--text-3)" }}
              >
                harvest run {item.run_id}
              </span>
            </div>
            <div className="c-panel-body">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <Link
                  className="btn btn-sm btn-primary"
                  to={`/console/events?run_id=${encodeURIComponent(item.run_id)}`}
                >
                  View events
                </Link>
                <Link
                  className="btn btn-sm"
                  to={`/console/runs?harvest_run_id=${encodeURIComponent(item.run_id)}`}
                >
                  View runs
                </Link>
                {detRun ? (
                  <Link
                    className="btn btn-sm"
                    to={`/console/runs/${encodeURIComponent(detRun.run_id)}`}
                  >
                    Detection run
                    <span
                      className={`badge ${runStatusClass(detRun.status)}`}
                      style={{ marginLeft: 8 }}
                    >
                      {detRun.status.replace(/_/g, " ")}
                    </span>
                  </Link>
                ) : (
                  <span
                    className="btn btn-sm"
                    aria-disabled="true"
                    style={{ opacity: 0.6, cursor: "default" }}
                    title={
                      runState === "resolving"
                        ? "Waiting for the chained detection run to be created"
                        : "No detection run exists for this upload yet"
                    }
                  >
                    Detection run{" "}
                    {runState === "resolving" ? "resolving…" : "not created"}
                  </span>
                )}
                {findingCount === 0 ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled
                    title="The detection run produced no findings"
                  >
                    Findings (0)
                  </button>
                ) : detRun ? (
                  <Link
                    className="btn btn-sm"
                    to={`/console/findings?run_id=${encodeURIComponent(detRun.run_id)}`}
                  >
                    View findings
                  </Link>
                ) : (
                  <span
                    className="btn btn-sm"
                    aria-disabled="true"
                    style={{ opacity: 0.6, cursor: "default" }}
                    title="Findings deep-link appears once the detection run exists"
                  >
                    View findings
                  </span>
                )}
                <Link className="btn btn-sm" to="/console/rules">
                  Rules
                </Link>
                <Link className="btn btn-sm" to="/console/jobs">
                  Jobs
                </Link>
              </div>
              <p
                style={{
                  marginTop: 10,
                  fontSize: "var(--fs-xs)",
                  color: "var(--text-3)",
                }}
              >
                {eventCount !== null || findingCount !== null
                  ? `${eventCount ?? "?"} events · ${findingCount ?? "?"} findings for this run. `
                  : ""}
                Events, runs, and findings filter to this upload's harvest run;
                the detection run page shows per-rule accounting for its rules.
                Jobs are matched by job id (the list endpoint is not served in
                this API build).
              </p>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
