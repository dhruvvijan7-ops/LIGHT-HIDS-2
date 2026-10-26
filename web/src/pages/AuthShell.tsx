/* Shared shell for the auth + error routes: restrained variation of the
   landing system — same tokens, quieter composition. */

import type { ReactNode } from "react";
import { Wordmark } from "../components/Brand";
import { useDocumentTitle } from "../lib/hooks";

export function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useDocumentTitle(`${title} · Sentinel`);
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        background:
          "radial-gradient(1100px 520px at 80% -10%, rgba(240,168,46,0.06), transparent 60%), var(--bg)",
      }}
    >
      <header
        style={{
          padding: "var(--sp-5) var(--gutter)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <a href="/" style={{ color: "var(--text)" }}>
          <Wordmark />
        </a>
      </header>

      <main
        style={{
          width: `min(100% - var(--gutter) * 2, ${wide ? "720px" : "440px"})`,
          margin: "0 auto",
          padding: "var(--sp-6) 0 var(--sp-9)",
          alignSelf: "center",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(1.9rem, 3.4vw, 2.6rem)",
            fontWeight: 400,
            letterSpacing: "-0.01em",
            marginBottom: "var(--sp-3)",
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            style={{
              color: "var(--text-2)",
              fontSize: "var(--fs-sm)",
              marginBottom: "var(--sp-6)",
            }}
          >
            {subtitle}
          </p>
        ) : (
          <div style={{ height: "var(--sp-5)" }} />
        )}
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-lg)",
            padding: "clamp(20px, 4vw, 32px)",
            boxShadow: "var(--shadow-2)",
          }}
        >
          {children}
        </div>
      </main>

      <footer
        style={{
          padding: "var(--sp-4) var(--gutter) var(--sp-6)",
          fontSize: "var(--fs-xs)",
          color: "var(--text-3)",
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <span>Sentinel — light Windows-first HIDS</span>
        <span className="mono">API-key auth · workspace-scoped</span>
      </footer>
    </div>
  );
}
