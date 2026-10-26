/* IOC packs — signed indicator packs (Ed25519 per the spec). List/import are
   declared in openapi.yaml but not routed by the M2 API build; the page says
   so and still offers the real import call for when the route exists. */

import { type FormEvent, useState } from "react";
import { Field } from "../components/Field";
import { JsonBlock } from "../components/Json";
import { EmptyState, ErrorState, LoadingRows } from "../components/States";
import { api, type IocPack, newIdempotencyKey } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useListPage } from "../lib/useListPage";
import { PageHead } from "./ConsoleLayout";

export function IocPacksPage() {
  const { session } = useAuth();
  const key = session?.apiKey ?? "";
  const ws = session?.workspaceId ?? "";

  const list = useListPage<IocPack>(
    (w) => `/v1/workspaces/${encodeURIComponent(w)}/ioc-packs`,
    {
      limit: 50,
    },
  );

  const [doc, setDoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<IocPack | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !doc.trim()) return;
    setBusy(true);
    setErr(null);
    setCreated(null);
    try {
      let body: unknown;
      try {
        body = JSON.parse(doc);
      } catch {
        setErr("The pack document must be valid JSON.");
        setBusy(false);
        return;
      }
      const res = await api<IocPack>(
        `/v1/workspaces/${encodeURIComponent(ws)}/ioc-packs`,
        {
          apiKey: key,
          method: "POST",
          body,
          idempotencyKey: newIdempotencyKey(),
        },
      );
      setCreated(res);
      setDoc("");
      list.reload();
    } catch (e2) {
      setErr(
        e2 instanceof Error
          ? e2.message
          : "Import failed — signature or schema mismatch returns 400.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="IOC packs"
        subtitle="Signed indicator packs. The server verifies the Ed25519 signature before a pack can become active."
      />

      <div className="c-grid c-grid-2" style={{ alignItems: "start" }}>
        <section className="c-panel">
          <div className="c-panel-head">
            <span className="label">Import a signed pack</span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              POST …/ioc-packs · 201
            </span>
          </div>
          <div className="c-panel-body">
            <form
              onSubmit={submit}
              style={{ display: "grid", gap: "var(--sp-4)" }}
            >
              <Field
                label="Pack document (JSON)"
                hint="Fields: name, version, indicators[], signature (base64 Ed25519), signing_key_id."
                error={err}
              >
                {({ inputId, describedBy }) => (
                  <textarea
                    id={inputId}
                    className="textarea"
                    style={{ minHeight: 170 }}
                    placeholder={
                      '{\n  "name": "example-pack",\n  "version": "1.0.0",\n  "indicators": [{ "kind": "sha256", "value": "…" }],\n  "signature": "…",\n  "signing_key_id": "…"\n}'
                    }
                    value={doc}
                    onChange={(e) => setDoc(e.target.value)}
                    aria-describedby={describedBy}
                    disabled={busy}
                  />
                )}
              </Field>
              <div>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={busy || !doc.trim()}
                >
                  {busy ? "Importing…" : "Import pack"}
                </button>
              </div>
              {created ? (
                <div
                  role="status"
                  style={{
                    border: "1px solid rgba(123,198,126,0.4)",
                    background: "var(--ok-soft)",
                    borderRadius: "var(--r-md)",
                    padding: "var(--sp-3) var(--sp-4)",
                    fontSize: "var(--fs-sm)",
                    display: "grid",
                    gap: 4,
                  }}
                >
                  <strong style={{ color: "var(--ok)" }}>
                    Pack imported and verified
                  </strong>
                  <span className="mono">
                    {created.name} {created.version} · {created.status}
                  </span>
                </div>
              ) : null}
            </form>
          </div>
        </section>

        <section className="c-panel">
          <div className="c-panel-head">
            <span className="label">Stored packs</span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              GET …/ioc-packs
            </span>
          </div>
          {list.loading ? (
            <div style={{ padding: 14 }}>
              <LoadingRows rows={5} cols={3} />
            </div>
          ) : list.error ? (
            <div style={{ padding: 14 }}>
              <ErrorState error={list.error} onRetry={list.reload} />
            </div>
          ) : list.items.length === 0 ? (
            <div style={{ padding: 14 }}>
              <EmptyState
                title="No IOC packs"
                body="Import a signed pack to make indicators available to rules."
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
                    <th>Version</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((p) => (
                    <tr key={p.pack_id}>
                      <td>{p.name}</td>
                      <td className="mono">{p.version}</td>
                      <td>
                        <span
                          className={`badge ${
                            p.status === "active"
                              ? "badge-ok"
                              : p.status === "rejected"
                                ? "badge-error"
                                : p.status === "pending_verify"
                                  ? "badge-warn"
                                  : "badge-plain"
                          }`}
                        >
                          {p.status.replace(/_/g, " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {doc ? (
            <div style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
              <JsonBlock
                data={(() => {
                  try {
                    return JSON.parse(doc);
                  } catch {
                    return "invalid JSON";
                  }
                })()}
                header="document preview"
                maxHeight={200}
              />
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
