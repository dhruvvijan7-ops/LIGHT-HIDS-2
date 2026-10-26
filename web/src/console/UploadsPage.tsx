/* Uploads — list + real multipart ingestion against POST …/uploads.
   Idempotency-Key is sent so a double-submit replays the original 202.
   After a successful upload the page polls ingest + the auto-chained
   detection run, then opens a completion dialog with deep links to the
   exact events / run / findings produced by that upload. */

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Field } from "../components/Field";
import { EmptyState, ErrorState, LoadingRows } from "../components/States";
import {
  api,
  type DetectionRun,
  newIdempotencyKey,
  type Page,
  type Upload,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtBytes, fmtTime, runStatusClass } from "../lib/format";
import { useListPage } from "../lib/useListPage";
import { PageHead } from "./ConsoleLayout";

const TRIAGE_BADGE: Record<string, string> = {
  done: "badge-ok",
  queued: "badge-info",
  running: "badge-info",
  failed: "badge-error",
  rejected_by_policy: "badge-error",
};

const RUN_TERMINAL = [
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
];

interface UploadTrack {
  upload: Upload;
  phase: "ready" | "stalled";
  run?: DetectionRun;
  detail?: DetectionRun;
}

export function UploadsPage() {
  const { session } = useAuth();
  const key = session?.apiKey ?? "";
  const [params, setParams] = useSearchParams();
  const runFilter = params.get("run_id") ?? "";

  const list = useListPage<Upload>(
    (ws) => `/v1/workspaces/${encodeURIComponent(ws)}/uploads`,
    runFilter ? { run_id: runFilter, limit: 50 } : { limit: 50 },
  );

  const [file, setFile] = useState<File | null>(null);
  const [runId, setRunId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [collectionKind, setCollectionKind] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Upload | null>(null);
  const [track, setTrack] = useState<UploadTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idemRef = useRef(newIdempotencyKey());
  const formRef = useRef<HTMLFormElement | null>(null);

  const wsPath = `/v1/workspaces/${encodeURIComponent(session?.workspaceId ?? "")}`;

  // Poll ingest triage, then the auto-chained detection run, until terminal.
  // Opens the completion dialog on success; "stalled" after the deadline or
  // a failed/rejected upload.
  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    let timer = 0;
    const deadline = Date.now() + 90_000;

    const finish = (t: UploadTrack) => {
      if (!cancelled) setTrack(t);
    };

    const tick = async () => {
      if (cancelled) return;
      let up: Upload = result;
      try {
        up = await api<Upload>(`${wsPath}/uploads/${result.artifact_id}`, {
          apiKey: key,
        });
      } catch {
        if (Date.now() > deadline) finish({ upload: result, phase: "stalled" });
        else timer = window.setTimeout(tick, 1500);
        return;
      }
      if (
        up.triage_state === "failed" ||
        up.triage_state === "rejected_by_policy"
      ) {
        finish({ upload: up, phase: "stalled" });
        return;
      }
      if (up.triage_state !== "done") {
        if (Date.now() > deadline) finish({ upload: up, phase: "stalled" });
        else timer = window.setTimeout(tick, 1500);
        return;
      }
      try {
        const runs = await api<Page<DetectionRun>>(`${wsPath}/runs`, {
          apiKey: key,
          query: { harvest_run_id: result.run_id, limit: 10 },
        });
        const terminal = (runs.items ?? []).find((r) =>
          RUN_TERMINAL.includes(r.status),
        );
        if (terminal) {
          let detail: DetectionRun | undefined;
          try {
            detail = await api<DetectionRun>(
              `${wsPath}/runs/${terminal.run_id}`,
              {
                apiKey: key,
              },
            );
          } catch {
            /* summary is optional */
          }
          finish({ upload: up, phase: "ready", run: terminal, detail });
          return;
        }
      } catch {
        /* transient list error — retry */
      }
      if (Date.now() > deadline) finish({ upload: up, phase: "stalled" });
      else timer = window.setTimeout(tick, 1500);
    };

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [result, key, wsPath]);

  // Escape dismisses the completion dialog.
  useEffect(() => {
    if (!track) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTrack(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [track]);

  const resetForm = useCallback(() => {
    setFile(null);
    setRunId("");
    setAgentId("");
    setCollectionKind("");
    setSourcePath("");
    idemRef.current = newIdempotencyKey();
    formRef.current?.reset();
  }, []);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (busy) return;
      setError(null);
      setResult(null);
      setTrack(null);
      if (!file) {
        setError(
          "Choose exactly one file — the gate accepts a single file part.",
        );
        return;
      }
      setBusy(true);
      try {
        const fd = new FormData();
        fd.append("file", file, file.name);
        if (runId.trim()) fd.append("run_id", runId.trim());
        if (agentId.trim()) fd.append("agent_id", agentId.trim());
        if (collectionKind.trim())
          fd.append("collection_kind", collectionKind.trim());
        if (sourcePath.trim()) fd.append("source_path", sourcePath.trim());
        const res = await api<Upload>(
          `/v1/workspaces/${encodeURIComponent(session?.workspaceId ?? "")}/uploads`,
          {
            method: "POST",
            apiKey: key,
            formData: fd,
            idempotencyKey: idemRef.current,
          },
        );
        setResult(res);
        resetForm();
        list.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      file,
      runId,
      agentId,
      collectionKind,
      sourcePath,
      key,
      session,
      list,
      resetForm,
    ],
  );

  const summary = (track?.detail?.summary ?? null) as null | {
    events?: number;
    findings?: number;
  };
  const findingCount =
    summary && typeof summary.findings === "number" ? summary.findings : null;
  const eventCount =
    summary && typeof summary.events === "number" ? summary.events : null;
  const uploadFailed =
    track?.upload.triage_state === "failed" ||
    track?.upload.triage_state === "rejected_by_policy";

  return (
    <>
      <PageHead
        title="Uploads"
        subtitle="One artifact per request through the hostile-file gate. The server hashes the bytes, writes to content-addressed storage, and enqueues an ingest job."
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

      <div className="c-grid c-grid-2" style={{ alignItems: "start" }}>
        <section className="c-panel">
          <div className="c-panel-head">
            <span className="label">Upload an artifact</span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              POST …/uploads · 202
            </span>
          </div>
          <div className="c-panel-body">
            <form
              ref={formRef}
              onSubmit={submit}
              style={{ display: "grid", gap: "var(--sp-4)" }}
            >
              <Field
                label="File"
                hint="Single file part. Size is bounded by the server's ingest gate (request + file caps)."
                error={error}
              >
                {({ inputId, describedBy }) => (
                  <input
                    id={inputId}
                    className="input"
                    type="file"
                    aria-describedby={describedBy}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    disabled={busy}
                  />
                )}
              </Field>
              <Field
                label="Run grouping (optional)"
                hint="Client-supplied run_id hint. If empty the server generates one."
              >
                {({ inputId }) => (
                  <input
                    id={inputId}
                    className="input mono"
                    placeholder="run-…"
                    value={runId}
                    onChange={(e) => setRunId(e.target.value)}
                    disabled={busy}
                  />
                )}
              </Field>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <Field label="Agent ID (optional)">
                  {({ inputId }) => (
                    <input
                      id={inputId}
                      className="input mono"
                      value={agentId}
                      onChange={(e) => setAgentId(e.target.value)}
                      disabled={busy}
                    />
                  )}
                </Field>
                <Field label="Collection kind (optional)">
                  {({ inputId }) => (
                    <input
                      id={inputId}
                      className="input mono"
                      value={collectionKind}
                      onChange={(e) => setCollectionKind(e.target.value)}
                      disabled={busy}
                    />
                  )}
                </Field>
              </div>
              <Field label="Source path (optional)">
                {({ inputId }) => (
                  <input
                    id={inputId}
                    className="input mono"
                    placeholder="C:\path\to\artifact"
                    value={sourcePath}
                    onChange={(e) => setSourcePath(e.target.value)}
                    disabled={busy}
                  />
                )}
              </Field>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy}
                >
                  {busy ? "Uploading…" : "Upload"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={resetForm}
                  disabled={busy}
                >
                  Reset
                </button>
              </div>
              {result ? (
                <div
                  role="status"
                  style={{
                    border: "1px solid rgba(123,198,126,0.4)",
                    background: "var(--ok-soft)",
                    borderRadius: "var(--r-md)",
                    padding: "var(--sp-3) var(--sp-4)",
                    display: "grid",
                    gap: 6,
                    fontSize: "var(--fs-sm)",
                  }}
                >
                  <strong style={{ color: "var(--ok)" }}>
                    Accepted — triage job enqueued
                  </strong>
                  <span className="mono" style={{ color: "var(--text-2)" }}>
                    {result.artifact_id}
                  </span>
                  <span style={{ color: "var(--text-3)" }}>
                    sha256 {result.sha256.slice(0, 16)}… ·{" "}
                    {fmtBytes(result.size)} · run {result.run_id}
                  </span>
                  <Link to={`/console/uploads/${result.artifact_id}`}>
                    View artifact →
                  </Link>
                  {!track ? (
                    <span style={{ color: "var(--text-3)" }}>
                      Analyzing — ingest + detection running. A completion
                      dialog opens when they finish.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </form>
          </div>
        </section>

        <section className="c-panel">
          <div className="c-panel-head">
            <span className="label">Filter</span>
            {runFilter ? (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete("run_id");
                  setParams(next);
                }}
              >
                Clear run filter
              </button>
            ) : null}
          </div>
          <div className="c-panel-body" style={{ display: "grid", gap: 10 }}>
            <Field label="run_id">
              {({ inputId }) => (
                <input
                  id={inputId}
                  className="input mono"
                  placeholder="filter by run id"
                  defaultValue={runFilter}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const next = new URLSearchParams(params);
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v) next.set("run_id", v);
                      else next.delete("run_id");
                      setParams(next);
                    }
                  }}
                />
              )}
            </Field>
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>
              Press Enter to apply. Filters are query parameters preserved in
              the URL.
            </p>
            {list.error ? (
              <ErrorState error={list.error} onRetry={list.reload} />
            ) : null}
          </div>
        </section>
      </div>

      <section className="c-panel" style={{ marginTop: "var(--sp-5)" }}>
        <div className="c-panel-head">
          <span className="label">Artifacts</span>
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)" }}
          >
            GET …/uploads
          </span>
        </div>
        {list.loading ? (
          <div style={{ padding: 14 }}>
            <LoadingRows rows={6} cols={5} />
          </div>
        ) : list.error ? (
          <div style={{ padding: 14 }}>
            <ErrorState error={list.error} onRetry={list.reload} />
          </div>
        ) : list.items.length === 0 ? (
          <div style={{ padding: 14 }}>
            <EmptyState
              title="No artifacts yet"
              body="Upload a file to see it here. Accepted uploads show hashes, gate warnings, and triage state."
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
                  <th>Name</th>
                  <th>Triage</th>
                  <th>Size</th>
                  <th>sha256</th>
                  <th>Run</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((u) => (
                  <tr key={u.artifact_id}>
                    <td>
                      <Link to={`/console/uploads/${u.artifact_id}`}>
                        {u.display_name}
                      </Link>
                    </td>
                    <td>
                      <span
                        className={`badge ${TRIAGE_BADGE[u.triage_state] ?? "badge-plain"}`}
                      >
                        {u.triage_state.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="mono">{fmtBytes(u.size)}</td>
                    <td className="mono">{u.sha256.slice(0, 12)}…</td>
                    <td className="mono">{u.run_id}</td>
                    <td className="mono">{fmtTime(u.received_at)}</td>
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

      {track ? (
        <div className="c-modal-backdrop">
          <div
            className="c-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-track-title"
          >
            <div className="c-modal-head">
              <strong id="upload-track-title">
                {track.phase === "ready"
                  ? "Analysis complete"
                  : uploadFailed
                    ? "Upload failed triage"
                    : "Still processing"}
              </strong>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                aria-label="Close"
                onClick={() => setTrack(null)}
              >
                ✕
              </button>
            </div>
            <div className="c-modal-body">
              <div
                className="mono"
                style={{
                  fontSize: 12,
                  color: "var(--text-2)",
                  wordBreak: "break-all",
                }}
              >
                {track.upload.display_name}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  marginTop: 8,
                }}
              >
                <span
                  className={`badge ${
                    TRIAGE_BADGE[track.upload.triage_state] ?? "badge-plain"
                  }`}
                >
                  {track.upload.triage_state.replace(/_/g, " ")}
                </span>
                {track.run ? (
                  <span className={`badge ${runStatusClass(track.run.status)}`}>
                    {track.run.status}
                  </span>
                ) : null}
              </div>
              <p
                style={{
                  fontSize: "var(--fs-sm)",
                  color: "var(--text-2)",
                  marginTop: 10,
                  marginBottom: 0,
                }}
              >
                {track.phase === "ready"
                  ? `Ingest + detection finished${
                      eventCount !== null || findingCount !== null
                        ? ` · ${eventCount ?? "?"} events · ${findingCount ?? "?"} findings`
                        : ""
                    }. Jump straight to this upload's records:`
                  : uploadFailed
                    ? "The ingest gate rejected this artifact. Open the artifact page for gate details."
                    : "Ingest/detection is taking longer than expected — it may still finish. Check back on the artifact page."}
              </p>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--text-3)",
                  marginTop: 6,
                }}
              >
                harvest run {track.upload.run_id}
              </div>
            </div>
            <div className="c-modal-actions">
              <Link
                className="btn btn-sm btn-primary"
                to={`/console/events?run_id=${encodeURIComponent(track.upload.run_id)}`}
                onClick={() => setTrack(null)}
              >
                View events
              </Link>
              {track.run ? (
                <Link
                  className="btn btn-sm"
                  to={`/console/runs/${track.run.run_id}`}
                  onClick={() => setTrack(null)}
                >
                  View run
                </Link>
              ) : (
                <Link
                  className="btn btn-sm"
                  to={`/console/runs?harvest_run_id=${encodeURIComponent(track.upload.run_id)}`}
                  onClick={() => setTrack(null)}
                >
                  View runs
                </Link>
              )}
              {findingCount === 0 ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled
                  title="This run produced no findings"
                >
                  Findings (0)
                </button>
              ) : (
                <Link
                  className="btn btn-sm"
                  to={`/console/findings?run_id=${encodeURIComponent(track.run?.run_id ?? "")}`}
                  onClick={() => setTrack(null)}
                >
                  View findings
                </Link>
              )}
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setTrack(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
