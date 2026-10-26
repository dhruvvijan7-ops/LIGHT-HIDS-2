# SENTINEL — Results and Evidence Ledger

**Status:** Evidence audit for poster preparation  
**Audit date:** 2026-10-23  
**Repository:** `C:\Users\dhruv\OneDrive\Desktop\College\Light HIDS`  
**Primary secondary source:** `SENTINEL_IMPLEMENTATION_AUDIT.md` (dated 2026-10-22)  
**Rule for this document:** every number below is either (a) measured in this repository, (b) copied from a committed artifact with its path, or (c) explicitly marked as secondary/unverified. Nothing is rounded up into a stronger claim.

---

## 1. What Sentinel is

Sentinel is a **Windows-first, lightweight host intrusion detection system (HIDS) backend** built around an evidence-preserving pipeline:

1. A Windows EVTX export is uploaded.
2. The raw artifact is hashed and stored in a content-addressed store (CAS).
3. EVTX records are parsed into canonical JSON events in PostgreSQL.
4. Pinned Sigma-style process-creation rules are evaluated against those events.
5. Findings are emitted with an immutable evidence snapshot containing the finding, rule provenance, run identity, and event digests.
6. A React console exposes uploads, events, findings/evidence, rules, runs, jobs, IOC packs, audit, and system status.

**What it is not:** a live endpoint agent, an inline prevention system, a malware sandbox, a distributed SIEM, or a production-hardened service. It is a single-node, evidence-first detection backend with an explicitly bounded M2 vertical slice.

**Name note:** the repository and documents consistently use **Sentinel**. `AEGIS` appears only in `SENTINEL_IMPLEMENTATION_AUDIT.md`; no official expansion or renaming decision was found. Do not put “AEGIS” on the poster unless the author confirms it.

---

## 2. Claim ledger

Legend: **VERIFIED** = measured or directly read from committed code/artifact; **SECONDARY** = asserted by an audit/report but not independently reproduced; **STALE** = contradicted by current code or time; **NOT CLAIMABLE** = no evidence.

