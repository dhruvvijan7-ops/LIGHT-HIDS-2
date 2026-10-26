/* Runs — detection run list + request form (POST …/runs, 202).
   `?harvest_run_id=` narrows the list to runs auto-chained from an upload. */

import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Field } from "../components/Field";
import { EmptyState, ErrorState, LoadingRows } from "../components/States";
import {
  api,
  type DetectionRun,
  newIdempotencyKey,
  type RunRequest,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtTime, runStatusClass } from "../lib/format";
import { useListPage } from "../lib/useListPage";
import { PageHead } from "./ConsoleLayout";

export function RunsPage() {
  const { session } = useAuth();
  const key = session?.apiKey ?? "";
  const ws = session?.workspaceId ?? "";
  const [params, setParams] = useSearchParams();
  const harvestFilter = params.get("harvest_run_id") ?? "";

  const [harvestDraft, setHarvestDraft] = useState(harvestFilter);
  useEffect(() => setHarvestDraft(harvestFilter), [harvestFilter]);

  const list = useListPage<DetectionRun>(
    (w) => `/v1/workspaces/${encodeURIComponent(w)}/runs`,
    {
      limit: 50,
      harvest_run_id: harvestFilter || undefined,
    },
  );

  const applyHarvest = () => {
    const next = new URLSearchParams(params);
    const v = harvestDraft.trim();
    if (v) next.set("harvest_run_id", v);
    else next.delete("harvest_run_id");
    setParams(next);
  };

  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [hosts, setHosts] = useState("");
  const [categories, setCategories] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<DetectionRun | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    setCreated(null);
    try {
      const body: RunRequest = {};
      if (since.trim()) body.since = since.trim();
      if (until.trim()) body.until = until.trim();
      if (hosts.trim())
        body.hosts = hosts
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (categories.trim())
        body.categories = categories
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      const res = await api<DetectionRun>(
        `/v1/workspaces/${encodeURIComponent(ws)}/runs`,
        {
          apiKey: key,
          method: "POST",
          body,
          idempotencyKey: newIdempotencyKey(),
        },
      );
      setCreated(res);
      list.reload();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Run request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="Detection runs"
        subtitle="Request an on-demand evaluation of stored events against enabled rules. Each run records config hash, timing, and per-rule accounting."
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
            <span className="label">Request a run</span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              POST …/runs · 202
            </span>
          </div>
          <div className="c-panel-body">
            <form
              onSubmit={submit}
              style={{ display: "grid", gap: "var(--sp-4)" }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <Field label="Since (ISO-8601, optional)">
                  {({ inputId }) => (
                    <input
                      id={inputId}
                      className="input mono"
                      placeholder="2026-01-01T00:00:00Z"
                      value={since}
                      onChange={(e) => setSince(e.target.value)}
                      disabled={busy}
                    />
                  )}
                </Field>
                <Field label="Until (ISO-8601, optional)">
                  {({ inputId }) => (
                    <input
                      id={inputId}
                      className="input mono"
                      placeholder="2026-12-31T23:59:59Z"
                      value={until}
                      onChange={(e) => setUntil(e.target.value)}
                      disabled={busy}
                    />
                  )}
                </Field>
              </div>
              <Field label="Hosts (comma-separated, optional)">
                {({ inputId }) => (
                  <input
                    id={inputId}
                    className="input mono"
                    placeholder="WS-DEMO01, WS-DEMO02"
                    value={hosts}
                    onChange={(e) => setHosts(e.target.value)}
                    disabled={busy}
                  />
                )}
              </Field>
              <Field label="Categories (comma-separated, optional)">
                {({ inputId }) => (
                  <input
                    id={inputId}
                    className="input mono"
                    placeholder="process, network"
                    value={categories}
                    onChange={(e) => setCategories(e.target.value)}
                    disabled={busy}
                  />
                )}
              </Field>
              <div>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                >
                  {busy ? "Requesting…" : "Request run"}
                </button>
              </div>
              {err ? (
                <p
                  role="alert"
                  style={{ color: "var(--error)", fontSize: "var(--fs-sm)" }}
                >
                  {err}
                </p>
              ) : null}
              {created ? (
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
                  <strong style={{ color: "var(--ok)" }}>Run accepted</strong>
                  <span className="mono">{created.run_id}</span>
                  <Link to={`/console/runs/${created.run_id}`}>Open run →</Link>
                </div>
              ) : null}
            </form>
          </div>
        </section>

        <section className="c-panel">
          <div className="c-panel-head">
            <span className="label">Runs</span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              GET …/runs
            </span>
          </div>
          <div className="c-filters" style={{ padding: "10px 14px 0" }}>
            <label>
              Harvest run ID
              <input
                className="input mono"
                placeholder="run-… (from an upload)"
                value={harvestDraft}
                onChange={(e) => setHarvestDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyHarvest();
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={applyHarvest}
            >
              Apply
            </button>
            {harvestFilter ? (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete("harvest_run_id");
                  setParams(next);
                }}
              >
                Show all runs
              </button>
            ) : null}
          </div>
          {harvestFilter && !list.loading && !list.error ? (
            <div className="c-filter-note" role="status">
              <span>
                Highlighting detection run(s) auto-chained from harvest run{" "}
                <code className="mono">{harvestFilter}</code>
              </span>
            </div>
          ) : null}
          {list.loading ? (
            <div style={{ padding: 14 }}>
              <LoadingRows rows={6} cols={4} />
            </div>
          ) : list.error ? (
            <div style={{ padding: 14 }}>
              <ErrorState error={list.error} onRetry={list.reload} />
            </div>
          ) : list.items.length === 0 ? (
            <div style={{ padding: 14 }}>
              <EmptyState
                title={
                  harvestFilter
                    ? "No detection runs for this harvest run"
                    : "No runs yet"
                }
                body={
                  harvestFilter
                    ? "No detection run is linked to that harvest run id (yet). Auto-chained runs appear once the upload's ingest job completes."
                    : "Request a detection run to evaluate stored events."
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
                    <th>Run</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Finished</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((r) => (
                    <tr key={r.run_id}>
                      <td className="mono">
                        <Link to={`/console/runs/${r.run_id}`}>
                          {r.run_id.slice(0, 12)}…
                        </Link>
                      </td>
                      <td>
                        <span className={`badge ${runStatusClass(r.status)}`}>
                          {r.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="mono">{fmtTime(r.created_at)}</td>
                      <td className="mono">{fmtTime(r.finished_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
