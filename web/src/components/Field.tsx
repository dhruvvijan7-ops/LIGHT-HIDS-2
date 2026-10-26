/* Accessible labelled form field. */

import { type ReactNode, useId } from "react";

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (ids: {
    inputId: string;
    describedBy: string | undefined;
  }) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errId = `${inputId}-err`;
  const describedBy =
    [hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label
        htmlFor={inputId}
        style={{
          fontSize: "var(--fs-sm)",
          fontWeight: 500,
          color: "var(--text-2)",
        }}
      >
        {label}
      </label>
      {children({ inputId, describedBy })}
      {hint ? (
        <p
          id={hintId}
          style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)" }}
        >
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errId}
          role="alert"
          style={{ fontSize: "var(--fs-xs)", color: "var(--error)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