| # | Claim | Status | Evidence / correction |
|---|---|---|---|
| C1 | Sentinel ingests Windows EVTX and produces canonical events and findings | VERIFIED | `packages/ingest/sentinel_ingest/worker_handlers.py`, `evtx_parser.py`; demo run `01a163f0-9c12-7472-bacb-bb1f8f528703` |
| C2 | Raw bytes are stored in a SHA-256 CAS | VERIFIED | `worker_handlers.py` (`raw_objects`), `schema.sql`; demo run reused existing objects |
| C3 | Findings carry an evidence snapshot with rule and event digests | VERIFIED | `packages/detect/sentinel_detect/evidence.py:build_snapshot`; schema `findings.evidence_snapshot` |
| C4 | Evidence survives raw-object purge | VERIFIED | `tests/.../test_evidence_survives_purge` passed; snapshot contains digests/pointers, not raw bytes |
| C5 | Pinned shipping pack has 112 SigmaHQ process-creation rules | VERIFIED | `configs/rule_pack.json`: `count: 112`; SHA-256 `3e2853f455915af9520d899c84bbaa34b963865f97807c3e104318484d92f9eb`; SigmaHQ commit `8a4813404ea3074890e0cda9272d4d1a8b2941d6` |
| C6 | Demo workspace evaluates 113 rules | VERIFIED | `ws-b` = 112; `default` = 113 because one local demo rule (`Demo - Suspicious Whoami Execution`) was imported; run `01a163f0...` evaluated 113 |
| C7 | M2 passed all six exit criteria | VERIFIED (secondary audit + test evidence) | `research/M2_EXIT_AUDIT.md`; six gates marked PASS; suite then: 539 passed, 3 deselected, 1 warning, 205.8 s |
| C8 | 23-rule conformance corpus has 0 unexplained divergences | VERIFIED | `tests/conformance/expected.json`, `ATTRIBUTION.md`, `DEVIATION_REGISTER.md`; 23 total = 20 SigmaHQ + 3 Sentinel-authored; 19 comparable; 4 native-only |
| C9 | 100k-event / 1k-finding timeline query meets 2 s p95 budget | VERIFIED (local only) | `research/work/_stage6_work/bench/timeline_m2.json`: p95 1,413.024 ms; p50 1,352.267 ms; max 1,413.024 ms; 5 samples; 101,000 rows |
| C10 | UNSW-NB15 test split F1 ≈ 0.886 with a 6-rule research pack | VERIFIED | Independent CLI reproduction to `%TEMP%\sentinel_unsw_verify.json`; exact values in §5; **not** the 112-rule shipping pack |
| C11 | Current no-DB suite is green | **STALE / FALSE** | 2026-10-23: **1 failed, 359 passed, 1 warning in 9.79 s**. Failure is date-sensitive, not a detection regression |
| C12 | Current full audit is 582 passed, 1 failed | SECONDARY | 2026-10-22 audit; integration/e2e = 183 passed, 3 deselected; scoring = 40 passed |
| C13 | README's “379 tests” is current | **STALE** | README counts predate M3; do not repeat |
| C14 | 32 RLS policies across 21 tables + 11 partitions | **STALE** | Current DDL/test: **21 base tables + 12 partition children; 33 policies** (`FROZEN_POLICY_COUNT = 33`). `schema.sql` comment and M0-A1 still say 32/11 |
| C15 | OpenAPI has 23 paths / 36 operations | VERIFIED | `openapi.yaml` |
| C16 | `GET /v1/workspaces` works | **FALSE** | Declared in spec but not routed; `/v1/workspaces/{workspace_id}` is not the collection endpoint |
| C17 | All list endpoints provide real cursor pagination | **FALSE** | Real `next` cursor exists for events (`routes_uploads.py:366`); others return `"next": null` |
| C18 | Frontend has automated UI tests | **FALSE** | No Playwright/Cypress/Selenium test setup found |
| C19 | Upload status records `failed` / `rejected_by_policy` transitions | **FALSE / GAP** | `uploads.triage_status` allows both, but code never writes them; rejected uploads are deleted (204), other failures remain `received` |
| C20 | Only EVTX is parsed | VERIFIED | `worker_handlers.py` calls `iter_envelopes()` unconditionally; non-EVTX types rejected as parse errors |
| C21 | Landing page advertises JSON/CSV/XML/log ingestion | **MISLEADING** | `Landing.tsx` format chips imply support; only EVTX is implemented |
| C22 | The XLSX test cases are executed evidence | **NOT CLAIMABLE** | Workbook says “illustrative Pass/Fail values are not live execution evidence”; “Not independently executed”; expanded by “OpenAI” |
| C23 | The DOCX report is current | **STALE** | Dated 2026-10-13; predates M3; contains old counts and roadmap phrasing; do not copy blindly |
| C24 | `schema_lint.py` passes on this Windows environment | **UNRESOLVED** | Audit question O.1 says script does not complete; not re-run here |
| C25 | API requires production-grade auth/TLS | **FALSE** | Static API keys compared with `hmac.compare_digest`; unsalted SHA-256 for the principals bootstrap; argon2 unused; no TLS; in-process limiter; no key rotation or expiry. Authentication itself is mandatory (`auth.py` raises when the key is missing) |
| C26 | Audit log is cryptographically immutable | **OVERSTATED** | No DB trigger found preventing owner/superuser UPDATE/DELETE; append-only behavior is application-level convention. Evidence snapshots are frozen by application code, not by a DB constraint |
| C27 | Findings are deduplicated globally | **FALSE** | Fingerprint excludes run ID but unique index includes `time_utc`; suppression is run-scoped; duplicate runs can emit duplicate findings |
| C28 | Detection is real-time / streaming | **FALSE** | Upload-triggered batch detection; no live agent or streaming ingestion |

---

## 3. Current test status (2026-10-23)

### 3.1 No-DB subset — executed

Command:

```powershell
.venv\Scripts\python.exe -m pytest tests/contract tests/unit tests/tripwire -p no:cacheprovider -m "not slow" --tb=no --disable-warnings
```

Result:

```text
1 failed, 359 passed, 1 warning in 9.79s
```

Failure:

```text
tests/contract/test_ioc_engine.py::test_fresh_pack_resolves_clean
line 255: ASSERT codes == []
actual: ['IOC_PACK_STALE']
```

