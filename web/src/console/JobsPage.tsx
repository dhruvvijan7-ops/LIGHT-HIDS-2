/* Jobs — operator view. In this API build only POST …/jobs/{id} (retry) is
   served; list/get are declared in openapi.yaml but not routed yet. The page
   states that honestly and still exposes the real retry action for operators
   who hold a job id from logs. */

import { type FormEvent, useState } from "react";
import { Field } from "../components/Field";
import { EmptyState } from "../components/States";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PageHead } from "./ConsoleLayout";

export function JobsPage() {
  const { session } = useAuth();
  const key = session?.apiKey ?? "";
  const ws = session?.workspaceId ?? "";

  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const retry = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !jobId.trim()) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await api(
        `/v1/workspaces/${encodeURIComponent(ws)}/jobs/${encodeURIComponent(jobId.trim())}`,
        {
          apiKey: key,
          method: "POST",
        },
      );
      setMsg("Job re-queued (202). The retry is recorded in the audit log.");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Retry failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="Jobs"
        subtitle="Background work queued by the platform: ingest, detect, IOC import, purge, maintenance."
      />

      <div className="c-grid c-grid-2" style={{ alignItems: "start" }}>
        <section className="c-panel">
          <div className="c-panel-head">
            <span className="label">Job list</span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              GET …/jobs
            </span>
          </div>
          <div style={{ padding: 14 }}>
            <EmptyState
              title="List endpoint not served in this API build"
              body={
                <>
                  <code className="mono">GET /v1/workspaces/{"{id}"}/jobs</code>{" "}
                  is declared in <code className="mono">openapi.yaml</code> but
                  is not routed by the running API (the M2 slice serves the
                  retry action only). Job ids surface in operator logs; this
                  screen will list them once the list endpoint ships.
                </>
              }
            />
          </div>
        </section>

        <section className="c-panel">
          <div className="c-panel-head">
            <span className="label">Retry a job</span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              POST …/jobs/{"{id}"} · 202
            </span>
          </div>
          <div className="c-panel-body">
            <form
              onSubmit={retry}
              style={{ display: "grid", gap: "var(--sp-4)" }}
            >
              <Field
                label="Job ID"
                hint="Paste the UUID of a failed or dead job. Retrying a job in a non-retryable state returns 409."
                error={err}
              >
                {({ inputId, describedBy }) => (
                  <input
                    id={inputId}
                    className="input mono"
                    placeholder="uuid"
                    value={jobId}
                    onChange={(e) => setJobId(e.target.value)}
                    aria-describedby={describedBy}
                    disabled={busy}
                  />
                )}
              </Field>
              <div>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={busy || !jobId.trim()}
                >
                  {busy ? "Re-queueing…" : "Re-queue job"}
                </button>
              </div>
              {msg ? (
                <p
                  role="status"
                  style={{ color: "var(--ok)", fontSize: "var(--fs-sm)" }}
                >
                  {msg}
                </p>
              ) : null}
            </form>
          </div>
        </section>
      </div>
    </>
  );
}
