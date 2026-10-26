/* Rules — list + import against the OpenAPI contract. If the running API
   build does not serve /rules yet, the page says so honestly instead of
   inventing a rule inventory. */

import { type FormEvent, useState } from "react";
import { Field } from "../components/Field";
import { JsonBlock } from "../components/Json";
import { EmptyState, ErrorState, LoadingRows } from "../components/States";
import {
  api,
  type ImportReport,
  newIdempotencyKey,
  type Rule,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtTime, severityClass } from "../lib/format";
import { useListPage } from "../lib/useListPage";
import { PageHead } from "./ConsoleLayout";

export function RulesPage() {
  const { session } = useAuth();
  const key = session?.apiKey ?? "";
  const ws = session?.workspaceId ?? "";

  const list = useListPage<Rule>(
    (w) => `/v1/workspaces/${encodeURIComponent(w)}/rules`,
    {
      limit: 50,
    },
  );

  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const importRules = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !rawText.trim()) return;
    setBusy(true);
    setErr(null);
    setReport(null);
    try {
      const res = await api<ImportReport>(
        `/v1/workspaces/${encodeURIComponent(ws)}/rules`,
        {
          apiKey: key,
          method: "POST",
          body: { raw_text: rawText, format: "sigma" },
          idempotencyKey: newIdempotencyKey(),
        },
      );
      setReport(res);
      setRawText("");
      list.reload();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="Rules"
        subtitle="Stored detection rules — Sigma-compatible documents and native kinds. Import outcomes report per-document results with reason codes."
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
            <span className="label">Import rules</span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              POST …/rules · raw Sigma text
            </span>
          </div>
          <div className="c-panel-body">
            <form
              onSubmit={importRules}
              style={{ display: "grid", gap: "var(--sp-4)" }}
            >
              <Field
                label="Sigma rule text"
                hint="Paste one or more Sigma documents. The server preserves upstream verbatim text in rule_source."
                error={err}
              >
                {({ inputId, describedBy }) => (
                  <textarea
                    id={inputId}
                    className="textarea"
                    style={{ minHeight: 180 }}
                    placeholder={
                      "title: Example rule\nstatus: experimental\nlogsource:\n  product: windows\n  category: process_creation\ndetection:\n  selection:\n    Image|endswith: '\\cmd.exe'\n  condition: selection\nlevel: medium"
                    }
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    aria-describedby={describedBy}
                    disabled={busy}
                  />
                )}
              </Field>
              <div>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={busy || !rawText.trim()}
                >
                  {busy ? "Importing…" : "Import"}
                </button>
              </div>
              {report ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <span className="label">Import report</span>
                  {report.results?.map((r, i) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: server-ordered report rows without stable ids
                      key={i}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: "var(--r-sm)",
                        padding: "8px 12px",
                        fontSize: "var(--fs-sm)",
                        display: "grid",
                        gap: 4,
                      }}
                    >
                      <span
                        className={`badge ${
                          r.outcome === "OK"
                            ? "badge-ok"
                            : r.outcome === "OK_PARTIAL"
                              ? "badge-warn"
                              : "badge-error"
                        }`}
                        style={{ width: "fit-content" }}
                      >
                        {r.outcome}
                      </span>
                      <span
                        className="mono"
                        style={{ fontSize: 11, color: "var(--text-3)" }}
                      >
                        {r.source_ref ?? "—"}
                        {r.reason_codes?.length
                          ? ` · ${r.reason_codes.join(", ")}`
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </form>
          </div>
        </section>

        <section className="c-panel">
          <div className="c-panel-head">
            <span className="label">Stored rules</span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              GET …/rules
            </span>
          </div>
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
                title="No rules stored"
                body="Import Sigma text to populate the rule store."
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
                    <th>Kind</th>
                    <th>Severity</th>
                    <th>Enabled</th>
                    <th>Imported</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((r) => (
                    <tr key={r.rule_id}>
                      <td>
                        {r.name}
                        <div
                          className="mono"
                          style={{ fontSize: 11, color: "var(--text-3)" }}
                        >
                          {r.author ?? "—"} · {r.source ?? "—"}
                        </div>
                      </td>
                      <td className="mono">{r.kind}</td>
                      <td>
                        <span className={`badge ${severityClass(r.severity)}`}>
                          {r.severity}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${r.enabled ? "badge-ok" : "badge-plain"}`}
                        >
                          {r.enabled ? "enabled" : "disabled"}
                        </span>
                      </td>
                      <td className="mono">{fmtTime(r.imported_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.error === null && !list.loading && list.items.length > 0 ? (
            <div style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
              <JsonBlock
                data={list.items[0].document}
                header="first rule · document"
                maxHeight={220}
              />
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