Cause: the fixture uses a fixed `NOW`, while the IOC pack was imported on 2026-10-13. On 2026-10-23 the pack is older than the 7-day freshness threshold, so the code correctly appends `IOC_PACK_STALE`. The audit says “line 36”; the actual assertion is at **line 255**. This is a time-dependent test defect, not evidence that the detector is broken.

### 3.2 Scoring pack/mapping — executed

```powershell
.venv\Scripts\python.exe -m pytest tests/scoring/test_unsw_nb15_pack.py tests/scoring/test_unsw_nb15_mapping.py -p no:cacheprovider --tb=no
```

Result: **29 passed**.

### 3.3 Audit snapshot — secondary, not re-run

`SENTINEL_IMPLEMENTATION_AUDIT.md` (2026-10-22):

- Full suite: **582 passed, 1 failed, 3 deselected**.
- Integration/e2e: **183 passed, 3 deselected**.
- Scoring: **40 passed**.
- No-DB subset in that audit: 359 passed, 1 failed (same IOC failure).

The historical M2 exit audit recorded **539 passed, 3 deselected, 1 warning in 205.8 s**. The difference is M3 tests added after M2. Both statements can be true; label the date and scope.

### 3.4 Important test-execution hazards

- `pyproject.toml` already sets `addopts = "-q"`. Adding `-q` yields `-qq`, which suppresses summary counts.
- The scoring fixture always rewrites `research/work/_stage6_work/bench/unsw_nb15_scoring.json`. Do not run the full scoring test unless regenerating that committed artifact is intended.
- Integration/e2e tests write to the database and can leave test data. Use the audit’s recorded results unless a fresh DB run is explicitly required.
- `tests/contract/test_ioc_engine.py` is currently red because of wall-clock drift; do not present the suite as fully green.

---

## 4. Conformance evidence

Committed conformance artifacts:

- `tests/conformance/expected.json`
- `tests/conformance/ATTRIBUTION.md`
- `research/DEVIATION_REGISTER.md`

Measured composition:

| Item | Value |
|---|---:|
| Total conformance rules | 23 |
| Pinned SigmaHQ rules | 20 |
| Sentinel-authored rules | 3 |
| Rules comparable across SQL/native | 19 |
| Native-only rules | 4 |
| Unexplained divergences | 0 |

Native-only reasons:

- `REGEX_NATIVE_ONLY` (1)
- `FIELDREF_NATIVE_ONLY` (2)
- `KEYWORD_NATIVE_ONLY` (1)

The M2 oracle is designed so that both detection paths must produce byte-identical finding fingerprints for comparable rules. Four rules are explicitly native-only and are reported with reason codes rather than silently skipped.

**Caveat:** “0 divergences” means 0 *unexplained* divergences in the committed corpus. It does not mean the engine is equivalent to Sigma for arbitrary rules or arbitrary Windows telemetry.

---

## 5. UNSW-NB15 results (research scoring pack)

### 5.1 Provenance and scope

- Dataset: UNSW-NB15, academic-use-only; commercial use prohibited.
- Committed artifact: `research/work/_stage6_work/bench/unsw_nb15_scoring.json`.
- Pack used: **6-rule research scoring pack**, not the 112-rule shipping pack.
- Reproduction: independent CLI run to `%TEMP%\sentinel_unsw_verify.json`; reproduced the committed numbers exactly.
- Rows: 175,341 train + 82,332 test = **257,673**; zero dropped, zero invalid.

### 5.2 Exact metrics

| Split | Rows | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Train | 175,341 | 105,631 | 5,128 | 13,710 | 50,872 | 0.953701 | 0.885119 | 0.918131 | 0.091571 |
| Test | 82,332 | 42,586 | 8,234 | 2,746 | 28,766 | 0.837977 | 0.939425 | 0.885806 | 0.222541 |

### 5.3 Test per-category recall

| Category | Recall |
|---|---:|
| Analysis | 0.989660 |
| Backdoor | 0.929674 |
| DoS | 0.916361 |
| Exploits | 0.937567 |
| Fuzzers | 0.763609 |
| Generic | 0.996132 |
| Reconnaissance | 0.959954 |
| Shellcode | 0.960317 |
| Worms | 1.000000 |

### 5.4 How to present this honestly

Use:

