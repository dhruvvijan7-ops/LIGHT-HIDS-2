/* Sign-in — the real flow. The API authenticates with a static X-API-Key and
   binds that key to a single workspace server-side, so the form collects both.
   Validation is a live GET against an implemented authenticated endpoint;
   nothing is stored and no success is shown unless the server confirms. */

import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Mark } from "../components/Brand";
import { Field } from "../components/Field";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/hooks";
import { AuthShell } from "./AuthShell";

export function Login() {
  useDocumentTitle("Sign in · Sentinel");
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/console";

  const [apiKey, setApiKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [remember, setRemember] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ key?: string; ws?: string }>(
    {},
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const fe: { key?: string; ws?: string } = {};
    if (!apiKey.trim()) fe.key = "Enter the API key issued for your workspace.";
    if (!workspaceId.trim())
      fe.ws = "Enter the workspace ID this key is scoped to.";
    setFieldError(fe);
    if (fe.key || fe.ws) return;

    setSubmitting(true);
    try {
      if (remember) localStorage.setItem("sentinel.remember", "1");
      else localStorage.removeItem("sentinel.remember");
      await signIn(apiKey, workspaceId);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError("That API key was rejected by the server.");
        } else if (err.code === "GATE_TENANT_MISMATCH") {
          setFieldError({ ws: "This key is not scoped to that workspace." });
          setError(null);
        } else if (err.code === "NETWORK_ERROR") {
          setError(err.message);
        } else {
          setError(`${err.message} (${err.code})`);
        }
      } else {
        setError("Sign-in failed unexpectedly. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Sign in to the console"
      subtitle="Sentinel authenticates with workspace-scoped API keys. There is no password sign-in in this build."
    >
      <form
        onSubmit={onSubmit}
        noValidate
        style={{ display: "grid", gap: "var(--sp-5)" }}
      >
        <Field
          label="API key"
          error={fieldError.key}
          hint={
            <>
              Sent as the <code className="mono">X-API-Key</code> header. Keys
              are defined per principal in the server configuration.
            </>
          }
        >
          {({ inputId, describedBy }) => (
            <div style={{ position: "relative" }}>
              <input
                id={inputId}
                className="input mono"
                style={{ paddingRight: 74 }}
                type={showKey ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                aria-describedby={describedBy}
                disabled={submitting}
              />
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{
                  position: "absolute",
                  right: 5,
                  top: "50%",
                  transform: "translateY(-50%)",
                  height: 30,
                }}
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          )}
        </Field>

        <Field
          label="Workspace ID"
          error={fieldError.ws}
          hint="Every API path is workspace-scoped; your key only works against its own workspace."
        >
          {({ inputId, describedBy }) => (
            <input
              id={inputId}
              className="input mono"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="ws-…"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              aria-describedby={describedBy}
              disabled={submitting}
            />
          )}
        </Field>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: "var(--fs-sm)",
            color: "var(--text-2)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={submitting}
          />
          Keep me signed in on this device
        </label>

        {error ? (
          <p
            role="alert"
            style={{ color: "var(--error)", fontSize: "var(--fs-sm)" }}
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting}
          style={{ height: 48 }}
        >
          {submitting ? "Verifying with the server…" : "Sign in"}
        </button>

        <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-3)" }}>
          Forgot your key?{" "}
          <Link to="/forgot-password">Key &amp; access recovery</Link>
        </p>
      </form>

      <p
        style={{
          marginTop: "var(--sp-6)",
          paddingTop: "var(--sp-4)",
          borderTop: "1px solid var(--border)",
          fontSize: "var(--fs-xs)",
          color: "var(--text-3)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Mark size={16} /> <Link to="/">Back to sentinel overview</Link>
      </p>
    </AuthShell>
  );
}
