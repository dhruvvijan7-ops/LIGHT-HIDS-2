# SENTINEL — Poster Content

**Status:** Copy-ready draft with explicit placeholders  
**Prepared:** 2026-10-23  
**Evidence base:** `docs/poster-research/SENTINEL_RESULTS_AND_EVIDENCE.md`  
**Do not invent:** author names, affiliation, supervisor, logo, QR target, poster size, or deployment claims.

---

## 1. Metadata to confirm before printing

| Field | Value |
|---|---|
| Project name | **Sentinel** (confirm; do not use “AEGIS” without author confirmation) |
| Subtitle | Windows-first, evidence-first lightweight HIDS |
| Author(s) | **[AUTHOR NAME(S) — TO CONFIRM]** |
| Affiliation | **[DEPARTMENT, INSTITUTION — TO CONFIRM]** |
| Supervisor / advisor | **[NAME — TO CONFIRM, OR REMOVE]** |
| Contact | **[EMAIL / GITHUB / QR — TO CONFIRM]** |
| Poster venue and date | **[VENUE, DATE — TO CONFIRM]** |
| Poster size | **[A0 PORTRAIT / A1 / OTHER — TO CONFIRM]** |
| Repository visibility | **[PUBLIC / PRIVATE / EMBARGOED — TO CONFIRM]** |
| AI-use disclosure | **[REQUIRED BY COURSE? — TO CONFIRM]** |

### Title options

1. **Sentinel: An Evidence-First Lightweight HIDS for Windows Telemetry**
2. **Sentinel: From EVTX to Verifiable Findings**
3. **Sentinel: Lightweight Windows Detection with Auditable Evidence**

Recommended: option 1. It names the artifact, the differentiator, and the scope without claiming production readiness.

---

## 2. Final poster text

The text below is written for a technical poster audience. Approximate word counts are given so the author can trim without losing claims.

### 2.1 Abstract — 150 words

> Windows hosts produce detailed process telemetry, but lightweight detection prototypes often sacrifice reproducibility: alerts point to logs that may be rotated, rules change silently, and evaluation setups are hard to reconstruct. Sentinel is an evidence-first host intrusion detection backend for Windows EVTX exports. It hashes raw artifacts into a content-addressed store, canonicalizes events into PostgreSQL, evaluates a pinned 112-rule SigmaHQ process-creation pack, and freezes each finding with rule provenance and event digests. Multi-tenant row-level security isolates workspaces, and a PostgreSQL-backed job queue makes ingestion and detection restartable. We evaluated the M2 slice against six exit gates. A 23-rule conformance corpus produced zero unexplained SQL/native divergences; a 101k-row timeline query met a 2 s budget at 1.41 s p95; and a six-rule research pack reached F1 0.886 on the UNSW-NB15 test split. A date-sensitive IOC test currently fails. Sentinel is deliberately scoped as a single-node, batch-upload system, not a production SIEM.

### 2.2 Problem — 120 words

> Windows process-creation logs are a high-value detection source: they capture command lines, parent-child relationships, users, and host context. Sigma-style rules make detections portable across tools, but a lightweight prototype still has to answer harder questions. Which exact rule version fired? Which raw artifact produced the event? Can the evidence be reconstructed after retention deletes the source log? Does a second detection path produce the same alert? Most student and startup prototypes stop at “the rule matched.” Sentinel treats the finding as a claim that must be defensible: the raw artifact is hashed, the rule is pinned, the event is canonicalized, and the evidence is frozen before the source is allowed to disappear.

### 2.3 Research questions — 70 words

> **RQ1:** Can a lightweight backend deliver an end-to-end EVTX-to-finding path without a live agent?  
> **RQ2:** Can findings remain auditable after raw artifacts and events are purged?  
> **RQ3:** Can SQL and native detection paths agree on comparable rules, and explain where they cannot?  
> **RQ4:** What latency and detection quality are achievable on a single node, and where are the limits?

### 2.4 Contributions — 5 bullets

> 1. **End-to-end slice:** EVTX upload -> SHA-256 CAS -> canonical events -> detection run -> finding -> evidence bundle.
> 2. **Pinned detection content:** 112 SigmaHQ process-creation rules, pinned by repository commit and pack SHA-256.
> 3. **Dual-path detection with an oracle:** SQL compilation for simple predicates, native RE2/Aho-Corasick evaluation for regex, keyword, and unsupported-field cases, plus machine-readable reason codes.
> 4. **Evidence that outlives logs:** frozen JSONB snapshots containing the finding, rule provenance, run identity, and per-event digests; verified by a purge drill.
> 5. **Explicit non-claims:** EVTX-only, batch-upload, single-node, static-key auth. The system documents what it does not do.

