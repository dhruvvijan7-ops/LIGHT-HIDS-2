/* Typed fetch wrapper for the Sentinel API.
   Contracts honoured (openapi.yaml):
   - auth: X-API-Key header (static dev keys; Stage-6 auth replaces later)
   - errors: {code, message, details?} via GateError; Starlette 404 uses {detail}
   - pagination: {items, next} — next is an opaque cursor or null
   - Idempotency-Key header on mutating POSTs */

const BASE: string = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

export interface Page<T> {
  items: T[];
  next: string | null;
}

export interface RequestOptions {
  method?: string;
  apiKey?: string | null;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  formData?: FormData;
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(BASE + path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.pathname + url.search;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody = {
    code: `HTTP_${res.status}`,
    message: res.statusText || `Request failed with status ${res.status}`,
  };
  try {
    const data = (await res.json()) as Partial<ApiErrorBody> & {
      detail?: string;
    };
    if (data && typeof data === "object") {
      if (typeof data.code === "string" && typeof data.message === "string") {
        body = {
          code: data.code,
          message: data.message,
          details: data.details,
        };
      } else if (typeof data.detail === "string") {
        // Starlette default (e.g. route not present in this API build)
        body = {
          code:
            res.status === 404
              ? "ENDPOINT_NOT_AVAILABLE"
              : `HTTP_${res.status}`,
          message: data.detail,
        };
      }
    }
  } catch {
    /* non-JSON error body — keep defaults */
  }
  return new ApiError(res.status, body);
}

export async function api<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...opts.headers,
  };
  if (opts.apiKey) headers["X-API-Key"] = opts.apiKey;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData; // browser sets multipart boundary
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      // A body implies a mutation: never default to GET-with-body, which the
      // browser rejects with an opaque TypeError before the request is sent.
      method: opts.method ?? (body !== undefined ? "POST" : "GET"),
      headers,
      body,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message:
        "Could not reach the Sentinel API. Check that the backend is running and reachable.",
    });
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* ---------- resource types (mirrors openapi.yaml components.schemas) ---------- */

export interface Readiness {
  status: "ok" | "degraded";
  checks: { database?: string; object_store?: string; queue?: string };
}

export interface Health {
  status: "ok";
  uptime_seconds: number;
}

export interface Upload {
  artifact_id: string;
  run_id: string;
  sha256: string;
  sha1?: string;
  md5?: string;
  size: number;
  display_name: string;
  collection_kind?: string | null;
  agent_id?: string | null;
  received_at: string;
  gate_warnings?: string[];
  triage_state: "queued" | "running" | "done" | "failed" | "rejected_by_policy";
}

export interface CanonicalEvent {
  schema_version: string;
  event: {
    category: string;
    type: string;
    action: string;
    outcome: "success" | "failure" | "unknown";
    severity: "informational" | "low" | "medium" | "high" | "critical";
    derived_by: "source" | "sentinel";
  };
  tenant_id: string;
  workspace_id: string;
  run_id: string;
  time: {
    utc: string | null;
    original?: string | null;
    original_timezone?: string | null;
    timezone_source?: string;
    precision?: string;
    state?: "ok" | "inferred" | "unknown" | "invalid";
  };
  host?: Record<string, unknown>;
  user?: Record<string, unknown>;
  source: {
    file_id: string;
    format: string;
    parser: string;
    parser_version: string;
    channel?: string;
    provider?: string;
    event_id?: string | number;
    record?: { type: string; [k: string]: unknown };
  };
  raw?: unknown;
  unmapped?: { name: string; value: unknown }[];
  [k: string]: unknown;
}

/** List/get row for events: envelope under `document`, plus row identity. */
export interface EventListItem {
  event_uid: string;
  ingest_time: string;
  document: CanonicalEvent;
}

export type Severity = "LOW" | "MEDIUM" | "HIGH";
export type TriageState =
  | "new"
  | "acknowledged"
  | "escalated"
  | "resolved"
  | "false_positive";

