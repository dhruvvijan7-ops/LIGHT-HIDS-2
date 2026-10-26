# SENTINEL — Missing Information and Verification Checklist

**Status:** Pre-submission checklist  
**Prepared:** 2026-10-23  
**Purpose:** Separate what is verified from what only the author, institution, or venue can supply. Nothing in this file should be guessed on the poster.

---

## 1. Blocking decisions (do not print without these)

| ID | Missing item | Why it blocks | Default if unanswered |
|---|---|---|---|
| B1 | Author name(s) and order | Required on the poster | Use `[AUTHOR NAME(S)]`; do not infer from file metadata |
| B2 | Department, institution, city/country | Required for academic poster | Use bracketed placeholder |
| B3 | Supervisor / advisor name and title | Often required; may be optional | Omit rather than invent |
| B4 | Venue, date, and poster session | Context for the work | Use `[VENUE, DATE]` |
| B5 | Poster dimensions and orientation | Drives layout and font sizes | Default A0 portrait, but confirm before asset production |
| B6 | Official project name | “Sentinel” is used in code; “AEGIS” appears once in an audit | Use **Sentinel**; confirm |
| B7 | Public contact and QR destination | QR to a private repo is useless or unsafe | Use email only; no QR |
| B8 | Repository visibility | Determines QR, artifact link, and what can be shown | Assume private; no public QR |
| B9 | AI-assistance disclosure policy | Course/venue may require a statement | Add a neutral disclosure placeholder |
| B10 | Whether M3 may be presented as “in progress” | Prevents overclaiming unfinished work | Present M2 as verified; mention M3 only as future work |

---

## 2. Project identity and authorship

### 2.1 Name

- Code, README, schema, tests, and UI use **Sentinel**.
- `SENTINEL_IMPLEMENTATION_AUDIT.md` mentions **AEGIS** once, without definition.
- The XLSX cover uses project code **LIGHT-HIDS** and project name **Sentinel — Windows-first lightweight HIDS**.
- No document defines an acronym for Sentinel.

**Question:** Is “Sentinel” the final public name? Is “AEGIS” an earlier name, an internal codename, or a mistake?

**Fallback:** Use “Sentinel” and omit AEGIS entirely.

### 2.2 Authorship metadata

- The DOCX file properties list a last-modified-by name, but the document body does not declare an author, institution, supervisor, or team.
- File metadata is not authorship evidence.
- If this is a group project, the poster needs a contribution statement or at least an author order agreed by the team.

**Questions:**

- [ ] Who are the authors, in order?
- [ ] Is this individual or group work?
- [ ] If group work, what did each person contribute?
- [ ] Who owns the repository and the poster?
- [ ] What affiliation should appear under each name?
- [ ] Is a supervisor/advisor to be credited?
- [ ] What contact method is approved for public display?

---

## 3. Venue and production requirements

- [ ] Poster size and orientation (A0/A1/A2; portrait/landscape).
- [ ] Bleed and safe-margin requirements.
- [ ] Required template, logo, colors, or font.
- [ ] Maximum/minimum font sizes.
- [ ] Word limit or mandatory sections (abstract, methods, ethics, references).
- [ ] Citation style.
- [ ] Whether QR codes are allowed.
- [ ] Whether a digital PDF must be submitted in advance.
- [ ] Printing vendor and color profile (CMYK vs RGB).
- [ ] Whether the poster is judged live or asynchronously.
- [ ] Whether a short pitch or demo is required.
- [ ] Whether a consent/ethics statement is required for the demo data.
- [ ] Whether AI-generated content must be disclosed, and in what wording.

**Fallback:** A0 portrait, 30 mm margins, three columns, 24 pt minimum body text. Do not add a logo or template without confirmation.

---

## 4. Evidence and claim decisions

### 4.1 The failing IOC test

**Fact:** `tests/contract/test_ioc_engine.py::test_fresh_pack_resolves_clean` fails at line 255 because the fixture pins `NOW = 2026-10-13`, while the IOC pack is older than the 7-day freshness threshold on 2026-10-23. The code returns `IOC_PACK_STALE`; the test expected `[]`.

**Decision required:** fix the test or disclose the failure.

| Option | Effect | Risk |
|---|---|---|
| Fix the fixture to use a clock injection / freezegun-style control | Suite can be green; behavior unchanged | Requires a test change and re-run; not done yet |
| Disclose as a date-sensitive test defect | Honest; poster remains accurate | Poster has a visible red item; reviewers may ask |
| Omit the failure | Cleaner poster | Misleading; audit already records it; not acceptable |

**Recommended:** disclose it in the limits band, and fix it after the poster if time allows. Do not silently change the test just to make the poster green.

### 4.2 M2 vs M3 scope