### 2.5 System overview — 150 words

> Sentinel separates the control plane from the data plane. A FastAPI service accepts uploads and serves read APIs. A Python worker leases jobs from PostgreSQL, parses EVTX, inserts canonical events, and starts a detection run. Both processes share a PostgreSQL 18.6 database and a local content-addressed store. The React/Vite console exposes overview, workspaces, uploads, events, findings/evidence, rules, runs, jobs, IOC packs, audit, and system status. Tenant and workspace context is propagated through PostgreSQL session GUCs and enforced by row-level security on every tenant-scoped base table and partition child. Detection is not inline: the worker evaluates a bounded event window and writes per-rule outcomes plus a terminal run status. A run can complete, complete with warnings, fail, or be cancelled; warnings are first-class data, not log noise.

**Figure callout:** `[FIGURE 1 — SYSTEM CONTEXT]`

### 2.6 How a finding is produced — 6 steps

> 1. **Upload:** the API enforces size/type limits, hashes the artifact, and writes it to the CAS.
> 2. **Canonicalize:** the worker parses EVTX records into `canonical-event/v1` JSON, preserving unmapped fields as explicit entries.
> 3. **Select rules:** enabled rules for the workspace are loaded from the pinned pack plus any local imports.
> 4. **Plan:** the compiler emits parameterized SQL for supported predicates or chooses the native path with a reason code.
> 5. **Evaluate:** matching events produce findings; the finding is fingerprinted and frozen into an evidence snapshot.
> 6. **Account:** per-rule outcomes, detection paths, warnings, and the terminal run status are written for audit.

**Figure callout:** `[FIGURE 2 — PIPELINE]`

### 2.7 Detection semantics — 180 words

> Rules are stored with their verbatim source text, source hash, and a normalized document. The shipping pack contains 112 SigmaHQ process-creation rules pinned at commit `8a48134…`; the pack SHA-256 is `3e2853f4…`. The default demo workspace evaluates **113** rules because it also contains one local demo rule. This distinction matters: the poster should say “112-rule pinned pack” or “113 rules in the demo workspace,” never “113-rule pack.”
>
> Simple predicates compile to parameterized SQL against canonical fields. Rules that use regex, large keyword sets, or fields absent from the canonical schema take the native path and carry reason codes such as `REGEX_NATIVE_ONLY`, `KEYWORD_NATIVE_ONLY`, `FIELDREF_NATIVE_ONLY`, `UNMAPPED_FIELD`, `BASELINE_MISSING`, and `COST_BUDGET_EXCEEDED`. Every rule has an outcome (`ok`, `ok_partial`, `rejected`, `skipped`, `error`), so a partial run is visible. In the demo run, 96 rules were `ok` and 17 were `ok_partial`; 99 rules used SQL and 14 used the native path. The run finished `completed_with_warnings` and produced two findings.

**Figure callout:** `[FIGURE 3 — DETECTION PATH]`

### 2.8 Evidence and multi-tenant isolation — 140 words

> A finding is not just a message. The stored evidence snapshot contains the full finding document, the rule identity and document hash, the source hash, the run ID and configuration hash, and one `(event_uid, sha256)` pair per contributing event. The raw artifact is stored separately by SHA-256. This separation is the key property: a retention job can purge raw bytes and even delete event rows, and the evidence bundle still returns a structurally complete snapshot. A drill verifies that purging the raw object and deleting the backing events does not change the snapshot.
>
> Multi-tenancy uses PostgreSQL row-level security. Current DDL has **21 base tables + 12 partition children**, protected by **33 policies**; `tests/contract/test_rls_lint.py` freezes those counts. `raw_objects` is a shared CAS with a documented pass-through policy because it has no tenant column; application code scopes it through the upload join.

**Figure callout:** `[FIGURE 4 — EVIDENCE MODEL]`

### 2.9 Evaluation method — 110 words

> Evaluation used four independent lenses. First, **six M2 exit gates** checked the planted EVTX -> finding path, post-purge evidence, timeline budget, cold-start warnings, conformance, and UNSW parsing. Second, a **23-rule conformance corpus** compared SQL and native paths on a golden event set. Third, a **local timeline benchmark** ran 100,000 events plus 1,000 findings. Fourth, a **six-rule research pack** was scored on the UNSW-NB15 train/test splits. All numbers are from this repository; the UNSW result is a portability study with a research pack, not the 112-rule shipping pack. No user study or production deployment was performed.

### 2.10 Results — table

