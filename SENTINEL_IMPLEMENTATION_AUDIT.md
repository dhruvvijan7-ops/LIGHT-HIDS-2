# SENTINEL / AEGIS — Implementation Audit

**Repository:** `Light HIDS` (Sentinel) · **Audit date:** 2026-10-22 · **Auditor:** Buffy (Codebuff agent), read-only investigation

**Evidence labels used throughout:** `[static]` = static code inspection · `[test]` = automated test executed
during this audit · `[runtime]` = observed live during this audit · `[doc]` = documentation claim ·
`[inference]` = deduction, labelled as such.

**Audit side effects (full disclosure):** No source file was created, modified or deleted by this audit.
Running the existing test suites wrote test rows into the local dev database; the scoring suite regenerated the
generated artifact `research/work/_stage6_work/bench/unsw_nb15_scoring.json` (numbers refreshed, same shape);
one live demo upload (`tests/planted/sysmon_planted.evtx`) was sent through the running API. The report file
itself is the only new file. Environment notes from the earlier "start on localhost" task
(`docker-compose.override.yml`, `.env` — both local-only and gitignored — and the API running on port 8090
because port 8080 was occupied by an unrelated container) remain in place and are referenced where relevant.

---

## A. Executive summary

**Sentinel is a Windows-first, lightweight host-based security-analytics backend.** The operator exports
Windows event logs (EVTX files) from a machine, uploads the file to the API, and the system validates it,
hashes it, stores it in a content-addressed object store, parses every record into a versioned
"canonical-event/v1" document in PostgreSQL, evaluates a pack of detection rules against those events, and
raises **findings** with self-contained evidence snapshots. AEGIS is the pitch name; every artifact in the
repository says "Sentinel".

**What it actually does today (verified):**

1. **Ingest:** `POST /v1/workspaces/{ws}/uploads` accepts exactly one multipart file up to 64 MiB, enforces
   per-principal concurrency + hourly quota + storage quota + idempotency, hashes it three ways, stores it,
   and enqueues an `ingest_file` job. `[runtime]` `[test]`
2. **Parse/normalize:** a background worker parses EVTX via the Rust `evtx` crate bindings, maps supported
   Event IDs (Sysmon, Security, System, PowerShell) into canonical events, and bulk-inserts them under
   row-level security. `[test]` `[runtime]`
3. **Detect:** ingest success auto-chains a `detect_run` job. The engine loads rules from the database,
   compiles each Sigma rule to **PostgreSQL SQL** where possible (with a cost/fallback classifier) or falls
   back to a **native Python evaluator** (re2 regexes, Aho–Corasick keyword sets), and emits findings with
   severity, ATT&CK refs, payload excerpts and an immutable evidence snapshot. A third rule kind, `ioc`,
   matches events against **Ed25519-signed IOC packs** using a Bloom-filter prefilter plus exact confirm.
   `[test]` `[runtime]`
4. **Investigate:** a React/Vite single-page console (sign-in with a workspace-scoped API key) lists uploads,
   events, findings, evidence, runs, per-rule run accounting, jobs, rules, IOC packs, audit entries and
   system health — every page calls a real endpoint. `[static]` `[runtime]`

**What is genuinely distinctive** (see §M): a dual-path detection engine (SQL + native) whose two paths are
provably finding-identical on a golden corpus; evidence snapshots designed to survive purge of the raw
artifact (tested by a mandatory drill); a "never fabricate a pass" accounting model (every skipped/partial
rule carries a machine-readable reason code); multi-tenant row-level security from day one; and a
detection-quality harness that scores rules against the labelled UNSW-NB15 dataset (precision/recall/FPR),
not just "rule matched".

**What is incomplete or unverified:**
- Only `kind: sigma` and `kind: ioc` rules execute. `correlation`, `statistical`, `fim`, `sca`, `artifact`
  are schema-valid and accounted with reason codes but have **no execution engine** (documented deviation
  M2-A4). There is **no machine learning** anywhere (explicit project non-goal).
- The M3 artifact-triage extractors (`extractors.py`, `facts.py`) exist but are **not connected** to any job
  handler, route, or test. `[static]`
- No live endpoint/network monitoring, no agent, no blocking/response — the system analyzes files you give it.
- One contract test fails today (`test_fresh_pack_resolves_clean`) because it pins a fixed date and the
  IOC freshness gate compares against the real clock — a test-suite defect, not a product defect. `[test]`
- The `schema_lint.py` CI gate could not be completed on this Windows machine (blocked on its `docker exec
  psql` path); it runs in CI on Linux. `[inference]` environment-blocked.
- Roughly half the working tree (including the entire `web/` frontend and the whole M3 IOC branch) is
  **uncommitted**; the committed `master` branch is at the M2 state. `[static]`

**Most accurate one-sentence description:** *"Sentinel is an offline, file-based Windows security-analytics
backend: upload an EVTX log, and it normalizes every record into a canonical event store and evaluates
Sigma-format and IOC rules against them, producing findings with immutable evidence — verified end-to-end
by a 583-test suite and scored against a labelled intrusion dataset."*

---

## B. Repository map