- M2 is verified and has six exit gates.
- M3 has uncommitted IOC/rule-workbench work; the IOC path has a date-sensitive test failure.
- The working tree is not a clean release.

**Questions:**

- [ ] Should the poster claim only M2, or M2 plus “M3 in progress”?
- [ ] Is there a tagged commit or release hash that can be cited?
- [ ] Should the repository be cleaned/committed before the poster QR is published?
- [ ] Are the M3 routes (`routes_ioc.py`, `routes_rules.py`) safe to demonstrate live?

**Fallback:** “M2 verified; M3 in progress.” Cite the last commit `33d069c` only if the author confirms the working tree state.

### 4.3 Test counts

There are three different test stories:

| Source | Number | Scope |
|---|---:|---|
| README | 379 | Stale, pre-M2/M3 |
| M2 exit audit | 539 passed, 3 deselected | Historical M2 suite |
| 2026-10-22 audit | 582 passed, 1 failed, 3 deselected | Current broader suite |
| 2026-10-23 no-DB run | 359 passed, 1 failed | Contract + unit + tripwire |

**Decision required:** which count goes on the poster?

**Recommended:** “M2 audit: 539 passed; current suite: 582 passed / 1 date-sensitive failure.” If only one number fits, use the M2 count with a date, not the README count.

### 4.4 Rule count

- Pinned shipping pack: **112 rules**.
- Default demo workspace: **113 enabled rules** (112 + one local demo rule).
- `DEVIATION_REGISTER.md` and some prose use “113 rules” for the pack.

**Decision required:** choose one phrasing and use it everywhere.

**Recommended:** “112-rule pinned SigmaHQ pack; 113 rules evaluated in the demo workspace.”

### 4.5 RLS counts

- Current DDL and contract test: **21 base tables + 12 partition children + 33 policies**.
- `schema.sql` header and `DEVIATION_REGISTER.md` M0-A1: **32 policies / 11 partitions** (stale).
- Audit repeats the stale 32/11.

**Decision required:** correct the prose or avoid the count.

**Recommended:** use 33/12 in the poster and note the documentation drift in the evidence ledger. Do not put 32/11 on the poster.

### 4.6 API surface

- `openapi.yaml`: 23 paths / 36 operations.
- The app does not route every declared operation.
- `GET /v1/workspaces` is declared but not routed; the console’s workspaces page admits this.
- Other declared mutations/list endpoints are also absent from the current routers (for example workspace metadata GET/PATCH, some DELETE/list operations). Verify any endpoint before claiming it.
- Cursor pagination is real for events; most other lists return `next: null`.

**Decision required:** is the poster claiming the **contract** (OpenAPI) or the **implemented API**?

**Recommended:** say “23-path OpenAPI contract; implemented subset verified for the demo.” Do not imply every path is live.

### 4.7 Multi-format ingestion

- Only EVTX is parsed.
- The landing page displays JSON/CSV/XML/log format chips.
- The API accepts uploads but the worker calls the EVTX parser unconditionally.

**Decision required:** remove the multi-format chips from the poster, or label them “planned.”

**Recommended:** “EVTX-only in the verified slice.”

### 4.8 Upload triage lifecycle

- `failed` and `rejected_by_policy` are schema states with no writer.
- Rejected pre-persistence uploads are deleted (204).
- Crashed ingests can leave `running`.

**Decision required:** disclose as a gap or omit the triage-state claim.

**Recommended:** disclose in limitations; do not claim complete upload lifecycle.

### 4.9 Evidence “immutability”

- The snapshot is frozen by application code and survives purge.
- No DB trigger prevents an owner/superuser from updating JSONB.
- Audit log has no trigger-enforced append-only behavior.

**Decision required:** use precise wording.

**Recommended:** “frozen evidence snapshot” and “append-only by application convention,” not “immutable” or “tamper-proof.”

### 4.10 Security claims

- Static API keys; unsalted SHA-256 for principals bootstrap; argon2 unused.
- No TLS.
- In-process rate limiter.
- Worker role has `BYPASSRLS`.
- Stored scopes are not a complete RBAC layer.
- No key rotation or expiry.

**Decision required:** whether to include a security limitations callout.

**Recommended:** yes, in the limits band. Do not claim production-grade security.

---

## 5. Data, licensing, and ethics

### 5.1 UNSW-NB15

- License: free for academic research; commercial use prohibited.
- The dataset is out-of-tree and not committed.
- The poster reports a six-rule research-pack result, not the shipping pack.
- Required citation: Moustafa & Slay (2015).

**Questions:**

- [ ] Is the intended poster use covered by the academic license?
- [ ] Is the dataset access date/version recorded?
- [ ] Is the citation in the required style?
- [ ] Does the poster need a data-availability statement?

**Fallback:** cite the dataset and state “academic-use licence; not redistributed.”

### 5.2 SigmaHQ rules

