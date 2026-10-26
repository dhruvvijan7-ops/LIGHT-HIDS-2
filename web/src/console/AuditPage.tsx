/* Audit — append-only log query. Filters: action, since, until. */

import { useSearchParams } from "react-router-dom";
import { JsonBlock } from "../components/Json";
import { EmptyState, ErrorState, LoadingRows } from "../components/States";
import type { AuditEntry } from "../lib/api";
import { fmtTime } from "../lib/format";
import { useListPage } from "../lib/useListPage";
import { PageHead } from "./ConsoleLayout";

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const action = params.get("action") ?? "";
  const since = params.get("since") ?? "";
  const until = params.get("until") ?? "";

  const list = useListPage<AuditEntry>(
    (ws) => `/v1/workspaces/${encodeURIComponent(ws)}/audit`,
    {
      limit: 50,
      action: action || undefined,
      since: since || undefined,
      until: until || undefined,
    },
  );

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next);
  };

  return (
    <>
      <PageHead
        title="Audit log"
        subtitle="Append-only record of uploads, triage changes, rule mutations, and denied attempts. Hash-chained server-side."
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
          Action
          <input
            className="input mono"
            placeholder="e.g. upload.accept"
            defaultValue={action}
            key={`a-${action}`}
            onKeyDown={(e) => {
              if (e.key === "Enter")
                setParam("action", (e.target as HTMLInputElement).value.trim());
            }}
          />
        </label>
        <label>
          Since
          <input
            className="input mono"
            type="datetime-local"
            defaultValue={since ? since.slice(0, 16) : ""}
            key={`s-${since}`}
            onChange={(e) => {
              const v = e.target.value;
              setParam("since", v ? `${v}:00Z` : "");
            }}
          />
        </label>
        <label>
          Until
          <input
            className="input mono"
            type="datetime-local"
            defaultValue={until ? until.slice(0, 16) : ""}
            key={`u-${until}`}
            onChange={(e) => {
              const v = e.target.value;
              setParam("until", v ? `${v}:00Z` : "");
            }}
          />
        </label>
        {action || since || until ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setParams(new URLSearchParams())}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      <section className="c-panel">
        <div className="c-panel-head">
          <span className="label">Entries</span>
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)" }}
          >
            GET …/audit
          </span>
        </div>
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
              title="No audit entries"
              body="Actions like uploads and triage changes will appear here."
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
                  <th>Time</th>
                  <th>Action</th>
                  <th>Outcome</th>
                  <th>Principal</th>
                  <th>Object</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((a) => (
                  <tr key={a.audit_uid}>
                    <td className="mono">{fmtTime(a.at)}</td>
                    <td className="mono">{a.action}</td>
                    <td>
                      <span
                        className={`badge ${
                          a.outcome === "ok"
                            ? "badge-ok"
                            : a.outcome === "denied"
                              ? "badge-warn"
                              : "badge-error"
                        }`}
                      >
                        {a.outcome}
                      </span>
                    </td>
                    <td className="mono">{a.principal ?? "—"}</td>
                    <td className="mono">
                      {a.object_kind ?? "—"}
                      {a.object_id ? ` · ${a.object_id.slice(0, 12)}…` : ""}
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      {a.detail && Object.keys(a.detail).length > 0 ? (
                        <JsonBlock
                          data={a.detail}
                          maxHeight={140}
                          header="detail"
                        />
                      ) : (
                        "—"
                      )}
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