| Path | Type | Responsibility | Entry points | Audit relevance |
|---|---|---|---|---|
| `apps/api/sentinel_api/` | Python (FastAPI) | HTTP API: uploads, events, findings, evidence, runs, jobs, rules, IOC packs, audit, health/metrics | `main.py:main()`, `app.py:create_app()` | Core product surface; 26 routes |
| `apps/worker/sentinel_worker/` | Python | Job claim loop, heartbeats, reaper, retry/backoff, handlers dispatch | `main.py:main()` / `process_batch()` | All processing happens here |
| `packages/core/sentinel_core/` | Python | Config (env>file>default), structlog logging, DB `tx()`, RLS GUC helper, error taxonomy (`GateError`) | `config.py:load_settings()`, `rls.py:set_rls()` | Config freeze (41 keys), tenant scoping |
| `packages/ingest/sentinel_ingest/` | Python | EVTX parsing, canonical-envelope building, channel mappings, upload gates, object store, UNSW CSV parser, (unconnected) artifact extractors | `evtx_parser.py:iter_envelopes()`, `worker_handlers.py:handle_ingest_file()` | The ingest pipeline; `facts.py`/`extractors.py` are orphans |
| `packages/detect/sentinel_detect/` | Python | Sigma→SQL compiler, native evaluator, condition parser, field-mapping pipelines, evidence/fingerprint, IOC pack engine, rule import/normalization | `runner.py:run_detection()`, `compile.py:plan()`, `evaluate.py:evaluate()`, `ioc_engine.py` | The detection engine |
| `packages/storage/sentinel_storage/` | Python | SQL repositories: uploads, events, jobs, detect runs, findings, audit, idempotency, timeline | `repos_jobs.py:claim()`, `repos_findings.py:upsert_finding()` | Persistence layer (raw SQL, psycopg) |
| `web/` | TypeScript (React 19) | Operator console SPA: login, overview, uploads, events, findings/evidence, runs, jobs, rules, IOC packs, audit, system | `src/main.tsx`, `src/App.tsx` routes | **Entirely untracked in git** |
| `migrations/` | Python (Alembic) | Schema migrations; `schema.sql` is the reviewed snapshot | `apply.py`, `versions/0001_init.py` | Storage contract |
| `schema.sql`, `openapi.yaml`, `canonical_event_v1.schema.json`, `rule_schema.json` | Contracts | Machine-normative contracts (rank 1–3 in the project's precedence rules) | enforced by `tests/contract/` | The project's defining discipline |
| `configs/` | TOML/JSON/YAML | `config.example.toml` (dev defaults incl. dev API keys), `config_keys.json` (41-key freeze), `rule_pack.json` (default 113-rule pack), `sigma_field_mapping_pipelines.yaml`, `ioc_trusted_keys.json` (**empty**) | — | Rules-as-data; empty trust store is an operational gap |
| `tests/` | Python (pytest) | 32 test files: contract/unit/tripwire (no DB), integration/e2e (PostgreSQL), scoring (UNSW-NB15) | `pytest` | 584 collected; see §I |
| `tools/` | Python | `schema_lint.py`, `extract_examples.py`, `corpus_fetch.py`, `evaluate_unsw_nb15.py`, `conformance_oracle.py`, `plant_fixture.py`, `bench/` | CLI | CI gates + scoring harness |
| `packaging/` | PowerShell/XML | WinSW service definitions (`sentinel-api.xml`, `sentinel-worker.xml`), `install.ps1`, `uninstall.ps1`, `drill.ps1` | — | Windows service packaging (static only; not exercised here) |
| `research/` | Markdown | 17k-line implementation spec, 6 stage documents, `DEVIATION_REGISTER.md`, `M2_EXIT_AUDIT.md`, `consistency_report.md`, stage work artifacts | — | Self-auditing documentation; compared to code in §K |
| `Sentinel_Project_Report.docx` | Report (2026-10-13) | Prior human-readable project report | — | Now partially outdated (§K) |
| `docker-compose.yml` | Compose | PostgreSQL 18 + 3-role bootstrap (`packaging/docker-init/00-roles.sql`) | `docker compose up -d --wait` | Dev/CI topology |

**Languages:** Python 3.14 (backend; `requires-python >= 3.12`), TypeScript/TSX (frontend), SQL (PostgreSQL 18
DDL), PowerShell (packaging), YAML/JSON (contracts, rules).

**There is one application** (API + worker + console) plus dev tooling. No second product hides in the tree.

---

## C. Technology inventory

Backend versions below are pinned in `requirements.txt` and **match the installed venv exactly**
(`pip list`, 2026-10-22) `[test]`:

| Technology | Version | Where used | Actual responsibility | Evidence | Usage status |
|---|---|---|---|---|---|
| Python | 3.14.3 (venv) | everywhere | runtime | `.venv`, `pyproject.toml` requires ≥3.12 | production |
| FastAPI | 0.143.0 | `apps/api` | HTTP framework, 26 routes, multipart, OpenAPI 3.1 emission | imports in all `routes_*.py` | production |
| Pydantic | 2.14.0 | (FastAPI dependency; config uses dataclasses) | request models via FastAPI | installed; config itself is dataclass-based `[static]` | indirect |
| Uvicorn | 0.54.0 | `main.py:main()` | ASGI server | `[runtime]` (running now) | production |
| psycopg 3 | 3.3.6 (+binary) | `sentinel_core/db.py`, all repos | raw-SQL DB access, `SKIP LOCKED` queue | `[runtime]` | production, essential |
| Alembic | 1.20.0 | `migrations/`, `tools/schema_lint.py` | schema evolution; `schema.sql` is the reviewed snapshot | `[test]` (`apply.py` run) | production |
| structlog | 26.1.0 | `sentinel_core/logging.py` | JSON structured logs (`config.loaded`, `ingest_file.done`, …) | `[runtime]` (api/worker logs) | production |
| prometheus-client | 0.26.0 | `apps/api/metrics.py` | `/metrics` exposition: request counters/histograms, upload accept/reject, job gauges | `[runtime]` | production |
| OpenTelemetry API+SDK | 1.45.1 | **nowhere** | declared; only a config key `observability.otel_endpoint` exists | no import in `apps/`/`packages/` `[static]` | **declared, unused** (D6-014: "present but inert") |
| jsonschema | 4.26.0 | `sigma_import.py:256`, tests | validates rule documents against `rule_schema.json` at import | `[test]` | production |
| fastjsonschema | 2.22.2 | `tools/evaluate_unsw_nb15.py` only | fast validation for the 257k-row UNSW run | `[test]` | tooling only |
| PyYAML | 6.0.3 | `sigma_import.py`, `pipelines.py` | rule YAML + pipeline YAML parsing | `[static]` | production |
| python-multipart | 0.0.32 | (FastAPI internal) | multipart parsing behind `await request.form()` | `[runtime]` (upload works) | indirect, essential |
| argon2-cffi | 25.1.0 | **nowhere** | only a config block `security.argon2_params` + a comment; principals bootstrap with **unsalted sha256** (`app.py:_bootstrap_principals`) | `[static]` | **declared, unused** (stub for future auth) |
| evtx | 0.13.1 | `evtx_parser.py` (Rust crate bindings) | EVTX → XML records | `[test]` `[runtime]` | production, essential |
| google-re2 | 1.1.x | `compile.py:355`, `evaluate.py:276` | non-backtracking regex for rule patterns (ReDoS defense) | `[test]` | production, essential |
| pyahocorasick | 2.3.1 | `evaluate.py:326` | Aho–Corasick keyword sets in the native evaluator | `[static]` | production |
| python-json-logger | 4.2.0 | **nowhere** | — | no import `[static]` | **declared, unused** |
| cryptography | 50.0.2 | `ioc_engine.py:362` | Ed25519 verification of signed IOC packs (D4-003) | `[test]` (`test_ioc_engine.py`, `test_m3_ioc.py`) | production (M3) |
| pytest 9.1.1 / hypothesis 6.168.5 / httpx 0.28.1 | as pinned | `tests/` | test framework, property tests, TestClient | `[test]` | test-only |

Frontend (resolved from `web/package-lock.json`) `[static]`:

| Technology | Version | Responsibility | Usage status |
|---|---|---|---|
| React + ReactDOM | 19.3.0 | console SPA | production |
| react-router-dom | 7.18.4 | routing (17 routes, `App.tsx`) | production |
| Vite | 7.3.7 | dev server (proxies `/v1`, `/health`, `/ready`, `/metrics` to the API) + build | production |
| TypeScript | 5.8.3 | typing; `tsc -b` passes clean | production |
| Biome | 2.5.15 | lint (39 files, clean) | dev tooling |
| @fontsource (Inter, JetBrains Mono, Instrument Serif) | 5.x | self-hosted fonts | production |

**Not present anywhere:** pandas/numpy/scikit-learn/torch (no ML stack), scapy/dpkt (no packet capture),
YARA (planned as a scanner bridge only), any cloud SDK.

---

## D. Complete feature inventory

### D1. Upload + ingest gate — **Implemented and verified**
- `routes_uploads.py:create_upload` (L67): multipart, exactly one file part, field-size cap (8 KiB),
  request cap 64 MiB (Content-Length pre-check in `app.py` middleware + streamed cap in
  `store.py:write_stream`), per-principal concurrency limiter + hourly quota
  (`gate.py:PrincipalLimiter`), storage quota check, `Idempotency-Key` replay/mismatch handling, three
  hashes (sha256/sha1/md5), audit row for accept and reject. `[runtime]` `[test]` (`tests/e2e/test_upload_flow.py`,
  `tests/integration/test_jobs.py`, `tests/unit/test_gate.py`)
- Errors use a structured `GateError` taxonomy with HTTP codes + `RateLimit-*` headers on 429.

### D2. EVTX parsing + canonical-event normalization — **Implemented and verified**
- `evtx_parser.py:iter_envelopes` → `parse_record_xml` → `mappings.map_record` → `envelope.build_envelope`.
  Value-state model (`ok/inferred/unknown/invalid/null`) for times, hashes, SIDs, PIDs
  (`envelope.py:parse_evtx_time`, `split_domain_user`, `split_hashes`). Channel classification
  (`default_classification`). Truncated EVTX tails degrade gracefully (`_iter_records` counts `tail_error`,
  never fails the job).
- Mappings: Sysmon (230 lines), Security (230), System (114), PowerShell (37) — a closed Event-ID table;
  unmapped EIDs are counted, never silently dropped (`unmapped_eid`).
- 121 committed canonical-event fixtures validate against the normative schema
  (`tests/contract/test_canonical_event.py`, `test_fixture_corpora.py`). `[test]`

### D3. Background job platform — **Implemented and verified**
- PostgreSQL `SKIP LOCKED` queue (`repos_jobs.claim`), worker `process_batch` with batch heartbeats
  (`Heartbeater`), stale-lock reaper with backoff + dead-letter (`reap_once`, `finish`), exactly-once
  claim semantics tested with concurrent workers (`tests/integration/test_jobs.py`,
  `test_queue_lifecycle.py`). Operator retry endpoint `POST /v1/workspaces/{ws}/jobs/{id}`
  (authenticated, workspace-checked, audited). `[test]` `[runtime]`

### D4. Detection engine (sigma) — **Implemented and verified**
- `runner.py:run_detection`: loads the workspace's rules, cold-start classification, per-rule compile-on-demand
  (engine-version-keyed cache), SQL path executes the compiled statement with bound parameters; native path
  loads scoped event rows and runs `evaluate.py`. Per-rule `rule_run` accounting with outcome
  (`ok / ok_partial / skipped / error`), timing (sql_ms/native_ms), detection path, reason codes.
- `compile.py:plan`: Sigma condition parser (`condition.py`, supports `and/or/not/of N/*`) → SQL with a cost
  classifier (`_cost_class`), modifiers (contains/endswith/startswith/startswith|contains/regex/case etc.),
  RE2 validation of every rule regex (`validate_regexes`, registers `UNSUPPORTED_REGEX_CONSTRUCT`),
  windash expansion in `normalize.py` (cap 32 → `UNSUPPORTED_MODIFIER`).
- Field-mapping pipelines: `configs/sigma_field_mapping_pipelines.yaml` maps Sigma fields → canonical paths;
  unmapped fields become `UNMAPPED_FIELD` warnings, never fatal (`pipelines.py`, `normalize.py` docstring).
- Fallback accounting: `COST_BUDGET_EXCEEDED`, `FIELDREF_NATIVE_ONLY`, `REGEX_NATIVE_ONLY`, `NATIVE_BY_COMPILE`,
  `SQL_TIMEOUT`, `UNSUPPORTED_CONDITION_FORM` — a rule that cannot fully run is `ok_partial`, never silent.
- The default pack is real: `configs/rule_pack.json` declares pack `sigmahq-windows-process-creation`
  (sha256 pinned) of 113 SigmaHQ-derived rules (DRL-1.1 attribution in
  `tests/conformance/ATTRIBUTION.md`); a tripwire test forbids hard-coded detections in engine code
  (`tests/tripwire/test_no_detection_constants.py`). `[test]` `[runtime]`

### D5. Detection engine (ioc) — **Implemented and verified (M3, uncommitted)**
- Signed-pack import `POST /v1/workspaces/{ws}/ioc-packs` (`routes_ioc.py:create_ioc_pack`): canonical
  bytes → Ed25519 detached signature verified against a workspace trust store
  (`ioc_engine.py:verify_pack_signature`); unsigned/unknown-key/bad signature → `status=rejected` with an
  audit row and **zero entries ingested**; duplicate `(name, version)` → 409 last-known-good retained.
- Detector pass `ioc_engine.py:evaluate_ioc_rule`: Bloom prefilter (blake2b, k=6, ~10 bits/entry) + exact
  confirm; only Stage-B emits findings; stale packs (age > 7 days or digest drift) suppress LOW findings and
  tag `IOC_PACK_STALE`; missing packs tag `IOC_PACK_MISSING`.
- Tested (`tests/contract/test_ioc_engine.py` 36 tests, `tests/integration/test_m3_ioc.py`) — but **one
  contract test currently fails** because the fixture's fixed date has aged past the 7-day freshness gate
  (see §I, §J). `[test]`
- **Operational gap:** `configs/ioc_trusted_keys.json` is `{"keys": []}`, so every pack imported through the
  API is rejected until an operator adds a trusted key. `[static]`

### D6. Evidence + findings + triage — **Implemented and verified**
- `evidence.py:build_finding/build_snapshot`: `sentinel-finding/v1` + `sentinel-evidence/v1` containing the
  rule document digest, run id, config hash, per-event document sha256 digests, payload excerpt (capped),
  ATT&CK refs, false-positives note, author attribution (DRL), detection path, reason codes.
  The snapshot is self-contained: the mandatory R1 drill purges the raw object and proves
  `GET /evidence/{uid}` still returns a complete snapshot (`tests/integration/test_m2_exit.py:214`). `[test]`
- Finding identity: `fingerprint.py:finding_fingerprint` over (tenant, workspace, rule, time, event_uids,
  host, user) — identical across SQL and native paths (conformance oracle). `[test]`
- Triage: `PATCH /v1/workspaces/{ws}/findings/{uid}` updates triage state (FindingsPage + FindingDetail UI). `[static]`

### D7. Detection runs (manual + auto-chain) — **Implemented and verified**
- Ingest success auto-enqueues `detect_run` over the same harvest run (`worker_handlers.py:128-152`).
  `POST /v1/workspaces/{ws}/runs` creates a manual run with arbitrary scope (`rule_ids`, `run_ids`,
  `harvest_run_id`; empty scope = all events in the workspace). Per-rule run detail via
  `GET .../runs/{id}/rule-runs`. `[runtime]` `[test]`

### D8. Multi-tenancy (RLS) + audit — **Implemented and verified**
- `schema.sql` enables RLS with 32 policies on all tables incl. 11 partitions; every API transaction sets
  transaction-local GUCs (`rls.py:set_rls`); the worker role is `BYPASSRLS` by design (documented platform
  processor). Cross-tenant probes return 403/empty (`tests/integration/test_rls.py`, e2e cross-tenant test). `[test]`
- `audit_log` (partitioned) records accepts, rejects, denied workspace attempts, run creates, job retries,
  IOC imports. `GET .../audit` surfaces it; the login flow itself validates against the audit endpoint. `[test]` `[runtime]`

### D9. Health, readiness, metrics — **Implemented and verified**
- `/health` (liveness), `/ready` (DB + object-store probe + queue staleness; 503 on degraded),
  `/metrics` (Prometheus). Verified live including degraded flip under DB stop (CI test
  `tests/integration/test_readiness.py`). `[runtime]` `[test]`

### D10. Operator console (web) — **Implemented and verified for wiring; no automated UI tests**
- 17 routes (`App.tsx`): Landing, Login/Logout/Forgot-password, and console pages Overview, Workspaces,
  Uploads (+detail), Events, Findings (+detail, +evidence), Rules, Runs (+detail), Jobs, IOC Packs, Audit,
  System. Every data path calls the real API through `lib/api.ts` (X-API-Key header, error taxonomy,
  Idempotency-Key). The Overview explicitly avoids invented counters; the Landing page labels its fixture
  excerpt "Demonstration · committed test fixture — not live product output". `[static]` `[runtime]`
- Known UI gaps (confirmed in code): `WorkspacesPage` states plainly that `GET /v1/workspaces` is declared
  in OpenAPI but **not routed**; pagination `next` is a real cursor **only for events** — every other list
  endpoint returns `next: null` (all `routes_*.py` return `"next": None` except `routes_uploads.py:366`).
  No Playwright/Cypress/Selenium anywhere; `package.json` has no test script. `[static]`

### D11. UNSW-NB15 detection-quality harness — **Implemented and verified**
- `unsw_nb15.py` maps the 45-column flow CSVs to canonical `network_connection` documents with a
  **zero-drop contract** (a row that cannot be interpreted raises, never skips); ground truth
  (`label`/`attack_cat`) is deliberately kept out of the document so rules cannot score themselves
  (`tests/scoring/test_unsw_nb15_pack.py` fails any rule that references them).
- `tools/evaluate_unsw_nb15.py` + `tests/scoring/` (40 tests) score a 6-rule Sentinel-authored pack on both
  splits. Numbers regenerated today (`bench/unsw_nb15_scoring.json`): **train** F1 0.918, precision 0.954,
  recall 0.885; **test** F1 0.886, precision 0.838, recall 0.939, **FPR 0.223 on the Normal class**
  (per-category test recall: Backdoor 0.93, DoS 0.92, Exploits 0.94, Fuzzers 0.76, Generic 1.00,
  Recon 0.96, Shellcode 0.96, Analysis 0.99, Worms 1.00). `[test]` `[runtime]`
- Licence constraint: academic-only dataset, fetched out-of-tree (`.corpus/unsw-nb15`, gitignored, sha256 +
  citation pinned). `[doc]` `[static]`

### D12. Artifact triage branch (extractors) — **Prototype (unconnected, untested)**
- `extractors.py` implements pure-function OOXML/archive/PDF/PE fact extractors with magic-byte dispatch
  (`extract_for`), and `facts.py` defines the `Fact` type. **No caller exists** anywhere in apps, packages,
  tools or tests (only self-references; verified by search). There is no triage job type, no
  `artifact_facts` writer, no fact-to-finding engine. The `artifact_facts` table exists in `schema.sql` but
  nothing writes it. `[static]`

### D13. Not found (inspected scope)
- Correlation / statistical / FIM / SCA / artifact **execution engines** (`UNSUPPORTED_RULE_KIND` in
  `runner.py:_process_rule`; statistical rules are additionally cold-start-suppressed —
  `runner.py:_cold_start_codes`).
- Any machine-learning model, training, or inference path.
- Live collection (ETW/WEC/agents), live network capture, blocking/prevention, remediation.
- Retention writers (`retention_policies` table is read-or-seed only), S3 storage backend, timeline HTTP
  endpoint (timeline exists as an in-process query used by the bench), password/OIDC auth, workspace
  management API, presigned evidence-download URLs (deviation M2-A2).

---

## E. Architecture and data flow

```
                    ┌──────────────────────────────────────────────────────────┐
                    │  Browser console (React 19 SPA, web/src)                 │
                    │  Login stores (apiKey, workspaceId) locally              │
                    │  lib/api.ts → fetch + X-API-Key + Idempotency-Key        │
                    └───────────────┬──────────────────────────────────────────┘
                                    │ HTTP (dev: Vite proxy → API)
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ FastAPI app (apps/api/sentinel_api/app.py:create_app)                                │
│  middleware: body_limit_and_metrics (413 on oversized Content-Length, Prometheus)     │
│  auth.py:authenticate  ← static dev keys, constant-time compare (M1 stub)             │
│  require_workspace → denied attempts are audited                                      │
│  routers: uploads·events·findings·evidence·runs·jobs·rules·ioc·audit·health           │
│  GateError → structured JSON error (4xx/5xx)                                          │
└───────────────┬──────────────────────────────────────────────────┬────────────────────┘
                │ enqueue ingest_file / detect_run                 │ read models
                ▼                                                  │
┌──────────────────────────────────┐   ┌───────────────────────────▼────────────────────┐
│ PostgreSQL 18 (docker)           │◄──┤ Worker (apps/worker)                           │
│  jobs: SKIP LOCKED claim,        │   │  process_batch → Heartbeater → HANDLERS        │
│        heartbeat, reaper,        │   │  ingest_file → evtx_parser.iter_envelopes      │
│        dead-letter, backoff      │   │            → mappings.map_record               │
│  events (partitioned, GIN jsonb) │   │            → envelope.build_envelope           │
│  findings (partitioned)          │   │            → bulk_insert (RLS-scoped)           │
│  rules / rule_source / ioc_pack  │   │  detect_run  → runner.run_detection             │
│  audit_log, idempotency_keys     │   │       SQL path (compile.plan)  or               │
│  RLS: 32 policies, 3 roles       │   │       native path (evaluate + re2 + AC)         │
└───────────────▲──────────────────┘   │       + IOC pass (ioc_engine, Ed25519 packs)    │
                │ sha256 CAS           │       → findings + evidence_snapshot            │
┌───────────────┴──────────────────┐   └─────────────────────────────────────────────────┘
│ .sentinel-data/objects (fs CAS)  │
└──────────────────────────────────┘
```

**Upload → finding pipeline (one sentence per hop, with source):**

1. `POST …/uploads` (`routes_uploads.py:create_upload:67`) — gate, hash, CAS write, `uploads` row,
   `raw_objects` row, `enqueue(ingest_file)`, audit. HTTP 202. `[runtime]`
2. Worker `handle_ingest_file` (`worker_handlers.py:69`) — sets triage `running`, streams the file through
   `iter_envelopes`, maps records, bulk-inserts batches of 500 event rows, sets triage `done`.
3. Auto-chain (`worker_handlers.py:128`) — `repos_detect.create_run` + `enqueue(detect_run)`.
4. `handle_detect_run` → `runner.run_detection` (`runner.py:181`) — per-rule compile/execute, findings via
   `_emit_finding` (`runner.py:510`), summary + terminal status (`completed`,
   `completed_with_warnings`, `failed`).
5. API reads — `GET …/uploads`, `…/runs/{id}/rule-runs`, `…/findings`, `…/evidence/{uid}`, `…/events`
   (only cursor-paginated route) — all RLS-scoped. Console renders them.

Everything after step 1 is **asynchronous** (Postgres-queued jobs, single worker process today); the API
never does detection inline.

---

## F. Security engine and detection logic

**Implemented mechanisms**

| Mechanism | How it works | Source |
|---|---|---|
| Rule matching (Sigma) | Rule documents (YAML→`sentinel-rule/v1`) stored in `rules`; two execution paths: (a) **SQL** — condition compiled to parameterised SQL over `events` jsonb with pipeline prefilters and a cost classifier; (b) **native** — per-event field-path evaluation with modifier semantics (contains/endswith/regex/case/windash), RE2 regex, CIDR via `ipaddress`, Aho–Corasick for keyword identifiers | `compile.py:plan:490`, `evaluate.py:evaluate:47`, `condition.py:parse_condition:158` |
| Signature-style matching | Indicator lists live in signed packs, not in rules; Bloom prefilter (no false negatives by construction, tested) + exact hash confirm; only exact confirm emits findings | `ioc_engine.py:144/214/431` |
| Severity | Carried from the rule document (`severity`, `level_original`) — no learned or computed severity | `runner.py:_emit_finding` |
| Confidence | Only in the (unconnected) artifact branch's fact vocabulary; sigma/IOC findings carry no confidence score | `facts.py` |
| Evidence | Self-contained `sentinel-evidence/v1` snapshot: finding doc, rule block (id/name/title/source_ref/sha256/status/level), run id + config hash, per-event sha256 digests, payload excerpt; survives raw purge | `evidence.py:build_snapshot:134`, M2 exit ② drill |
| Deduplication | Deterministic fingerprint per (tenant, workspace, rule, time, event_uids, host, user); unique index on findings; both paths agree byte-for-byte (conformance oracle) | `fingerprint.py:finding_fingerprint:27`, `conformance_oracle.py` |
| Cold-start honesty | Missing baseline/IOC pack/staleness never fabricates a pass: rule accounted `skipped`/`ok_partial` with `BASELINE_MISSING`/`BASELINE_WARMUP`/`IOC_PACK_*`, run becomes `completed_with_warnings` | `runner.py:_cold_start_codes:121`, `_process_ioc_rule:444` |
| ReDoS defense | Every rule regex validated through RE2 at compile; native path executes with `re2`, never `re` | `compile.py:validate_regexes:355`, `evaluate.py:_regex_match:276` |
| Triage / investigation | Analyst triage state on findings; per-rule run accounting (`rule_runs` with outcome, counts, timings, reason codes) is unusually transparent | `routes_findings.py:132`, `repos_detect.upsert_rule_run` |

**Explicitly absent (not in code, not claimed):** statistical/anomaly detection (rule kind exists, engine
does not), correlation rules (no window/counting engine), threshold detection, machine learning of any kind,
trained models, automated remediation, blocking/prevention, live monitoring. The project's own stage-1
spec declares "no blocking, no response, no ML" as non-goals `[doc]`, and the code matches `[static]`.

**False-positive handling:** the sigma/IOC paths have no runtime FP suppression (no whitelists, no baselines
yet); FP management is via rule content (`falsepositives` note attached to evidence) and triage states.
The only quantified FP measurement is the offline UNSW harness (FPR 0.223 on Normal, test split) — a
**harness metric for a 6-rule research pack**, not a product-wide FPR. `[test]`

---

## G. Frontend and backend integration

| UI page | User action | API call (method + path) | Backend handler | Status |
|---|---|---|---|---|
| Login | sign in with API key + workspace | `GET /v1/workspaces/{ws}/audit?limit=1` | `routes_audit.py:33` | fully connected; validation is a real authenticated call (`auth.tsx:108-114`) |
| Overview | health + recent feeds | `/health`, `/ready`, `GET …/uploads?limit=5`, `GET …/findings?limit=5` | health router, uploads, findings | connected; explicitly "no invented counters" |
| Uploads | upload file (+agent/path metadata) | `POST …/uploads` (multipart, Idempotency-Key) | `routes_uploads.py:67` | connected (`UploadsPage.tsx:193-197`) |
| Upload detail | inspect one artifact | `GET …/uploads/{id}`, joins runs | `routes_uploads.py:261` | connected |
| Events | filterable event list/detail | `GET …/events` (only route with a real `next` cursor), `GET …/events/{uid}` | `routes_uploads.py:336/369` | connected |
| Findings | list/filter, triage PATCH | `GET …/findings`, `PATCH …/findings/{uid}` | `routes_findings.py:62/132` | connected |
| Finding detail | inspect finding | `GET …/findings/{uid}` | `routes_findings.py:110` | connected |
| Evidence | evidence bundle | `GET …/evidence/{uid}` | `routes_findings.py:182` | connected (always returns the snapshot) |
| Rules | list, inspect source, import | `GET …/rules`, `GET …/rules/{id}/source`, `POST …/rules` | `routes_rules.py:37/99/124/168` | connected |
| Runs / Run detail | create manual run; per-rule accounting | `POST …/runs`, `GET …/runs/{id}`, `GET …/runs/{id}/rule-runs` | `routes_runs.py:55/156/173` | connected |
| Jobs | operator retry of failed/dead jobs | `POST …/jobs/{id}` | `routes_jobs.py:25` | connected (GET list is operator-log-based; honest copy) |
| IOC packs | list, import (signed), detail | `GET/POST …/ioc-packs`, `GET …/ioc-packs/{id}` | `routes_ioc.py` | connected; every import will be `rejected` until a trusted key is configured (empty trust store) |
| Audit | filterable audit log | `GET …/audit` | `routes_audit.py:32` | connected |
| System | health/readiness/metrics exposition | `/health`, `/ready`, `/metrics` | health router | connected |
| Workspaces | show session scope only | none | — | **honest gap**: page states the list endpoint is not routed |

**Mocked/hardcoded data:** none found in console pages. The only procedural randomness is the Landing page's
decorative `PipelineCanvas` particle animation. `[static]`
**Backend features with no UI:** `DELETE …/ioc-packs/{id}` (retire) has no UI button; `GET …/events/{uid}`
detail page partial; job list has no GET endpoint at all (only retry). `[static]`

---

## H. Configuration, storage, and integrations

- **Configuration:** precedence `SENTINEL_*` env > TOML file > built-in default
  (`config.py:load_settings:403`); env names are `SENTINEL_<SECTION>__<KEY>` with legacy flat aliases
  (`config.py:308-331`). 41 keys frozen in `configs/config_keys.json`, enforced by
  `tests/contract/test_config_freeze.py`. Secrets (3 DSNs) are env-only in production; startup fails closed
  if missing. Dev keys live in `config.example.toml` (plaintext, by design, marked M0-A2 dev-only). `[test]`
- **Storage:** PostgreSQL 18 (docker) with monthly partitions for `events`, `findings`, `audit_log`;
  JSONB `document` with `jsonb_path_ops` GIN; 21 tables incl. `ioc_pack/ioc_entry`, `rule_baseline`,
  `fim_baseline`, `artifact_facts`, `retention_policies` (the last four are schema-only — no writers).
  Object store: filesystem CAS (`.sentinel-data/objects`), sha256-addressed; S3 enum reserved, unimplemented.
- **Roles:** `sentinel_app` (RLS), `sentinel_migrator` (DDL), `sentinel_worker` (BYPASSRLS) — created by
  `packaging/docker-init/00-roles.sql`. `[runtime]`
- **External integrations:** none at runtime. No third-party API is called by the product. Corpus fetching
  (`tools/corpus_fetch.py`) is a dev/CI tool. `[static]`
- **Frontend env:** `VITE_API_BASE` (optional; default same-origin via the dev proxy). `[static]`
- **Deployment artifacts:** WinSW service XMLs + install/uninstall/drill PowerShell scripts exist
  (`packaging/`) but were not executed in this audit; the M1 exit criterion "installer creates both services
  on a clean Windows VM" has no committed evidence file in the tree. `[static]` `[inference]`

---

## I. Tests and verification (executed 2026-10-22)

| # | Command | Result | Notes |
|---|---|---|---|
| 1 | `pytest tests/contract tests/unit tests/tripwire` | **359 passed, 1 failed**, 11.8 s `[test]` | Failure: `tests/contract/test_ioc_engine.py::test_fresh_pack_resolves_clean` — the fixture pins `NOW = 2026-10-13`; the engine's freshness gate (`ioc_engine.py:204` `PackIndex.is_stale`) compares to `datetime.now()`, so the "fresh" pack is now 9 days old (> 7-day gate). Time-dependent test; product logic is correct, the test is a time bomb that started failing 2026-10-20. |
| 2 | `pytest tests/integration tests/e2e -m "not slow"` (with DB env overrides) | **183 passed, 3 deselected**, 25.8 s `[test]` | Includes the M2 exit gates (planted detection, evidence-after-purge drill, cold-start codes), conformance oracle, RLS probes, jobs/queue lifecycle, readiness, metrics, M3 IOC integration, and the 1 MiB EVTX e2e upload flow. |
| 3 | `pytest tests/scoring` | **40 passed**, 83.7 s `[test]` | UNSW-NB15 both splits, zero-drop + schema validity + frozen thresholds. Regenerated `bench/unsw_nb15_scoring.json`. |
| 4 | `python tools/extract_examples.py --check` | exit 0, "fixtures are up to date" `[test]` | Spec↔fixture drift gate. |
| 5 | `python tools/schema_lint.py` | **did not complete** (attempted twice; ~5 min timeout) `[static]` | Without DB overrides it prints "Postgres unreachable … starting docker compose"; with overrides it produced no output before the timeout. It uses `docker exec … psql` when no psql client is on PATH (`schema_lint.py:104-166`); the remapped local DB port (54310, see disclosure) and the Windows environment appear to break its path. **This CI gate is unverified on this machine**; CI evidence (`ci.yml`) runs it on ubuntu-latest. |
| 6 | `npm run lint` (Biome) in `web/` | exit 0, 39 files clean `[test]` | |
| 7 | `npm run typecheck` (tsc -b) | exit 0 `[test]` | |
| 8 | `npm run build` | **not run** (would write `web/dist`; not needed for the audit) | |
| 9 | Live end-to-end: `POST …/uploads` with `tests/planted/sysmon_planted.evtx` through the Vite proxy | 202 → triage `done` in <12 s; worker log: `ingest_file.done` 41 records / 33 events / 8 unmapped / 0 parse errors; `detect_run.done` 113 rules evaluated (96 ok, 17 ok_partial), **2 findings**, paths sql 99 / native 14, status `completed_with_warnings`, reason codes `COST_BUDGET_EXCEEDED, FIELDREF_NATIVE_ONLY, REGEX_NATIVE_ONLY, UNMAPPED_FIELD`, pack `sigmahq-windows-process-creation` sha256 pinned `[runtime]` | API, worker, DB, CAS, engine and console proxy all real. |
| 10 | Live auth probes | correct key+workspace → 200; key + foreign workspace → 403 `GATE_TENANT_MISMATCH`; no key → 401 `[runtime]` | Matches the login page's validation logic exactly. |

**Evidence levels:** unit+contract+integration+e2e+scoring all executed here (levels 1–5 of confidence).
Slow markers (`10k-job soak`, `docker stop/start`, timeline bench) were deselected; the timeline bench's
committed result (`bench/timeline_m2.json`) records **p95 1413 ms @ 100 000 events against a 2 000 ms
budget**, measured locally on this machine (PG 18.6, Windows 11, Python 3.14.3) — a local diagnostic, not a
published load test. Production/deployment evidence: none (nothing is deployed anywhere).

---

## J. Security and implementation gaps

| # | Finding | Class | Evidence & significance |
|---|---|---|---|
| J1 | Contract test `test_fresh_pack_resolves_clean` fails from 2026-10-20 onward (fixed `NOW` vs live clock) | **Confirmed gap** (test health) | `tests/contract/test_ioc_engine.py:36` vs `ioc_engine.py:204`. Any CI run today is red; also proves freshness logic works but fixtures need clock-freezing. |
| J2 | Upload triage never records failure: `failed` / `rejected_by_policy` are schema states with **no writer**; a crashed ingest leaves the upload `running` while the job dead-letters | **Confirmed gap** | `worker_handlers.py` writes only `running` (L89) and `done` (L125); `set_upload_triage_state` has no other caller. Operators must correlate jobs↔uploads manually. |
| J3 | Artifact-triage extractors are dead code: no caller, no job type, no tests, no `artifact_facts` writer | **Confirmed gap** | Only self-references to `extract_for` exist (search, 2026-10-22). The `artifact_facts` table is schema-only. |
| J4 | Five rule kinds (`correlation`, `statistical`, `fim`, `sca`, `artifact`) accept imports and cold-start accounting but can never execute; a ready one surfaces `UNSUPPORTED_RULE_KIND` | **Known limitation** (documented, M2-A4/M3-A4) | `runner.py:_process_rule:404-415`, `DEVIATION_REGISTER.md:257`. Honest accounting mitigates the risk of silent misses. |
| J5 | Auth is a documented stub: static keys in a config file, principal bootstrap hashes keys with **unsalted sha256**, argon2 dependency and config block unused; no password, role, OIDC or key-rotation machinery | **Known limitation / potential risk** | `auth.py:19-25`, `app.py:_bootstrap_principals:39`. Acceptable for a dev milestone; must not be presented as production auth. |
| J6 | IOC trust store is empty, so the signed-pack feature cannot reach `active` state through the product until an operator provisions a key pair and edits `configs/ioc_trusted_keys.json` | **Confirmed gap** (operational) | `configs/ioc_trusted_keys.json` = `{"keys": []}`; `routes_ioc.py:create_ioc_pack` marks unsigned/unknown-key packs `rejected`. |
| J7 | Rate limiting and the upload limiter are **in-process** (`PrincipalLimiter` on `app.state`); with >1 uvicorn worker the quota multiplies, and nothing survives a restart | **Potential risk** | `app.py:83-86`, `gate.py:13`. Fine for `server.workers=1`; a deployment constraint to state explicitly. |
| J8 | Findings dedup is run-scoped per event-uid: re-uploading the same file creates new event rows and therefore new findings (observed: 20 findings across repeated ingest of the same planted file) | **Known limitation** | `fingerprint.py` includes `event_uids`; `upsert_finding` unique index is per-run-window (D6-013). Correlating "same alert, same file, uploaded twice" is a human's job today. `[runtime]` `[inference]` |
| J9 | No TLS/cert management anywhere; API trusts `X-API-Key` headers; dev keys are committed in the repo | **Potential risk** | `auth.py`, `config.example.toml:96-110`. Fine on loopback; a real deployment needs a secret source and TLS termination. |
| J10 | Worker DB role is `BYPASSRLS` (by design) and handlers set RLS GUCs manually; a handler bug could read cross-tenant rows | **Potential risk** | `worker_handlers.py:_dsn`; mitigated by explicit `set_rls` in every handler block and by `tests/integration/test_rls.py`. |
| J11 | Retention/legal-hold: config keys and `retention_policies` table exist; **no writer/executor** implements purge | **Confirmed gap** | `schema.sql:476`; no code selects `retention_policies`. |
| J12 | Pagination is inert on every list route except events (`next: null`) | **Known limitation** | All `routes_*.py` return `"next": None`; `routes_uploads.py:366` is the only `next_cursor`. |
| J13 | Performance claims in the spec remain PROPOSED; only local diagnostics exist (timeline p95 1413 ms; no 10k-soak result committed) | **Unverified** | `consistency_report.md` stage-8 item 18; `bench/timeline_m2.json` is a local run. |
| J14 | `schema_lint.py` (M0 exit ① CI gate) could not be executed on this machine | **Unverified** | §I row 5. |
| J15 | The entire product (including all M3 work) is **uncommitted**: 22 modified + 10 untracked paths, including `web/`, `ioc_engine.py`, `routes_ioc.py`, `routes_rules.py` | **Potential risk** (reproducibility) | `git status`, 2026-10-22. The committed `master` cannot build the console or run IOC features; any machine clone today gets M2 only. |
| J16 | UI has zero automated tests; correctness of console behavior rests on the API contract tests | **Known limitation** | No test script in `web/package.json`; no e2e browser tooling in the tree. |

Positive security observations (also evidence-backed): parameterised SQL everywhere (no string-built queries
found in repos), RE2 for rule regexes, size/quota/rate gates, structured denial auditing, RLS on every
tenant-scoped read/write, constant-time key comparison, fail-closed pack verification, no third-party WAF or
network dependency, and a tripwire suite that forbids hard-coded detections in engine code.

---

## K. Documentation-versus-code comparison

Primary documents compared: `README.md`, `Sentinel_Project_Report.docx` (2026-10-13),
`research/SENTINEL_IMPLEMENTATION_SPEC.md` (§9 milestones), `research/DEVIATION_REGISTER.md`,
`research/M2_EXIT_AUDIT.md`, `research/consistency_report.md`, `web/` copy.

| Claim in documentation | Supporting document | Actual code evidence | Status | Correct interpretation |
|---|---|---|---|---|
| "No IOC matching at all … no import and no matching code" | Project report docx §2/§14 (2026-10-13) | `ioc_engine.py` (590 lines), `routes_ioc.py`, `tests/contract/test_ioc_engine.py`, `tests/integration/test_m3_ioc.py` | **Contradicted by code** (doc predates the M3 IOC branch) | IOC pack import + matching now exist and are tested; the docx is stale on this point |
| "No rule import path in the product" | docx §14 | `routes_rules.py:168 POST …/rules`, RulesPage import UI | **Contradicted by code** | Rules can be imported through the product (sigma YAML and native documents, deviation M3-A8) |
| "No workspace, job or rule management APIs in this build" | docx §14 | `routes_jobs.py:25`, `routes_rules.py`, `routes_ioc.py` | **Partially contradicted** | Jobs retry + rules + IOC APIs exist; workspace management remains unimplemented (`WorkpacesPage` says so honestly) |
| "Only `kind: sigma` executes" | docx §14, deviation M2-A4 | `runner.py` dispatches `sigma` **and** `ioc`; other kinds → `UNSUPPORTED_RULE_KIND` | **Partially superseded** | sigma + ioc execute; correlation/statistical/fim/sca/artifact still do not |
| "pytest tests/scoring fails immediately (no corpus)" | docx §13 | corpus present in `.corpus/unsw-nb15`; 40/40 pass here | **Contradicted by execution** (environment-dependent) | The corpus is fetched locally; the gate is fail-never-skip by design |
| "M3 and M4 have not started" | docx §3 | M3 deviation entries M3-A1…A12 exist; IOC branch + extractors landed | **Partially superseded** | M3 is in progress (IOC half functionally complete; triage half is scaffolding); M4 shows no code beyond WinSW XMLs |
| "539 tests passing" / README "379 tests" | `M2_EXIT_AUDIT.md:17`, `README.md:53` | 582 passed + 1 failed today across suites | **Stale counts** | Suite grew with M3 tests; README predates M2 gates (the docx already flagged this) |
| "26 findings / 267 uploads / 93 011 events today" | docx §2 `[live]` | DB state has moved since 10-13 | **Dated observation** | Valid only as of 2026-10-13; do not reuse as current figures |
| Upload gate limits (64 MiB request/file, 8 KiB field, 4 concurrent, 500/h quota, 50 GiB workspace) | `config.example.toml` | config keys + `gate.py` + middleware; defaults match | **Confirmed by code** | `[static]` `[runtime]` |
| Evidence survives raw purge (R1) | spec §1.5, M2 exit ② | `test_m2_exit.py:214/289` passes here | **Confirmed by test** | The hardest reject-condition is genuinely gated |
| "Rules are data, not code" (no built-in detections) | stage-5 spec | `tests/tripwire/test_no_detection_constants.py` + pack in `configs/rule_pack.json` | **Confirmed by test** | |
| Cold-start never fabricates a pass | stage-5 §4.8 | `runner.py:_cold_start_codes`, run status `completed_with_warnings` (observed live) | **Confirmed** `[test]` `[runtime]` | |
| Multi-tenant RLS from day one | stage-1 D-001 | `schema.sql` 32 policies, `test_rls.py`, cross-tenant e2e | **Confirmed** | |
| No ML / no blocking / no live monitoring | stage-1 non-goals | no ML stack, no response code, no agent code | **Confirmed by code** | The docs under-claim relative to reality here — safe to repeat |
| Timeline p95 < 2 s @ 10⁵ events (PROPOSED) | spec §6.6 / M2 exit ③ | `bench/timeline_m2.json`: p95 1413 ms, local Windows run | **Measured locally, labelled PROPOSED in spec** | Quote as a local measurement with environment pins, not a published benchmark |
| UNSW-NB15 zero-drop + scored run | spec §6.3a / M2 exit ⑥ | `bench/unsw_nb15_scoring.json` (regenerated today), 40 tests pass | **Confirmed** | Also note test-split FPR 0.223 — report numbers honestly |

---

## L. Implemented-versus-planned capability matrix

### A. Implemented and verified (tests + runtime)
Upload gate (size/rate/quota/idempotency) · content-addressed storage with 3 hashes · EVTX parsing (Sysmon/
Security/System/PowerShell) · canonical-event/v1 normalization with value-state model · PostgreSQL job
platform (SKIP LOCKED, heartbeats, reaper, dead-letter, retry API) · Sigma detection on SQL and native paths
with identical-fingerprint conformance · per-rule run accounting with reason codes · findings + immutable
evidence snapshots (survive purge) · multi-tenant RLS · audit log · health/readiness/metrics · signed IOC
pack verification + matching (in-tree) · operator console wiring for every route it exposes ·
UNSW-NB15 mapping + scoring harness with published-per-run numbers.
*Presentation-safe wording:* "upload → normalized event store → rule evaluation → findings with immutable
evidence, end-to-end verified by 582 passing tests including a planted detection with golden values."

### B. Implemented but not fully verified
Timeline budget (measured once locally, p95 1413 ms @ 10⁵ events) · Windows service packaging scripts
(`packaging/*.ps1`, WinSW XMLs — written, never executed in evidence found) · Prometheus metrics (exposed;
no dashboard/alerting) · IOC packs via API (integration-tested, but no trusted key is configured, so the
product path always rejects in the shipped state) · cursor pagination on events.

### C. Partially implemented
Rule import API (exists; trust/validation depth beyond schema+lint untested at scale) · artifact triage
(extractors written, not wired, not tested — treat as a spike) · retention/legal-hold (schema + config only)
· OpenAPI declares routes the server does not route (`GET /v1/workspaces`, workspace creation).

### D. Prototype / demonstration
Landing-page pipeline animation (decorative) · `kind: correlation/statistical/fim/sca/artifact` rules
(schema-valid; cold-start/unsupported accounting works; execution does not exist) · the 6-rule UNSW scoring
pack (research artifact demonstrating the harness, not a product detection set).

### E. Planned or described only (spec/docs, no code)
Statistical window engine (median-MAD/EWMA baselines) · correlation windows via `date_bin` · FIM baselines ·
SCA (explicitly deferred from M3, M3-A4) · artifact fact-to-finding rules · S3 backend · OIDC/password auth ·
presigned evidence downloads · cx_Freeze frozen build + Inno installer · OTel export · host inventory.

### F. Not found in the inspected repository
Any ML model/training/inference · live endpoint or network collection · packet capture or pcap analysis ·
blocking/remediation · customer/deployment/market artifacts of any kind.

---

## M. Technical contribution

**Built by the project (original engineering, evidenced):**

1. **Dual-path Sigma engine.** A Sigma→PostgreSQL compiler (`compile.py`, ~640 lines) with a cost classifier
   that decides SQL vs native per rule, plus a native evaluator (`evaluate.py`, ~430 lines) with RE2 +
   Aho–Corasick, and a **conformance oracle** (`tools/conformance_oracle.py`, `tests/integration/
   test_conformance_oracle.py`) that compiles every corpus rule twice and requires byte-identical finding
   sets. This is the clearest original contribution: making "SQL fast path" and "fallback path" provably
   agree, with divergence only through registered reason codes.
2. **Canonical-event/v1 normalization** with a disciplined unknown-value model (`unknown ≠ pass`), lossless
   `raw` retention, `unmapped[]` accounting, and 121 schema-validated committed fixtures driven from the
   spec by an extractor gate (`tools/extract_examples.py --check`).
3. **Evidence-by-construction:** self-contained snapshots with document digests and config hashes, gated by
   a mandatory purge-survival drill.
4. **Honest-run accounting:** cold-start/skip/partial semantics with machine-readable reason codes so a
   silent zero-finding run is structurally impossible.
5. **Platform engineering on plain PostgreSQL:** RLS-per-transaction multi-tenancy, SKIP LOCKED queue with
   leases/heartbeats/reaper, partitioned tables, idempotency keys — all contract-tested.
6. **Detection-quality methodology:** the UNSW-NB15 harness with a ground-truth-isolation test (rules may
   not reference labels), zero-drop parsing, and frozen-threshold regression gates.
7. **Process discipline (itself unusual):** machine-normative contracts, a 17k-line spec with per-milestone
   exit gates enforced by tests that fail if a gate is deleted, a deviation register, and an adversarial
   self-review log.

**Provided by third parties (do not claim as original):** EVTX parsing (omerbenamram/evtx crate),
SigmaHQ detection content (DRL-1.1, attributed), PostgreSQL 18 (partitioning, RLS, SKIP LOCKED), FastAPI/
uvicorn/psycopg, React/Vite, UNSW-NB15 dataset (academic-use, external), the Sigma rule format itself.

**Originality statement:** no novel algorithm, model or industry-first claim is supported or made. The
demonstrable contribution is systems engineering: a disciplined, contract-first implementation of a
Sigma-compatible detection backend with provable dual-path equivalence, evidence integrity, and honest
accountability — plus the measurement harness around it.

---

## N. Seven-slide presentation evidence brief (AEGIS)

### Slide 1 — Product and value proposition
**Safe to present:** "AEGIS (codename Sentinel) is a Windows-first host-security analytics backend. Upload a
Windows event-log export; it converts every record into a standard, versioned event format and evaluates
113 Sigma-format detection rules against them, producing investigator-ready findings with immutable
evidence." `[code][test][runtime]` Current scope: offline file analysis of EVTX; single-node; API + worker +
web console. Vision (label as vision): artifact triage, statistical/correlation rules, hosted service.
**Do not say:** real-time monitoring, agent, AI-powered, blocks attacks.

### Slide 2 — Problem and use case
**Safe:** analysts drown in raw logs; the product's job is triage — one searchable event store plus flagged
findings with evidence attached. Supported situations today: suspicious process command lines (planted
whoami detection proven end-to-end `[test]`), masquerading Sysinternals binaries, cross-user spawns
(`[runtime]` findings observed). **Not supported today:** brute-force correlation, FIM, live response.
No customer interviews or demand evidence exist anywhere in the repository — do not imply any.

### Slide 3 — Opportunity and differentiation
**Safe:** initial segment = small security teams / MSSPs / incident responders handling Windows estates
without an enterprise SIEM budget — an `[inference]` positioning, not validated demand. Differentiators
with evidence: (1) dual-path engine with a conformance oracle proving path equivalence; (2) evidence that
survives artifact purge (tested drill); (3) "never fabricate a pass" accounting; (4) multi-tenant RLS from
day one; (5) detection quality measured on a labelled public dataset, not asserted. **Requires more
research before claiming:** any competitor comparison, market size, pricing.

### Slide 4 — How the product works
Use the §E diagram. Upload → gate/hash/CAS → queued ingest job → EVTX parse → canonical events (RLS,
partitioned) → queued detect job → per-rule SQL-or-native evaluation (+ signed IOC pack matching) →
findings + evidence snapshots → console. Dashed/absent boxes: agents, live feeds, correlation/statistical
engines, retention executor.

### Slide 5 — Implementation and technical evidence
**Safe (all executed here):** 582 tests passing across contract/unit/tripwire/integration/e2e/scoring
(+1 failing time-dependent IOC test — fix or disclose); planted-detection e2e with golden fingerprint;
evidence-after-purge drill; conformance oracle on 23 pinned SigmaHQ rules; UNSW-NB15 scoring: test split
F1 0.886, precision 0.838, recall 0.939 (FPR 0.223 on Normal — present as a research-pack metric);
timeline p95 1413 ms @ 100k events (local measurement, environment pinned); stack: Python 3.14/FastAPI/
psycopg/PostgreSQL 18/React 19. **Label as code-inspection-only:** packaging scripts, metrics exposure.
**Do not claim:** production deployment, load-tested capacity, FPR for the shipping 113-rule pack.

### Slide 6 — Next 30 days (all future plans)
1. **Land and harden the M3 IOC branch** — objective: signed packs usable end-to-end. Work: commit the
   tree, provision a trust key, fix the time-dependent contract test (freeze the clock). Acceptance: a
   signed pack imports → `active` → IOC rule fires on a planted indicator through the API+UI.
2. **Close the ingest failure surface** — write `failed` triage states on job failure; acceptance: a corrupt
   upload shows `failed` in UI, with the dead-lettered job linked.
3. **Wire or shelve artifact triage** — either connect `extract_for` to a triage job with tests (one planted
   PDF/OOXML finding) or move it out of the tree.
4. **Measure the shipping pack on UNSW-NB15 / report FPR honestly** — objective: a defensible quality
   statement for the real 113-rule pack, not the research pack.
5. **Commit + CI green on Windows** — objective: reproducible repo (currently everything is uncommitted).
   Acceptance: fresh clone → `pytest` + `npm run build` green.

### Slide 7 — References and disclosure
**Technical references:** `research/SENTINEL_IMPLEMENTATION_SPEC.md` (design), `research/M2_EXIT_AUDIT.md`
(milestone evidence), `research/DEVIATION_REGISTER.md` (documented deviations), `tests/planted/manifest.json`
(planted-detection provenance), `bench/unsw_nb15_scoring.json` (scoring run), SigmaHQ rules under
`tests/conformance/` + `ATTRIBUTION.md` (DRL-1.1), UNSW-NB15 citation (Moustafa & Slay, MilCIS 2015 —
academic use only), `openapi.yaml`/`schema.sql`/`rule_schema.json` (contracts). **Research references are
not implementation evidence** — the milestone gates are.
**AI-use disclosure (recommended, honest):** "AI coding assistants were used to accelerate implementation and
this audit; all claims in this presentation were verified against the repository source, its committed test
suites, and live runs of the system." Adjust only if the team's actual usage differs.

---

## O. Unresolved questions (not answerable from the repository)

1. Why `schema_lint.py` does not complete on this Windows machine (client fallback vs port remap) — needs a
   local run with verbose subprocess output, or a CI log.
2. Whether the WinSW service installation (`packaging/install.ps1`) has ever been exercised on a clean
   Windows VM — the M1 exit criterion has no committed evidence artifact.
3. Whether CI secret-gated corpus fetch has ever run with real credentials (workflow defines it; no local evidence).
4. The team's actual AI-use policy (needed only to word Slide 7 correctly).
5. Whether the M3 IOC branch is considered "done" by the developer or mid-flight (the working tree suggests
   mid-flight: empty trust store, uncommitted files).
6. Intended commercial licensing path given UNSW-NB15's academic-only terms (affects any hosted/commercial
   claim built on those numbers).