| Evaluation | Result | Scope / qualifier |
|---|---:|---|
| M2 exit gates | **6 / 6 PASS** | Historical audit; suite then 539 passed |
| Conformance corpus | 23 rules, 19 comparable, **0 unexplained divergences** | Four rules native-only with reasons |
| Planted demo | 41 records -> **33 events**, 8 unmapped, 0 parse errors, 2 findings | Sysmon fixture, two expected findings |
| Timeline query | **p95 1.413 s** for 101,000 rows | Local; 2,000 ms budget; 5 samples |
| UNSW-NB15 test | **P 0.838 / R 0.939 / F1 0.886 / FPR 0.223** | Six-rule research pack; 82,332 rows |
| UNSW-NB15 train | P 0.954 / R 0.885 / F1 0.918 / FPR 0.092 | 175,341 rows; separate split |
| Current suite | **582 passed, 1 failed, 3 deselected** | 2026-10-22 audit; failure is date-sensitive |
| Current no-DB subset | **359 passed, 1 failed** | 2026-10-23; same IOC freshness test |

**Result bullets**

> - The evidence model survived raw-object purge and event deletion without changing the snapshot.
> - SQL and native paths agreed on all 19 comparable conformance rules; the four exclusions are explicit.
> - The timeline query met its local budget with ~29% headroom; this is not an ingest-throughput claim.
> - UNSW-NB15 recall is high (0.939) but false positives are non-trivial (FPR 0.223), especially for Fuzzers (recall 0.764).

### 2.11 Discussion — 200 words

> Sentinel’s strongest contribution is not raw detection accuracy; it is the combination of **provenance, reproducibility, and scope discipline**. The evidence snapshot and the dual-path oracle make detection behavior inspectable. The conformance corpus does not merely count true positives: it checks whether two independently implemented execution paths produce the same finding fingerprint, and it reports the four rules where native-only execution is the honest answer.
>
> The main limitations are architectural. Sentinel ingests **EVTX exports**, not a live event stream, so it cannot claim real-time prevention. It is a **single-node** system: PostgreSQL, the worker, and the CAS are local. Authentication is a static-key stub with in-memory, unsalted SHA-256 hashes; argon2 is present but unused, and TLS is not configured. The rate limiter is in-process, the worker role has `BYPASSRLS`, and finding suppression is run-scoped rather than globally deduplicated. The current test suite is not fully green: `test_fresh_pack_resolves_clean` fails because its fixed clock now exceeds the seven-day IOC freshness threshold. That is a test defect, but it must be shown, not hidden.
>
> The UNSW-NB15 result is a **portability study** on network data with a six-rule research pack. It must not be presented as the accuracy of Sentinel’s Windows rule pack.

**Figure callout:** `[FIGURE 5 — LIMITS / TRUST BOUNDARY]`

### 2.12 Future work — 100 words

> Next steps are M3 completion and production hardening: route the declared-but-missing workspace collection endpoint; implement real cursor pagination beyond events; record upload `failed` and `rejected_by_policy` states; add global deduplication semantics; replace static keys with a real identity provider; add TLS and a distributed limiter; and run the worker without `BYPASSRLS` where possible. Detection work should expand beyond process creation, add an EVTX streaming agent, and evaluate the 112-rule pack on a labelled Windows corpus. UI tests and a reproducible containerized demo are also needed before any “production” claim.

### 2.13 Conclusion — 70 words

> Sentinel shows that a lightweight Windows HIDS can be built around **defensible findings**, not just rule matches. A pinned rule pack, dual-path detection with explicit divergence reporting, and evidence that survives retention make the system auditable. The M2 slice passed six exit gates and met its local latency budget. The remaining gaps — batch-only ingest, single-node scope, static auth, and a date-sensitive failing test — define the work between this prototype and production.

---

## 3. Poster panel layout (copy map)

### Header band
- Title, subtitle, author block, affiliation, contact QR.
- One-line claim: “Evidence-first Windows detection for lightweight deployments.”

### Left column
1. Problem (2.2)
2. Research questions (2.3)
3. Contributions (2.4)
4. System overview (2.5) + Figure 1

### Middle column
1. Pipeline (2.6) + Figure 2
2. Detection semantics (2.7) + Figure 3
3. Evidence and isolation (2.8) + Figure 4

### Right column
1. Evaluation method (2.9)
2. Results table + bullets (2.10)
3. Discussion / limits (2.11)
4. Future work (2.12)
5. Conclusion (2.13)
6. References and AI disclosure

### Footer
- Repository QR, contact, license, “M2 verified; M3 in progress.”

---

## 4. Short pitches

### 30-second pitch

