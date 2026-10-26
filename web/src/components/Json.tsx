/* Cursor-aware JSON viewer + copy button for evidence / raw payloads. */

import { type ReactNode, useState } from "react";

export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function JsonBlock({
  data,
  maxHeight = 420,
  copyable = true,
  header,
}: {
  data: unknown;
  maxHeight?: number;
  copyable?: boolean;
  header?: ReactNode;
}) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        background: "var(--bg-2)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <span className="label">{header ?? "JSON"}</span>
        {copyable ? <CopyButton text={text} /> : null}
      </div>
      <pre
        style={{
          margin: 0,
          padding: "12px 14px",
          maxHeight,
          overflow: "auto",
          fontSize: 12,
          lineHeight: 1.55,
          color: "var(--text-2)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text}
      </pre>
    </div>
  );
}
