/* Empty / error / unavailable states — honest, never fabricated. */

import type { ReactNode } from "react";
import { ApiError } from "../lib/api";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px dashed var(--border-2)",
        borderRadius: "var(--r-md)",
        padding: "var(--sp-7) var(--sp-5)",
        textAlign: "center",
        display: "grid",
        gap: "var(--sp-3)",
        justifyItems: "center",
        background: "var(--bg-2)",
      }}
    >
      <p style={{ fontWeight: 500, color: "var(--text)" }}>{title}</p>
      {body ? (
        <p
          style={{
            color: "var(--text-3)",
            fontSize: "var(--fs-sm)",
            maxWidth: 520,
          }}
        >
          {body}
        </p>
      ) : null}
      {action}
    </div>
  );
}

/** Renders an API failure honestly, including "endpoint not in this build". */
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const isUnavailable =
    error instanceof ApiError &&
    (error.code === "ENDPOINT_NOT_AVAILABLE" || error.status === 404);

  const code = error instanceof ApiError ? error.code : "UNEXPECTED_ERROR";
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Something went wrong.";

  if (isUnavailable) {
    return (
      <EmptyState
        title="Not available in this API build"
        body={
          <>
            This screen calls an endpoint that the running Sentinel API does not
            serve yet. The route is defined in{" "}
            <code className="mono">openapi.yaml</code> and will work once the
            matching backend milestone ships.{" "}
            <span className="mono" style={{ color: "var(--text-2)" }}>
              ({code})
            </span>
          </>
        }
        action={
          onRetry ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={onRetry}
            >
              Retry
            </button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div
      role="alert"
      style={{
        border: "1px solid rgba(229,101,75,0.4)",
        background: "var(--error-soft)",
        borderRadius: "var(--r-md)",
        padding: "var(--sp-4) var(--sp-5)",
        display: "grid",
        gap: 6,
      }}
    >
      <p style={{ fontWeight: 500, color: "#f0a292" }}>Request failed</p>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>
        {message}
      </p>
      <p className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
        {code}
        {error instanceof ApiError && error.status
          ? ` · HTTP ${error.status}`
          : ""}
      </p>
      {onRetry ? (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function LoadingRows({
  rows = 5,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      style={{ display: "grid", gap: 8, padding: "var(--sp-3) 0" }}
    >
      {Array.from({ length: rows }, (_, r) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows, order fixed
          key={`row-${r + 1}`}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 12,
          }}
        >
          {Array.from({ length: cols }, (_, c) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cells, order fixed
              key={`cell-${c + 1}`}
              style={{
                height: 14,
                borderRadius: 4,
                background: `linear-gradient(90deg, var(--surface-2) 25%, var(--border) 50%, var(--surface-2) 75%)`,
                backgroundSize: "200% 100%",
                animation: "shimmer 1.4s linear infinite",
                opacity: 1 - r * 0.12,
              }}
            />
          ))}
        </div>
      ))}
      <style>{`@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }`}</style>
    </div>
  );
}