7. Whether a production deployment target exists at all (nothing in the repo suggests one).

---

## P. Final audit checklist

- ✅ Major source directories and relevant files inspected (`apps/`, all five `packages/`, `web/src`, `tests/`,
  `tools/`, `configs/`, `migrations/`, `packaging/`, `research/`, root contracts). Not inspected in depth:
  individual Sigma rule YAMLs inside `configs/rule_pack.json`, most of the 17k-line spec beyond the milestone
  and decision sections, `tests/conformance/rules/*` contents, and `packaging/*.ps1` internals (headers read only).
- ✅ Significant features traced through implementation (upload→ingest→detect→finding→evidence→UI, rule
  import, IOC import, jobs retry, triage, audit, health).
- ✅ Technology claims backed by `pip list`, lockfile resolution, and import-site greps; unused declared
  dependencies identified (argon2, OTel, python-json-logger).
- ✅ Detection and processing claims matched to code; absent engines named explicitly.
- ✅ Frontend/backend integration examined page-by-page; mocked data search performed (none in console).
- ✅ Runtime claims supported by executed tests (582 passed) and live API/worker runs.
- ✅ Planned functionality separated from completed functionality (§L groups A–F).
- ✅ Security/monitoring claims technically accurate; no ML, no blocking, no live monitoring anywhere.
- ✅ Documentation conflicts recorded (§K), including the now-stale docx claims about IOC and rule import.
- ✅ Secrets excluded: dev API keys are shown only as they already exist in the committed config file; no
  DSN passwords, tokens or secret env values are reproduced beyond the already-committed dev defaults.
- ✅ Seven-slide brief based on actual evidence with explicit "do not say" lists.
- ✅ Uninspected areas and unresolved questions disclosed (§O and above).