export interface Finding {
  finding_uid: string;
  run_id?: string;
  rule_id: string;
  rule_name: string;
  author: string;
  kind: string;
  severity: Severity;
  level_original?: string | null;
  time_utc: string;
  host_hostname?: string | null;
  user_name?: string | null;
  detection_path: "sql" | "native";
  reason_codes?: string[];
  fingerprint: string;
  event_uids?: string[];
  evidence_snapshot: Record<string, unknown>;
  first_seen?: string;
  last_seen?: string;
  occurrence_count?: number;
  triage_state: TriageState;
}

export interface EvidenceBundle {
  finding_uid: string;
  evidence_snapshot: Record<string, unknown>;
  raw_object?: {
    sha256?: string;
    size?: number;
    presigned_url?: string;
    expires_at?: string;
  } | null;
  raw_state?: "hot" | "archived" | "purged";
}

export interface Rule {
  rule_id: string;
  name: string;
  kind:
    | "sigma"
    | "correlation"
    | "ioc"
    | "fim"
    | "sca"
    | "statistical"
    | "artifact";
  source?: string;
  source_id?: string | null;
  license?: string;
  author?: string;
  title?: string;
  status?: string;
  level_original?: string | null;
  severity: Severity;
  enabled: boolean;
  document: Record<string, unknown>;
  compile?: Record<string, unknown> | null;
  imported_at?: string;
  updated_at?: string;
  schema_tag?: string;
  source_ref?: string;
  source_spec?: string;
  description?: string;
  provenance?: string;
  deleted_at?: string | null;
}

export interface ImportReport {
  results: {
    source_ref?: string;
    rule_id?: string | null;
    outcome: "OK" | "OK_PARTIAL" | "REJECTED";
    reason_codes?: string[];
  }[];
}

export interface DetectionRun {
  run_id: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "completed_with_warnings"
    | "failed"
    | "cancelled";
  scope?: Record<string, unknown>;
  config_hash?: string;
  started_at?: string | null;
  finished_at?: string | null;
  summary?: Record<string, unknown> | null;
  created_at: string;
}

export interface RuleRun {
  rule_id: string;
  outcome: "ok" | "ok_partial" | "rejected" | "skipped" | "error";
  run_id?: string;
  findings?: number;
  processed_events?: number;
  rejected_events?: number;
  max_group_size?: number | null;
  max_window_ms?: number | null;
  sql_ms?: number | null;
  native_ms?: number | null;
  detection_path?: "sql" | "native";
  reason_codes?: string[];
  started_at?: string;
  finished_at?: string | null;
}

export interface Job {
  job_id: string;
  job_type:
    | "ingest_file"
    | "detect_run"
    | "ioc_import"
    | "purge_raw"
    | "partition_maintain"
    | "baseline_update";
  status: "queued" | "running" | "succeeded" | "failed" | "dead" | "cancelled";
  priority?: number;
  attempts?: number;
  max_attempts?: number;
  last_error?: string | null;
  created_at: string;
  updated_at?: string;
  attempts_detail?: {
    attempt?: number;
    worker?: string;
    started_at?: string;
    finished_at?: string | null;
    outcome?: "succeeded" | "failed" | "lost_lock";
    error?: string | null;
  }[];
}

export interface IocPack {
  pack_id: string;
  name: string;
  version: string;
  sha256?: string;
  signing_key_id?: string | null;
  status: "pending_verify" | "active" | "rejected" | "retired";
  imported_at?: string;
}

export interface AuditEntry {
  audit_uid: string;
  at: string;
  principal?: string | null;
  action: string;
  object_kind?: string | null;
  object_id?: string | null;
  outcome: "ok" | "denied" | "error";
  detail?: Record<string, unknown>;
}

export interface Workspace {
  id: string;
  name: string;
  created_at?: string;
  disabled?: boolean;
}

export interface RunRequest {
  since?: string;
  until?: string;
  hosts?: string[];
  categories?: string[];
  rule_ids?: string[];
}
