/* Evidence bundle — GET …/evidence/{findingUid}.
   Shows the immutable snapshot always, plus the presigned raw link while the
   object is still hot (server decides; the UI never fabricates a URL). */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CopyButton, JsonBlock } from "../components/Json";
import { ErrorState, LoadingRows } from "../components/States";
import { api, type EvidenceBundle } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtBytes, fmtTime } from "../lib/format";
import { PageHead } from "./ConsoleLayout";

export function EvidencePage() {
  const { findingUid = "" } = useParams();
  const { session } = useAuth();
  const key = session?.apiKey ?? "";
  const ws = session?.workspaceId ?? "";

  const [bundle, setBundle] = useState<EvidenceBundle | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<EvidenceBundle>(
      `/v1/workspaces/${encodeURIComponent(ws)}/evidence/${encodeURIComponent(findingUid)}`,
      { apiKey: key },
    )
      .then(setBundle)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [ws, key, findingUid]);

  useEffect(load, [load]);

  const rawStateBadge =
    bundle?.raw_state === "hot"
      ? "badge-ok"
      : bundle?.raw_state === "archived"
        ? "badge-warn"
        : "badge-plain";

  return (
    <>
      <PageHead
        title="Evidence bundle"
        subtitle="Immutable snapshot of the rule, configuration, and events behind this finding."
        actions={
          <>
            <Link
              to={`/console/findings/${findingUid}`}
              className="btn btn-sm btn-ghost"
            >
              ← Finding record
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
      ) : bundle ? (
        <div className="c-grid c-grid-2" style={{ alignItems: "start" }}>
          <section className="c-panel">
            <div className="c-panel-head">
              <span className="label">Bundle status</span>
              {bundle.raw_state ? (
                <span className={`badge ${rawStateBadge}`}>
                  raw object: {bundle.raw_state}
                </span>
              ) : null}
            </div>
            <div className="c-panel-body">
              <dl className="c-kv">
                <dt>Finding UID</dt>
                <dd className="mono">{bundle.finding_uid}</dd>
                <dt>Raw state</dt>
                <dd className="mono">{bundle.raw_state ?? "—"}</dd>
              </dl>
              {bundle.raw_object ? (
                <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                  <span className="label">Raw object (hot)</span>
                  <dl className="c-kv">
                    <dt>sha256</dt>
                    <dd className="mono" style={{ wordBreak: "break-all" }}>
                      {bundle.raw_object.sha256 ?? "—"}
                      {bundle.raw_object.sha256 ? (
                        <>
                          {" "}
                          <CopyButton
                            text={bundle.raw_object.sha256}
                            label="Copy"
                          />
                        </>
                      ) : null}
                    </dd>
                    <dt>Size</dt>
                    <dd className="mono">
                      {bundle.raw_object.size !== undefined
                        ? fmtBytes(bundle.raw_object.size)
                        : "—"}
                    </dd>
                    <dt>Link expires</dt>
                    <dd className="mono">
                      {fmtTime(bundle.raw_object.expires_at)}
                    </dd>
                  </dl>
                  {bundle.raw_object.presigned_url ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <a
                        className="btn btn-sm btn-primary"
                        href={bundle.raw_object.presigned_url}
                        rel="noreferrer noopener"
                        target="_blank"
                      >
                        Download raw object
                      </a>
                      <p
                        style={{
                          fontSize: "var(--fs-xs)",
                          color: "var(--text-3)",
                        }}
                      >
                        Presigned by the server with a short TTL. Once archived
                        or purged, the snapshot on this page is the evidence of
                        record.
                      </p>
                    </div>
                  ) : (
                    <p
                      style={{
                        fontSize: "var(--fs-sm)",
                        color: "var(--text-3)",
                      }}
                    >
                      No presigned URL in this response — the raw object is no
                      longer hot, or the store does not issue direct links for
                      this workspace.
                    </p>
                  )}
                </div>
              ) : (
                <p
                  style={{
                    marginTop: 16,
                    fontSize: "var(--fs-sm)",
                    color: "var(--text-3)",
                  }}
                >
                  No raw object attached to this bundle. The snapshot below is
                  the complete evidence of record.
                </p>
              )}
            </div>
          </section>

          <section className="c-panel">
            <div className="c-panel-head">
              <span className="label">evidence_snapshot</span>
            </div>
            <div className="c-panel-body">
              <JsonBlock data={bundle.evidence_snapshot} maxHeight={620} />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
