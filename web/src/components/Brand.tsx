/* Sentinel mark — an abstract "watchful gate": two arcs around a signal tick.
   Original vector artwork for this project. */

export function Mark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M16 2.5 4.5 8v8.2c0 6.9 4.7 11.6 11.5 13.3 6.8-1.7 11.5-6.4 11.5-13.3V8L16 2.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <path
        d="M10.5 16.5h3l1.8-4.2 2.4 8 1.8-3.8h2.5"
        stroke="var(--accent, #f0a82e)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      <Mark size={22} />
      <span style={{ fontFamily: "var(--font-sans)", fontSize: 15 }}>
        SENTINEL
      </span>
    </span>
  );
}
