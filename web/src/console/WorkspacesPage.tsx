/* Workspaces — the principal's workspace scope. GET /v1/workspaces is declared
   in openapi.yaml but not routed by the M2 API build, so this page cannot list
   server-side workspaces; it shows the workspace this session is bound to and
   links to the create contract for when it ships. */

import { EmptyState } from "../components/States";
import { useAuth } from "../lib/auth";
import { PageHead } from "./ConsoleLayout";

export function WorkspacesPage() {
  const { session } = useAuth();

  return (
    <>
      <PageHead
        title="Workspaces"
        subtitle="Workspaces are the tenancy boundary: every /v1 path resolves the principal's workspace and enforces row-level security."
      />

      <div className="c-grid c-grid-2" style={{ alignItems: "start" }}>
        <section className="c-panel">
          <div className="c-panel-head">
            <span className="label">This session</span>
          </div>
          <div className="c-panel-body">
            <dl className="c-kv">
              <dt>Workspace ID</dt>
              <dd className="mono">{session?.workspaceId ?? "—"}</dd>
              <dt>Bound at</dt>
              <dd className="mono">{session?.storedAt ?? "—"}</dd>
            </dl>
            <p
              style={{
                marginTop: 16,
                fontSize: "var(--fs-sm)",
                color: "var(--text-3)",
              }}
            >
              Your API key is issued against exactly one workspace. Requests to
              any other workspace id are rejected with a tenant-mismatch gate
              error and logged as denied audit attempts.
            </p>
          </div>
        </section>

        <section className="c-panel">
          <div className="c-panel-head">
            <span className="label">Workspace directory</span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              GET /v1/workspaces
            </span>
          </div>
          <div style={{ padding: 14 }}>
            <EmptyState
              title="Directory endpoint not served in this API build"
              body={
                <>
                  <code className="mono">GET /v1/workspaces</code> and{" "}
                  <code className="mono">POST /v1/workspaces</code> are declared
                  in <code className="mono">openapi.yaml</code> but are not
                  routed by the running M2 API. Workspace creation and listing
                  will appear here once that milestone ships.
                </>
              }
            />
          </div>
        </section>
      </div>
    </>
  );
}