- 20 pinned SigmaHQ rules are committed in the conformance corpus.
- The 112-rule shipping pack is derived from SigmaHQ at commit `8a48134…`.
- SigmaHQ licensing/attribution requirements must be preserved.

**Questions:**

- [ ] Is the SigmaHQ licence notice included in the poster/artifact?
- [ ] Is the commit hash displayed correctly?
- [ ] Are the 3 Sentinel-authored rules distinguished from the 20 upstream rules?

**Fallback:** credit SigmaHQ and state the pinned commit; do not imply the rules are original work.

### 5.3 Demo EVTX and OTRF

- The demo corpus is attributed by the repository to `OTRF/Security-Datasets`.
- Host `DESKTOP-2KGM189`, event time 2017-12-26.
- The fixture is committed and used for the demo.

**Questions:**

- [ ] Is the OTRF attribution sufficient for public display?
- [ ] Are there any personal or sensitive records in the demo fixture?
- [ ] Should the screenshot include the fixture hostname at all?

**Fallback:** use the committed fixture, label it “public demo corpus,” and avoid personal logs.

### 5.4 AI assistance

- The XLSX cover says it was expanded by “OpenAI” and that values are illustrative/not independently executed.
- The audit/report may include AI-assisted analysis.
- The poster itself may use AI-assisted drafting.

**Questions:**

- [ ] What AI-use disclosure does the course/venue require?
- [ ] Were any results generated or modified by AI?
- [ ] Is the XLSX being submitted as evidence? If so, it must be labeled illustrative.
- [ ] Was the DOCX report AI-assisted? If yes, disclose it.

**Fallback:** add a short disclosure: “AI tools were used for drafting/editing; all reported numbers were verified against repository artifacts.” Only use this wording if true.

### 5.5 Privacy

- Do not use personal EVTX, personal hostnames, usernames, IPs, or API keys.
- The demo fixture is public and synthetic/curated, but verify before publishing screenshots.
- Redact browser chrome and local paths.

---

## 6. Reproducibility and release state

| Item | Status | Needed for poster? |
|---|---|---|
| Clean git commit/tag for the verified slice | Not confirmed; working tree has uncommitted M3 files | Yes if QR/repo is public |
| Lockfiles for Python and Node | Present? Verify `requirements.txt` / `web/package-lock.json` | Yes for reproducibility claim |
| `schema_lint.py` passing | Unresolved on Windows; audit says it did not complete | Do not claim the CI gate passed locally |
| CI run on the exact commit | Not re-verified | Do not claim green CI |
| Corpus fetch secrets | CI-secret gated; not verified | Do not claim out-of-tree corpora are reproducible without credentials |
| Docker image digests | Not pinned in poster | Optional |
| API/worker startup instructions | README exists but test counts are stale | Yes if demo is shown |
| M3 uncommitted files | Present | Do not publish a QR to a dirty tree without review |
| Full DB row counts | Test-polluted | Do not use as headline results |

**Questions:**

- [ ] What exact commit/tag should the poster cite?
- [ ] Is the repository public, private, or embargoed?
- [ ] Should the poster include a reproducibility badge or artifact link?
- [ ] Has `schema_lint.py` ever passed in CI on this commit?
- [ ] Is there a CI run URL that can be cited?

**Fallback:** cite “repository state 2026-10-23” and avoid a CI badge.

---

## 7. Screenshots and demo evidence

- [ ] Is the local app runnable with the current `.env` and Docker DB?
- [ ] Is the worker running?
- [ ] Is the frontend running?
- [ ] Which pages should be captured: finding detail, evidence, run summary, conformance?
- [ ] Is the demo run still present in the DB?
- [ ] Is the raw object hot or purged for that finding?
- [ ] Can the evidence page show both `hot` and `purged` states?
- [ ] Are API keys and DSNs hidden?
- [ ] Is the screenshot labeled with date, run ID, and “demo fixture”?

**Fallback:** if the app cannot be run safely, use redrawn diagrams and a clearly labeled evidence card. Do not fabricate a live screenshot.

**Known environment issues:**

- API port 8080 was occupied previously; the audit used 8090.
- The worker was not running at audit time.
- The DB host port was remapped in this environment.
- Full integration/e2e tests mutate the database.
- The scoring test rewrites a committed artifact.

These are demo-ops problems, not architecture claims. Do not put them on the poster.

---

## 8. Claims that require author confirmation

Check only if the author can defend the statement:

