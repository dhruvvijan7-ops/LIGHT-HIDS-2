/* Findings — detection results list with severity/triage filters and inline
   triage PATCH (the one audited mutation on this resource). */

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, LoadingRows } from "../components/States";
import { api, type Finding, type TriageState } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtTime, severityClass, triageClass } from "../lib/format";
import { useListPage } from "../lib/useListPage";
import { PageHead } from "./ConsoleLayout";

const TRIAGE_OPTIONS: TriageState[] = [
  "new",
  "acknowledged",
  "escalated",
  "resolved",
  "false_positive",
];

export function FindingsPage() {
  const { session } = useAuth();
  const key = session?.apiKey ?? "";
  const [params, setParams] = useSearchParams();
  const severity = params.get("severity") ?? "";
  const triage = params.get("triage_state") ?? "";
  const runFilter = params.get("run_id") ?? "";
  const hasFilter = Boolean(severity || triage || runFilter);

  const [runDraft, setRunDraft] = useState(runFilter);
  useEffect(() => setRunDraft(runFilter), [runFilter]);

  const list = useListPage<Finding>(
    (ws) => `/v1/workspaces/${encodeURIComponent(ws)}/findings`,
    {
      limit: 50,
      severity: severity || undefined,
      triage_state: triage || undefined,
      run_id: runFilter || undefined,
    },
  );

  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next);
  };

  const applyRun = () => {
    setParam("run_id", runDraft.trim());
  };

  const patchTriage = async (findingUid: string, state: TriageState) => {
    setBusyId(findingUid);
    setErr(null);
    try {
      await api(
        `/v1/workspaces/${encodeURIComponent(session?.workspaceId ?? "")}/findings/${encodeURIComponent(findingUid)}`,
        { apiKey: key, method: "PATCH", body: { triage_state: state } },
      );
      list.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Triage update failed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHead
        title="Findings"
        subtitle="Detections produced by runs. Each finding keeps a frozen evidence snapshot and a dedupe fingerprint; triage changes are written to the audit log."
        actions={
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={list.reload}
            disabled={list.loading}
          >
            Refresh
          </button>
        }
      />

      <div className="c-filters">
        <label>
          Severity
          <select
            className="select"
            value={severity}
            onChange={(e) => setParam("severity", e.target.value)}
          >
            <option value="">All</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
          </select>
        </label>
        <label>
          Triage state
          <select
            className="select"
            value={triage}
            onChange={(e) => setParam("triage_state", e.target.value)}
          >
            <option value="">All</option>
            {TRIAGE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Run ID
          <input
            className="input mono"
            placeholder="detection run uuid"
            value={runDraft}
            onChange={(e) => setRunDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyRun();
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={applyRun}
          style={{ alignSelf: "end" }}
        >
          Apply run
        </button>
        {hasFilter && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setParams(new URLSearchParams())}
          >
            Clear filters
          </button>
        )}
      </div>

      {err ? (
        <div style={{ marginBottom: 14 }}>
          <ErrorState error={new Error(err)} />
        </div>
      ) : null}

      <section className="c-panel">
        <div className="c-panel-head">
          <span className="label">Findings</span>
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)" }}
          >
            GET …/findings · PATCH …/findings/{"{uid}"}
          </span>
        </div>
        {runFilter && !list.loading && !list.error ? (
          <div className="c-filter-note" role="status">
            <span>
              Highlighting findings produced by detection run{" "}
              <code className="mono">{runFilter}</code>
            </span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setParams(new URLSearchParams())}
            >
              Show all findings
            </button>
          </div>
        ) : null}
        {list.loading ? (
          <div style={{ padding: 14 }}>
            <LoadingRows rows={8} cols={5} />
          </div>
        ) : list.error ? (
          <div style={{ padding: 14 }}>
            <ErrorState error={list.error} onRetry={list.reload} />
          </div>
        ) : list.items.length === 0 ? (
          <div style={{ padding: 14 }}>
            <EmptyState
              title={
                hasFilter
                  ? "No findings match the current filters"
                  : "No findings yet"
              }
              body={
                hasFilter
                  ? "No findings match these filters. Clear them to see everything, or check the run id is a detection-run UUID (not a harvest run-… id)."
                  : "Findings appear after a detection run evaluates stored events against enabled rules. Upload artifacts, then request a run."
              }
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
                  <th>Severity</th>
                  <th>Host</th>
                  <th>Time</th>
                  <th>Path</th>
                  <th>Triage</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((f) => (
                  <tr key={f.finding_uid}>
                    <td>
                      <Link to={`/console/findings/${f.finding_uid}`}>
                        {f.rule_name}
                      </Link>
                      <div
                        className="mono"
                        style={{ fontSize: 11, color: "var(--text-3)" }}
                      >
                        {f.kind} · {f.author}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${severityClass(f.severity)}`}>
                        {f.severity}
                      </span>
                    </td>
                    <td className="mono">{f.host_hostname ?? "—"}</td>
                    <td className="mono">{fmtTime(f.time_utc)}</td>
                    <td className="mono">{f.detection_path}</td>
                    <td>
                      <select
                        className="select"
                        style={{
                          minWidth: 150,
                          fontSize: 12,
                          padding: "5px 8px",
                        }}
                        value={f.triage_state}
                        disabled={busyId === f.finding_uid}
                        aria-label={`Triage state for ${f.rule_name}`}
                        onChange={(e) =>
                          patchTriage(
                            f.finding_uid,
                            e.target.value as TriageState,
                          )
                        }
                      >
                        {TRIAGE_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                      <div style={{ marginTop: 4 }}>
                        <span
                          className={`badge ${triageClass(f.triage_state)}`}
                        >
                          {busyId === f.finding_uid
                            ? "saving…"
                            : f.triage_state.replace(/_/g, " ")}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="c-pager" style={{ padding: "0 14px 14px" }}>
          <span>
            {list.items.length} shown
            {list.pageDepth > 0 ? ` · page ${list.pageDepth + 1}` : ""}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={list.goPrev}
              disabled={!list.canGoPrev}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={list.goNext}
              disabled={!list.next}
            >
              Next
            </button>
          </span>
        </div>
      </section>
    </>
  );
}