> “On the UNSW-NB15 test split, a six-rule research scoring pack achieved precision 0.838, recall 0.939, F1 0.886, and FPR 0.223. This is a portability study, not the performance of the 112-rule shipping pack.”

Do **not** say:

- “Sentinel detects 88.6% of attacks” (overgeneralization).
- “Sentinel achieves 0.954 precision in production” (train split, research pack).
- “The 112-rule pack was evaluated on UNSW-NB15” (false).
- “UNSW-NB15 is a Windows host dataset” (false; it is network intrusion data).

---

## 6. Performance evidence

Source: `research/work/_stage6_work/bench/timeline_m2.json`.

| Metric | Value |
|---|---:|
| Workload | 100,000 events + 1,000 findings (101,000 rows) |
| Measured samples | 5 |
| p50 | 1,352.267 ms |
| p95 | 1,413.024 ms |
| max | 1,413.024 ms |
| Budget | 2,000 ms |
| Gate | PASS |

This is a **local single-node timeline query benchmark**, not end-to-end ingest throughput, not detection throughput, and not a production capacity claim. Do not convert it into “events per second” for the poster.

Possible honest headline: “Timeline query p95: 1.41 s for 101k rows (2 s budget).”

---

## 7. End-to-end demo evidence

Latest read-only database query found this run:

```text
run_id: 01a163f0-9c12-7472-bacb-bb1f8f528703
workspace: default
status: completed_with_warnings
events: 33
findings: 2
rules_total: 113
rule_outcomes: ok 96, ok_partial 17
detection_paths: sql 99, native 14
reason codes: COST_BUDGET_EXCEEDED, FIELDREF_NATIVE_ONLY,
              REGEX_NATIVE_ONLY, UNMAPPED_FIELD
```

Findings:

| Rule | Severity | Path | Host | User |
|---|---|---|---|---|
| WhoAmI as Parameter | HIGH | sql | DESKTOP-2KGM189 | SYSTEM |
| Demo - Suspicious Whoami Execution | MEDIUM | sql | DESKTOP-2KGM189 | SYSTEM |

Fixture provenance: Sysmon EVTX corpus attributed by the repository to `OTRF/Security-Datasets`, host `DESKTOP-2KGM189`, event time 2017-12-26 (UTC). `payload_excerpt` for both findings is `payload.image: "C:\\Windows\\system32\\whoami.exe"`.

Planted corpus summary (`tests/planted/manifest.json`):

- 41 records -> 33 canonical events, 8 unmapped (no `@timestamp` / `EventID`), 0 parse errors.
- 2 planted findings expected: `T1059` HIGH and `T1033` MEDIUM.
- 0 clean-control findings from 25 benign startup records.
- Evidence purge drill passed.

Warnings are explainable: 17 partial outcomes are rules with fields that are not mapped into the canonical event schema; `COST_BUDGET_EXCEEDED` is emitted when the compiled SQL exceeds the byte budget and execution falls back to the native path. Warnings are visible, not hidden.

**Do not** present the read-only database’s raw totals as headline metrics. The DB is test-polluted: 225 rules, 317 uploads, 108,484 events, 662 findings, 178 detection runs, 390,320 succeeded jobs, 137 dead jobs, 23 failed jobs. Those are operational snapshots, not evaluation results.

---

## 8. Detection pack and provenance

`configs/rule_pack.json`:

| Field | Value |
|---|---|
| `pack_id` | `sigmahq-windows-process-creation` |
| `count` | 112 |
| `pack_sha256` | `3e2853f455915af9520d899c84bbaa34b963865f97807c3e104318484d92f9eb` |
| `sigma_spec` | `2.1.0` |
| SigmaHQ commit | `8a4813404ea3074890e0cda9272d4d1a8b2941d6` |
| Rule kind(s) | process creation / process access |
| Extra demo rule | `Demo - Suspicious Whoami Execution`, `source_ref: raw_text[1]` |

The pack is pinned by commit and SHA-256, so a rule change is visible rather than silent. The default demo workspace contains **113 enabled rules** because it also holds the local demo rule. If the poster says “112 rules,” say “112-rule pinned pack”; if it says “113 rules,” say “113 rules evaluated in the demo workspace.”

---

## 9. Architecture and platform evidence

