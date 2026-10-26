/* Finding detail — full record + evidence snapshot + triage PATCH. */

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Field } from "../components/Field";
import { JsonBlock } from "../components/Json";
import { ErrorState, LoadingRows } from "../components/States";
import { api, type Finding, type TriageState } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  fmtNum,
  fmtTime,
  severityClass,
  shortHash,
  triageClass,
} from "../lib/format";
import { PageHead } from "./ConsoleLayout";

const TRIAGE_OPTIONS: TriageState[] = [
  "new",
  "acknowledged",
  "escalated",
  "resolved",
  "false_positive",
];

export function FindingDetailPage() {
  const { findingUid = "" } = useParams();
  const { session } = useAuth();
  const key = session?.apiKey ?? "";
  const ws = session?.workspaceId ?? "";

  const [item, setItem] = useState<Finding | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const [triage, setTriage] = useState<TriageState>("new");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<Finding>(
      `/v1/workspaces/${encodeURIComponent(ws)}/findings/${encodeURIComponent(findingUid)}`,
      {
        apiKey: key,
      },
    )
      .then((f) => {
        setItem(f);
        setTriage(f.triage_state);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [ws, key, findingUid]);

  useEffect(load, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || !item) return;
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    try {
      const body: { triage_state: TriageState; note?: string } = {
        triage_state: triage,
      };
      if (note.trim()) body.note = note.trim().slice(0, 4096);
      await api(
        `/v1/workspaces/${encodeURIComponent(ws)}/findings/${encodeURIComponent(findingUid)}`,
        {
          apiKey: key,
          method: "PATCH",
          body,
        },
      );
      setSaveMsg("Triage updated. The change is recorded in the audit log.");
      setNote("");
      load();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHead
        title={item?.rule_name ?? "Finding"}
        subtitle="Detection record with frozen evidence snapshot."
        actions={
          <>
            <Link to="/console/findings" className="btn btn-sm btn-ghost">
              ← All findings
            </Link>
            <Link
              to={`/console/findings/${findingUid}/evidence`}
              className="btn btn-sm btn-primary"
            >
              Open evidence bundle
            </Link>
          </>
        }
      />

      {loading ? (
        <LoadingRows rows={6} cols={2} />
      ) : error ? (
        <ErrorState error={error} onRetry={load} />
      ) : item ? (
        <div className="c-grid c-grid-2" style={{ alignItems: "start" }}>
          <div style={{ display: "grid", gap: "var(--sp-4)" }}>
            <section className="c-panel">
              <div className="c-panel-head">
                <span className="label">Record</span>
                <span className={`badge ${severityClass(item.severity)}`}>
                  {item.severity}
                </span>
              </div>
              <div className="c-panel-body">
                <dl className="c-kv">
                  <dt>Finding UID</dt>
                  <dd className="mono">{item.finding_uid}</dd>
                  <dt>Rule</dt>
                  <dd className="mono">
                    {item.rule_name}
                    <div style={{ color: "var(--text-3)", fontSize: 12 }}>
                      {item.rule_id} · by {item.author} · kind {item.kind}
                    </div>
                  </dd>
                  <dt>Upstream level</dt>
                  <dd className="mono">{item.level_original ?? "—"}</dd>
                  <dt>Severity</dt>
                  <dd>
                    <span className={`badge ${severityClass(item.severity)}`}>
                      {item.severity}
                    </span>
                  </dd>
                  <dt>Triage</dt>
                  <dd>
                    <span className={`badge ${triageClass(item.triage_state)}`}>
                      {item.triage_state.replace(/_/g, " ")}
                    </span>
                  </dd>
                  <dt>Time (UTC)</dt>
                  <dd className="mono">{fmtTime(item.time_utc)}</dd>
                  <dt>First / last seen</dt>
                  <dd className="mono">
                    {fmtTime(item.first_seen)} → {fmtTime(item.last_seen)}
                    {item.occurrence_count !== undefined
                      ? ` · ×${fmtNum(item.occurrence_count)}`
                      : ""}
                  </dd>
                  <dt>Host</dt>
                  <dd className="mono">{item.host_hostname ?? "—"}</dd>
                  <dt>User</dt>
                  <dd className="mono">{item.user_name ?? "—"}</dd>
                  <dt>Detection path</dt>
                  <dd className="mono">{item.detection_path}</dd>
                  <dt>Fingerprint</dt>
                  <dd className="mono" title={item.fingerprint}>
                    {shortHash(item.fingerprint, 24)}
                  </dd>
                  <dt>Reason codes</dt>
                  <dd>
                    {item.reason_codes && item.reason_codes.length > 0 ? (
                      <span
                        style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                      >
                        {item.reason_codes.map((r) => (
                          <span key={r} className="badge badge-plain">
                            {r}
                          </span>
                        ))}
                      </span>
                    ) : (
                      "—"
                    )}
                  </dd>
                  <dt>Referenced events</dt>
                  <dd className="mono">
                    {item.event_uids && item.event_uids.length > 0
                      ? `${item.event_uids.length} event uid(s)`
                      : "—"}
                  </dd>
                </dl>
              </div>
            </section>

            <section className="c-panel">
              <div className="c-panel-head">
                <span className="label">Update triage</span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--text-3)" }}
                >
                  PATCH …/findings/{"{uid}"}
                </span>
              </div>
              <div className="c-panel-body">
                <form
                  onSubmit={save}
                  style={{ display: "grid", gap: "var(--sp-4)" }}
                >
                  <Field label="Triage state">
                    {({ inputId }) => (
                      <select
                        id={inputId}
                        className="select"
                        value={triage}
                        onChange={(e) =>
                          setTriage(e.target.value as TriageState)
                        }
                        disabled={saving}
                      >
                        {TRIAGE_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field
                    label="Analyst note (optional)"
                    hint="Stored with the audited transition. Max 4096 characters."
                  >
                    {({ inputId }) => (
                      <textarea
                        id={inputId}
                        className="textarea"
                        style={{
                          minHeight: 80,
                          fontFamily: "var(--font-sans)",
                          fontSize: "var(--fs-sm)",
                        }}
                        maxLength={4096}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        disabled={saving}
                      />
                    )}
                  </Field>
                  <div>
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={saving}
                    >
                      {saving ? "Saving…" : "Save triage"}
                    </button>
                  </div>
                  {saveMsg ? (
                    <p
                      role="status"
                      style={{ color: "var(--ok)", fontSize: "var(--fs-sm)" }}
                    >
                      {saveMsg}
                    </p>
                  ) : null}
                  {saveErr ? (
                    <p
                      role="alert"
                      style={{
                        color: "var(--error)",
                        fontSize: "var(--fs-sm)",
                      }}
                    >
                      {saveErr}
                    </p>
                  ) : null}
                </form>
              </div>
            </section>
          </div>

          <section className="c-panel">
            <div className="c-panel-head">
              <span className="label">Evidence snapshot</span>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                frozen at detection time
              </span>
            </div>
            <div className="c-panel-body">
              <JsonBlock
                data={item.evidence_snapshot}
                header="evidence_snapshot"
                maxHeight={560}
              />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
