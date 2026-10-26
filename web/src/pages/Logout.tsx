/* Logout — clears the local API-key session and returns the visitor to the
   landing page. The API has no server-side session to revoke (static key
   auth), so clearing local storage IS the complete logout; the transition is
   short and never delays it. */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Mark } from "../components/Brand";
import { useAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/hooks";

export function Logout() {
  useDocumentTitle("Signed out · Sentinel");
  const { signOut } = useAuth();
  const done = useRef(false);
  const [phase, setPhase] = useState<"clearing" | "done">("clearing");

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    signOut();
    const t = window.setTimeout(() => setPhase("done"), 450);
    return () => window.clearTimeout(t);
  }, [signOut]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "var(--gutter)",
        background:
          "radial-gradient(900px 480px at 50% 110%, rgba(240,168,46,0.05), transparent 60%), var(--bg)",
      }}
    >
      <div
        style={{
          textAlign: "center",
          display: "grid",
          gap: "var(--sp-4)",
          justifyItems: "center",
        }}
      >
        <span
          style={{
            color: phase === "done" ? "var(--accent)" : "var(--text-3)",
            transition: "color var(--t-slow) var(--ease-out)",
            opacity: phase === "clearing" ? 0.5 : 1,
          }}
        >
          <Mark size={40} />
        </span>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)",
            fontWeight: 400,
          }}
          aria-live="polite"
        >
          {phase === "done" ? "Session cleared" : "Signing out…"}
        </h1>
        <p
          style={{
            color: "var(--text-2)",
            fontSize: "var(--fs-sm)",
            maxWidth: 420,
          }}
        >
          {phase === "done"
            ? "Your API key was removed from this browser. The key itself stays valid on the server until an operator rotates it."
            : "Removing the stored API key from this browser."}
        </p>
        {phase === "done" ? (
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 8,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <Link to="/" className="btn btn-primary">
              Back to overview
            </Link>
            <Link to="/login" className="btn btn-ghost">
              Sign in again
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