| Component | Verified implementation |
|---|---|
| API | FastAPI 0.143.0, Uvicorn 0.54.0, Pydantic 2.14.0 |
| Worker | Python worker handlers; persistent job queue in PostgreSQL; heartbeats/leases in `succeeded_jobs` |
| Database | PostgreSQL 18.6; multi-tenant RLS; 21 base tables + 12 partition children; 33 policies |
| Storage | Local CAS keyed by SHA-256 (`raw_objects`) |
| Detection | Python 3.14.3; SQL compilation + native evaluator; `google-re2`, `pyahocorasick` |
| Frontend | React 19 + Vite + TypeScript + Tailwind; 15 console child routes plus landing/login/logout/forgot-password/not-found |
| Testing | pytest 9.1.1, Hypothesis 6.168.5, httpx 0.28.1 |
| Auth | Static API keys, SHA-256 hash map; argon2 dependency present but unused |
| API surface | 23 paths / 36 operations in `openapi.yaml` |
| Config | 41 frozen keys in `configs/config_keys.json` |

Schema honesty note: `schema.sql` comments and `research/DEVIATION_REGISTER.md` M0-A1 say “32 policies / 11 partition children”, but current DDL and `tests/contract/test_rls_lint.py` say **33 policies / 12 partition children**. Use 33/12, or avoid the exact count, and flag the doc drift.

---

## 10. Security and accountability claims

Supported:

- Every tenant-scoped base table and partition child has RLS enabled and a policy; a contract test enforces this (`tests/contract/test_rls_lint.py`).
- `raw_objects` is a shared CAS with a documented pass-through policy (`raw_objects_cas`) because it has no tenant column; tenant scoping for raw objects is enforced through the `uploads` join in application code.
- Raw artifacts are hashed; canonical events and findings are linked to digests.
- Audit events are recorded for uploads, rule imports, and other privileged actions.
- API keys are hashed at rest in memory; the raw key is not stored.
- Upload size/type limits and a per-principal rate limiter exist.

Not supported:

- “Production-grade authentication.” The key map is in memory and unsalted SHA-256; argon2 is unused. If no API key is supplied, the principal is `None` (dev mode), so auth is not a hard gate.
- “TLS by default.” No TLS termination is configured in the app.
- “Tamper-proof audit log.” No DB trigger prevents owner/superuser UPDATE/DELETE. Treat the audit log as append-only by application convention.
- “Distributed rate limiting.” The limiter is in-process.
- “Worker is least-privilege.” The worker DB role has `BYPASSRLS`; RLS protects API queries, not the worker by itself.
- “Global deduplication.” The fingerprint excludes `run_id`, but the unique index includes `time_utc`; suppression is run-scoped.

---

## 11. Documentation drift and stale sources

| Source | Problem | Correct treatment |
|---|---|---|
| `README.md` | Says 379 tests / 256 no-DB / 121 DB; stale after M2/M3 | Do not quote; use dated suite numbers |
| `SENTINEL_IMPLEMENTATION_AUDIT.md` | IOC failure cited at line 36; actual line 255 | Cite line 255 |
| `SENTINEL_IMPLEMENTATION_AUDIT.md` | Says 32 RLS policies / 11 partitions; copied from stale schema comment | Current DDL/test: 33/12 |
| `Sentinel_Project_Report.docx` | Dated 2026-10-13; predates M3; old counts/status | Secondary background only |
| `Sentinel Test Cases Assignment.xlsx` | Illustrative Pass/Fail values, not executed | Do not use as evidence |
| `test-cases-sentinel.xlsx` | Generic template | Do not use as evidence |
| `web/src/pages/Landing.tsx` | Format chips imply JSON/CSV/XML/log support | Only EVTX is implemented |
| `routes_uploads.py` | Triage statuses `failed`/`rejected_by_policy` never written | Disclose as gap |
| `routes_*.py` list endpoints | `next` is `null` except events | Disclose as gap |
| OpenAPI vs app | `GET /v1/workspaces` declared, not routed | Disclose as gap |
| `DEVIATION_REGISTER.md` | Uses “113 rules” for the pinned pack in places | Say 112 pinned + 1 demo |
| `schema.sql` header | Says 32 policies / 11 partitions | Actual 33/12 |

---

## 12. Claims safe for the poster

