/* Custom 404 — a restrained "signal loss" motif on the shared design system.
   Communicates the error statically; no elaborate animation required. */

import { Link, useLocation } from "react-router-dom";
import { Wordmark } from "../components/Brand";
import { useAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/hooks";

export function NotFound() {
  useDocumentTitle("Not found · Sentinel");
  const { pathname } = useLocation();
  const { session } = useAuth();

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        background: "var(--bg)",
      }}
    >
      <header style={{ padding: "var(--sp-5) var(--gutter)" }}>
        <a href="/" style={{ color: "var(--text)" }}>
          <Wordmark />
        </a>
      </header>

      <main
        style={{
          width: "min(100% - var(--gutter) * 2, 880px)",
          margin: "0 auto",
          alignSelf: "center",
          padding: "var(--sp-7) 0",
          display: "grid",
          gap: "var(--sp-5)",
        }}
      >
        {/* static signal-loss grid */}
        <svg
          viewBox="0 0 320 80"
          style={{ width: "min(320px, 70vw)", opacity: 0.85 }}
          aria-hidden="true"
        >
          {Array.from({ length: 16 }, (_, i) => {
            const active = [2, 5, 9, 12].includes(i);
            return (
              <rect
                // biome-ignore lint/suspicious/noArrayIndexKey: static decorative grid
                key={i}
                x={i * 20}
                y={30}
                width={12}
                height={20}
                rx={2}
                fill={active ? "var(--accent)" : "var(--border-2)"}
                opacity={active ? 0.9 : 0.55 - (i % 3) * 0.12}
              />
            );
          })}
        </svg>

        <p className="label" style={{ color: "var(--accent)" }}>
          HTTP 404 · route not found
        </p>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(2.4rem, 6vw, 4.5rem)",
            fontWeight: 400,
            lineHeight: 1.02,
            maxWidth: "16ch",
          }}
        >
          Nothing is listening at this path.
        </h1>
        <p className="prose">
          The address{" "}
          <code className="mono" style={{ color: "var(--text)" }}>
            {pathname}
          </code>{" "}
          does not match any route in this Sentinel deployment. It may have been
          mistyped, or the destination may belong to a different milestone than
          the one you are running.
        </p>

        <div
          style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}
        >
          <Link to={session ? "/console" : "/"} className="btn btn-primary">
            {session ? "Open the console" : "Sentinel overview"}
          </Link>
          <Link to={session ? "/" : "/login"} className="btn btn-ghost">
            {session ? "Public overview" : "Sign in"}
          </Link>
        </div>
      </main>

      <footer
        style={{
          padding: "var(--sp-4) var(--gutter) var(--sp-6)",
          fontSize: "var(--fs-xs)",
          color: "var(--text-3)",
        }}
      >
        Sentinel — light Windows-first HIDS
      </footer>
    </div>
  );
}