> “Sentinel is a lightweight Windows HIDS backend that turns EVTX exports into findings you can defend. It hashes the raw log, canonicalizes events, evaluates a pinned SigmaHQ rule pack, and freezes evidence before logs are purged. The M2 slice passed six exit gates; a 23-rule conformance corpus had zero unexplained SQL/native divergences; and a 101k-row timeline query ran at 1.41 seconds p95. It is deliberately not a production SIEM.”

### 2-minute explanation

> “Most lightweight detection demos stop when a rule matches. That is not enough if the alert points to a log that has been rotated, or if a rule changed silently. Sentinel treats a finding as a claim with provenance. The upload is hashed into a content-addressed store, events are normalized into a stable schema, and each finding stores the rule version, run configuration, and per-event digests. A purge drill proves the evidence still works after the raw object and the event rows are gone.
>
> Detection uses two paths. Simple predicates compile to SQL. Regex, keyword-heavy, or unmapped-field rules run natively. A 23-rule corpus checks whether both paths produce the same fingerprint; 19 are comparable and four are explicitly native-only. The demo workspace evaluates 113 rules: 112 from the pinned SigmaHQ pack plus one local demo rule. It produces two findings and a run summary that exposes 17 partial outcomes rather than hiding them.
>
> Evaluation is deliberately split. The six M2 gates cover the end-to-end path, evidence, latency, cold-start warnings, conformance, and UNSW parsing. The headline UNSW result uses a six-rule research pack, so it is a portability study, not the shipping pack’s accuracy. Current limits are batch EVTX only, single-node deployment, static-key auth, and one date-sensitive failing test. Those are on the poster because hiding them would make the rest less credible.”

---

## 5. Anticipated questions and safe answers

**Q: Is this an AI/ML detector?**  
> No. Sentinel is rule-based. It evaluates Sigma-style detections with SQL and native execution. No model is trained or used for detection.

**Q: Why Sigma?**  
> Sigma is a portable, human-readable rule format with an existing ecosystem. Pinning the pack by commit and SHA makes rule changes visible.

**Q: Does 0.886 F1 mean Sentinel detects 88.6% of attacks?**  
> No. That number is from UNSW-NB15, a network dataset, using a six-rule research pack. It is a portability study. The Windows pack was not scored on that dataset.

**Q: Why is one test failing?**  
> `test_fresh_pack_resolves_clean` uses a fixed clock, and the IOC pack is now older than the seven-day freshness threshold, so the code correctly returns `IOC_PACK_STALE`. It is a date-dependent test defect, not a detection regression. It is disclosed on the poster.

**Q: Is this production-ready?**  
> No. Batch EVTX ingest, single-node scope, static API keys, no TLS, an in-process limiter, and an uncommitted M3 working tree rule that out.

**Q: What is novel here?**  
> The integration, not any single algorithm: pinned detection content, dual-path execution with a conformance oracle, and evidence snapshots that survive retention, all in a small multi-tenant backend.

**Q: Did real users evaluate it?**  
> No user study was performed. The evaluation is technical and artifact-based.

**Q: Does it prevent attacks?**  
> No. It detects after ingestion. There is no blocking, quarantine, or remediation.

**Q: Why 112 vs 113 rules?**  
> The pinned pack has 112. The default demo workspace evaluates 113 because it also contains one local demo rule.

**Q: What about the 32-policy claim?**  
> The current DDL and contract test say 33 policies across 21 base tables and 12 partition children. The older 32/11 wording is stale documentation.

---

## 6. Author inputs still required

- [ ] Confirm project name and final title.
- [ ] Author names, affiliation, department, institution, supervisor.
- [ ] Poster dimensions, venue, date, and printing constraints.
- [ ] Contact method and QR-code destination (repository? demo? email?).
- [ ] Confirm whether the repository is public; if not, provide a sanitized artifact link or QR.
- [ ] Confirm AI-assistance disclosure wording required by the course/venue.
- [ ] Confirm whether M3 work may be mentioned as “in progress” or must be omitted.
- [ ] Approve screenshots and their redactions.
- [ ] Decide whether to include the failing test explicitly on the poster (recommended: yes, in limits).
- [ ] Confirm reference list and citation style.

---

## 7. Claims to remove if space is tight

Keep, in order of priority:

1. Evidence snapshot + purge drill.
2. Pinned 112-rule pack + dual-path conformance.
3. Six M2 gates + timeline p95.
4. UNSW portability result with qualifier.
5. Current test caveat.

If the poster is overcrowded, drop the per-category UNSW table and the exact train metrics first. Never drop the qualifiers.