Use these, with the stated qualifiers:

1. “End-to-end EVTX -> canonical event -> finding pipeline with SHA-256 artifact storage and frozen evidence snapshots.”
2. “A pinned 112-rule SigmaHQ process-creation pack, evaluated as 113 rules in the demo workspace.”
3. “A 23-rule conformance corpus with 19 cross-path comparisons and 0 unexplained divergences.”
4. “Six M2 exit gates passed; the M2 audit recorded 539 passing tests.”
5. “Timeline query p95 1.41 s for 101k rows against a 2 s local budget.”
6. “UNSW-NB15 test split, six-rule research pack: P 0.838, R 0.939, F1 0.886, FPR 0.223.”
7. “Multi-tenant PostgreSQL RLS with 33 policies across 21 base tables and 12 partition children.”
8. “OpenAPI surface of 23 paths / 36 operations.”
9. “A demo run produced 2 findings from 33 canonical events, with warnings and reason codes exposed.”
10. “Documented limits: EVTX only, batch upload, static-key auth, no TLS, in-process limiter, run-scoped dedup.”

## 13. Claims that must not appear on the poster

- “Real-time HIDS” or “streaming detection.”
- “Production-ready,” “enterprise-grade,” or “hardened.”
- “Detects 88.6% of attacks” without dataset/pack qualifiers.
- “112-rule pack scored 0.886 F1 on UNSW-NB15.”
- “All tests pass” (one date-sensitive test fails).
- “32 RLS policies / 11 partitions.”
- “Full Sigma support” or “Sigma-compatible for arbitrary rules.”
- “Multi-format ingestion.”
- “Tamper-proof audit log.”
- “Automated UI test coverage.”
- Any author, institution, supervisor, or affiliation not confirmed by the author.
- Any screenshot labeled live without a capture date and run ID.

---

## 14. Reproduction commands

```powershell
# No-DB suite (does not touch PostgreSQL)
.venv\Scripts\python.exe -m pytest tests/contract tests/unit tests/tripwire `
  -p no:cacheprovider -m "not slow" --tb=no --disable-warnings

# Scoring pack/mapping only (does NOT run the artifact-rewriting scoring gate)
.venv\Scripts\python.exe -m pytest tests/scoring/test_unsw_nb15_pack.py `
  tests/scoring/test_unsw_nb15_mapping.py -p no:cacheprovider --tb=no

# Inspect the committed benchmark artifact
Get-Content research\work\_stage6_work\bench\timeline_m2.json

# Inspect the committed scoring artifact
Get-Content research\work\_stage6_work\bench\unsw_nb15_scoring.json
```

Do not run the full integration/e2e suite or the full scoring gate just to “check” results; both mutate state. Use the dated audit results and the committed artifacts.

---

## 15. Reference list for poster citations

1. SigmaHQ rule repository — https://github.com/SigmaHQ/sigma
2. Sigma specification — https://github.com/SigmaHQ/sigma-specification
3. Moustafa, N., & Slay, J. (2015). UNSW-NB15: a comprehensive data set for network intrusion detection systems. *Military Communications and Information Systems Conference (MilCIS)*.
4. PostgreSQL Global Development Group. Row Security Policies — https://www.postgresql.org/docs/current/ddl-rowsecurity.html
5. PostgreSQL Global Development Group. Table Partitioning — https://www.postgresql.org/docs/current/ddl-partitioning.html
6. MITRE ATT&CK — https://attack.mitre.org/
7. NIST SP 800-92, *Guide to Computer Security Log Management* — https://csrc.nist.gov/pubs/sp/800/92/final
8. FastAPI documentation — https://fastapi.tiangolo.com/
9. React documentation — https://react.dev/
10. OTRF Security-Datasets — https://github.com/OTRF/Security-Datasets

If a reference is not actually cited in the poster text, remove it. Do not add papers or standards that were not used.

---

## 16. Bottom line

The defensible poster story is **evidence-first lightweight detection with honest scope**, not “a faster SIEM” or “an AI detector.” The strongest verified results are the evidence model, the pinned rule pack, the conformance oracle, the six M2 gates, the timeline query, and the independently reproduced UNSW portability study. The weakest areas are production security, UI automation, multi-format ingestion, and the current date-sensitive test failure. State both.
