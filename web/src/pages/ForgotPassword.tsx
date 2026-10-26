/* Password / key recovery entry point.
   The current API build has NO password-reset or key-issuance endpoint
   (auth is static X-API-Key from server configuration). This page states
   that honestly and points to the operator steps that actually exist —
   it never pretends a reset email or token flow was sent. */

import { Link } from "react-router-dom";
import { AuthShell } from "./AuthShell";

export function ForgotPassword() {
  return (
    <AuthShell
      title="Key & access recovery"
      subtitle="Sentinel's console signs in with API keys issued by the platform operator — not passwords."
    >
      <div style={{ display: "grid", gap: "var(--sp-4)" }}>
        <div
          role="note"
          style={{
            border: "1px solid rgba(158,203,245,0.3)",
            background: "var(--info-soft)",
            borderRadius: "var(--r-md)",
            padding: "var(--sp-3) var(--sp-4)",
            fontSize: "var(--fs-sm)",
            color: "var(--text-2)",
          }}
        >
          <strong style={{ color: "var(--text)" }}>
            No self-service reset exists yet.
          </strong>{" "}
          This API build authenticates with static{" "}
          <code className="mono">X-API-Key</code> values bound to a tenant and
          workspace in the server configuration. There is no password-reset
          endpoint, token flow, or email integration to call — so this page does
          not pretend one ran.
        </div>

        <div>
          <h2 style={{ fontSize: "var(--fs-h3)", marginBottom: "var(--sp-2)" }}>
            What you can do
          </h2>
          <ol
            style={{
              margin: 0,
              paddingLeft: 20,
              color: "var(--text-2)",
              fontSize: "var(--fs-sm)",
              display: "grid",
              gap: 8,
            }}
          >
            <li>
              If you have a valid key but forgot which workspace it belongs to,
              ask your operator — each key is issued against exactly one
              workspace.
            </li>
            <li>
              If your key was lost or rotated, request a new one from whoever
              administers this Sentinel deployment (keys live in the server
              configuration or the Stage-6 auth service when it ships).
            </li>
            <li>
              If you still hold the key but it was rejected at sign-in, confirm
              you entered the matching workspace ID and that the deployment is
              reachable.
            </li>
          </ol>
        </div>

        <div
          style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}
        >
          <Link to="/login" className="btn btn-primary">
            Back to sign in
          </Link>
          <Link to="/" className="btn btn-ghost">
            Sentinel overview
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
