/* Small formatting helpers shared by console views. */

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function fmtUptime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "Z");
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

export function shortHash(h: string | null | undefined, len = 12): string {
  if (!h) return "—";
  return h.length > len ? `${h.slice(0, len)}…` : h;
}

export function hostName(host: unknown): string {
  if (!host || typeof host !== "object") return "—";
  const h = host as Record<string, unknown>;
  return typeof h.hostname === "string" && h.hostname ? h.hostname : "—";
}

export function userName(user: unknown): string {
  if (!user || typeof user !== "object") return "—";
  const u = user as Record<string, unknown>;
  const name = typeof u.name === "string" ? u.name : "";
  const domain = typeof u.domain === "string" ? u.domain : "";
  if (name && domain) return `${domain}\\${name}`;
  return name || domain || "—";
}

/** Severity (finding) → badge class. Label text is always rendered too. */
export function severityClass(sev: string): string {
  switch (sev.toUpperCase()) {
    case "HIGH":
      return "badge-error";
    case "MEDIUM":
      return "badge-warn";
    case "LOW":
      return "badge-ok";
    default:
      return "badge-plain";
  }
}

/** Canonical-event severity (lowercase vocabulary) → badge class. */
export function eventSeverityClass(sev: string): string {
  switch (sev) {
    case "critical":
    case "high":
      return "badge-error";
    case "medium":
      return "badge-warn";
    case "low":
      return "badge-ok";
    default:
      return "badge-plain";
  }
}

export function triageClass(state: string): string {
  switch (state) {
    case "escalated":
      return "badge-error";
    case "new":
      return "badge-warn";
    case "acknowledged":
      return "badge-info";
    case "resolved":
      return "badge-ok";
    default:
      return "badge-plain";
  }
}

export function jobStatusClass(status: string): string {
  switch (status) {
    case "succeeded":
      return "badge-ok";
    case "running":
    case "queued":
      return "badge-info";
    case "failed":
    case "dead":
      return "badge-error";
    case "cancelled":
      return "badge-plain";
    default:
      return "badge-plain";
  }
}

export function runStatusClass(status: string): string {
  switch (status) {
    case "completed":
      return "badge-ok";
    case "completed_with_warnings":
      return "badge-warn";
    case "queued":
    case "running":
      return "badge-info";
    case "failed":
      return "badge-error";
    case "cancelled":
      return "badge-plain";
    default:
      return "badge-plain";
  }
}

export function triageClassLabel(state: string): string {
  return state.replace(/_/g, " ");
}