- [ ] “Sentinel is the first/only…” — no evidence; do not use.
- [ ] “Production-ready” — false.
- [ ] “Real-time” — false.
- [ ] “AI-powered” — false.
- [ ] “Full Sigma support” — false; only a bounded subset compiles.
- [ ] “Multi-format ingestion” — false.
- [ ] “Tamper-proof audit” — false.
- [ ] “Zero false positives” — false; UNSW FPR is 0.223.
- [ ] “Detects 88.6% of attacks” — misleading; qualify dataset and pack.
- [ ] “112-rule pack scored 0.886 F1” — false; that was a six-rule research pack.
- [ ] “All tests pass” — false; one date-sensitive test fails.
- [ ] “32 RLS policies” — stale; current is 33.
- [ ] “Automated UI tests” — false.
- [ ] “Public demo URL” — not confirmed.
- [ ] “Institution logo/endorsement” — not confirmed.

---

## 9. Reference and attribution checklist

- [ ] SigmaHQ repository and pinned commit.
- [ ] Sigma specification version 2.1.0.
- [ ] UNSW-NB15 citation (Moustafa & Slay, 2015).
- [ ] PostgreSQL RLS and partitioning docs (if cited).
- [ ] MITRE ATT&CK (if T-codes are shown).
- [ ] NIST SP 800-92 (if log-management framing is used).
- [ ] OTRF Security-Datasets (demo corpus).
- [ ] FastAPI/React (only if the poster discusses the stack; optional).
- [ ] License notices for committed third-party rules.
- [ ] AI-assistance disclosure.
- [ ] Institution/supervisor acknowledgements (only with permission).

Remove any reference that is not actually cited in the poster. A long reference list is not a substitute for provenance.

---

## 10. Fallback wording if information is unavailable

Use these exact fallbacks rather than guessing:

| Missing | Fallback text |
|---|---|
| Author | `[AUTHOR NAME(S)]` |
| Affiliation | `[DEPARTMENT, INSTITUTION]` |
| Supervisor | Omit the line entirely |
| Venue/date | `[VENUE, DATE]` |
| QR target | Omit the QR; use a contact email placeholder |
| Poster size | A0 portrait, but do not print until confirmed |
| M3 status | “M2 verified; M3 in progress” |
| Exact test count | “M2 audit: 539 passed; current suite: 582 passed / 1 date-sensitive failure” |
| Rule count ambiguity | “112-rule pinned pack; 113 rules in the demo workspace” |
| RLS count ambiguity | “33 policies across 21 base tables and 12 partition children” |
| API completeness | “23-path OpenAPI contract; implemented subset verified for the demo” |
| Screenshot unavailable | “Redrawn from stored demo evidence; not a live screenshot” |
| AI disclosure | Add only the wording the course/venue requires |

---

## 11. Final pre-print verification

### Claims

- [ ] Every number on the poster appears in `SENTINEL_RESULTS_AND_EVIDENCE.md`.
- [ ] 112 vs 113 is phrased correctly.
- [ ] UNSW is labeled “six-rule research pack” and “network dataset.”
- [ ] Timeline is labeled “local” and “101k rows.”
- [ ] Conformance says “0 unexplained divergences,” not “100%.”
- [ ] Current test failure is disclosed if the poster says “tests.”
- [ ] No “real-time,” “production-ready,” “AI,” or “tamper-proof” claims.
- [ ] “Immutable” is replaced with “frozen” or “application-level.”
- [ ] RLS count is 33/12 or omitted.
- [ ] API surface is described as a contract with an implemented subset.

### Evidence

- [ ] Every figure has a source path or run ID.
- [ ] Screenshots have date, run ID, and “demo fixture.”
- [ ] No API keys, DSNs, `.env`, personal data, or local usernames.
- [ ] QR points to the intended, accessible destination.
- [ ] References match the text.
- [ ] Third-party licenses/attributions are included.

### Production

- [ ] Author/affiliation/venue confirmed.
- [ ] Poster size confirmed.
- [ ] Fonts embedded/outlined.
- [ ] Colors proofed in CMYK.
- [ ] Bleed/margins correct.
- [ ] QR tested at final size.
- [ ] PDF exported and checked for missing fonts/images.
- [ ] A backup PDF is on a USB drive and in cloud storage.
- [ ] Printed proof approved before the full run.

---

## 12. One-page question sheet for the author

Copy this into an email or message:

```text
Sentinel poster — information needed

1. Final project name: Sentinel / other?
2. Author name(s), order, department, institution:
3. Supervisor/advisor (optional):
4. Venue, date, poster size/orientation:
5. Repository visibility and QR destination:
6. Required AI-use disclosure:
7. Can the poster say “M3 in progress,” or only M2?
8. Which test count should appear: M2 539, current 582/1, or both?
9. Is `test_fresh_pack_resolves_clean` being fixed before submission, or disclosed?
10. Are console screenshots approved? Which page(s)?
11. Is the UNSW academic-use licence acceptable for this poster?
12. Which logo (if any) is approved?
13. Citation style and required sections:
14. Any privacy/redaction requirements for the demo data:
15. Preferred contact method for the poster:
```

Do not print until items 1-6 and 8-9 are answered.
