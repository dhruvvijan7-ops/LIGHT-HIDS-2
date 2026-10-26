/* Public landing page — grounded strictly in what this repository implements.
   Pipeline stages map to the real M2 vertical slice: ingest → canonical
   events → detection runs → findings/evidence. No fabricated metrics,
   customers, or capabilities. */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Mark, Wordmark } from "../components/Brand";
import { CopyButton } from "../components/Json";
import { PipelineCanvas } from "../components/PipelineCanvas";
import { useAuth } from "../lib/auth";
import { useDocumentTitle, useReveal } from "../lib/hooks";
import "./landing.css";

/* Excerpt of tests/fixtures/cyanonical_events/003_network_network_connection.yaml
   — committed test data, trimmed to the canonical envelope. Shown only inside
   the clearly-labelled demonstration block. */
const DEMO_EVENT = `schema_version: canonical-event/v1
event:
  category: network
  type: network_connection
  action: connect
  outcome: success
  severity: informational
  derived_by: source
run_id: run-2026-10-09-001
time:
  utc: '2026-10-09T12:02:00.000Z'
  precision: millisecond
  state: inferred
host:
  hostname: WS-DEMO01
  os: { family: windows, build: '26100' }
user: { name: jdoe, domain: CORP }
source:
  format: evtx
  parser: evtx-canonical
  channel: Microsoft-Windows-Sysmon/Operational
  event_id: 3
network:
  protocol: tcp
  src_ip: 10.10.5.23
  dst_ip: 93.184.216.34
  dst_port: 443`;

const DEMO_FINDING = `{
  "severity": "HIGH",
  "rule_name": "example rule name",
  "detection_path": "sql",
  "triage_state": "new",
  "fingerprint": "…64-hex dedupe key…",
  "evidence_snapshot": {
    "rule_version": "…",
    "config_hash": "…",
    "event_uids": ["…"],
    "reason_codes": ["…"]
  }
}`;

const FORMATS = [
  "evtx",
  "json",
  "csv",
  "xml",
  "tsv",
  "text",
  "nmap_xml",
  "pcap",
  "sqlite",
  "yaml",
  "other",
] as const;

const STAGES = [
  {
    n: "01",
    t: "Ingest",
    d: "Upload one artifact at a time through a hostile-file gate: size caps, single file part, wall-clock deadline, content-addressed storage, per-principal quotas.",
    code: "POST /v1/workspaces/{id}/uploads",
  },
  {
    n: "02",
    t: "Normalize",
    d: "Parsers map source records — Sysmon, Security, PowerShell, network traces — into one canonical event envelope with explicit time, host, user, and provenance state.",
    code: "canonical-event/v1",
  },
  {
    n: "03",
    t: "Detect",
    d: "Sigma-compatible and native rules run over stored events on demand. Every run records per-rule accounting: outcomes, counts, timings, reason codes.",
    code: "POST /v1/workspaces/{id}/runs",
  },
  {
    n: "04",
    t: "Explain",
    d: "Each finding carries an immutable evidence snapshot and a dedupe fingerprint. Raw objects stay addressable while hot; every triage change is audited.",
    code: "GET …/evidence/{findingUid}",
  },
];

function Nav() {
  const { session } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`l-nav${scrolled ? " is-scrolled" : ""}`}
      aria-label="Primary"
    >
      <a href="/" style={{ color: "var(--text)" }}>
        <Wordmark />
      </a>
      <div className="l-nav-links">
        <a href="#pipeline">Pipeline</a>
        <a href="#inputs">Inputs</a>
        <a href="#evidence">Evidence</a>
        <a href="#demo">Demo</a>
        {session ? (
          <Link to="/console" className="btn btn-sm btn-primary l-nav-cta">
            Open console
          </Link>
        ) : (
          <Link to="/login" className="btn btn-sm btn-primary l-nav-cta">
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}

export function Landing() {
  useDocumentTitle("Sentinel — light Windows-first HIDS");
  const { session } = useAuth();
  const rootRef = useReveal<HTMLDivElement>();

  return (
    <div className="landing" ref={rootRef}>
      <Nav />

      {/* ---------------- hero ---------------- */}
      <header className="l-hero">
        <p className="l-hero-kicker reveal">
          Windows-first host detection · live API
        </p>
        <h1 className="reveal">
          Host telemetry, <em>made legible.</em>
        </h1>
        <p className="l-hero-sub reveal">
          Sentinel ingests forensic artifacts from Windows hosts, normalizes
          every record into one canonical event model, runs detection rules over
          what it stored, and preserves the evidence behind every finding. Built
          as a workspace-scoped API first — the console you are looking at is a
          client of it.
        </p>
        <div className="l-hero-ctas reveal">
          <Link
            to={session ? "/console" : "/login"}
            className="btn btn-primary"
            style={{ height: 48 }}
          >
            {session ? "Open the console" : "Sign in to the console"}
          </Link>
          <a href="#pipeline" className="btn btn-ghost" style={{ height: 48 }}>
            How it works
          </a>
        </div>

        <div
          className="l-hero-stage reveal"
          role="img"
          aria-label="Animated diagram: raw artifact bytes pass through a normalize gate and converge into structured events and a finding."
        >
          <PipelineCanvas height={360} />
          <div className="l-stage-labels">
            <span>Raw artifact</span>
            <span>Canonical events</span>
            <span>Finding + evidence</span>
          </div>
        </div>
      </header>

      {/* ---------------- pipeline ---------------- */}
      <section className="l-section" id="pipeline" aria-labelledby="pipeline-h">
        <div className="l-section-head reveal">
          <p className="label">The pipeline</p>
          <h2 id="pipeline-h">
            Four stages, <em>each observable.</em>
          </h2>
          <p className="prose">
            Every stage writes state you can query. Nothing is a black box:
            uploads carry triage status and gate warnings, events carry parser
            provenance, runs carry per-rule accounting, findings carry frozen
            evidence.
          </p>
        </div>
        <div className="l-stages">
          {STAGES.map((s) => (
            <article className="l-stage reveal" key={s.n}>
              <span className="l-stage-num">{s.n}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
              <code>{s.code}</code>
            </article>
          ))}
        </div>
      </section>

      {/* ---------------- inputs ---------------- */}
      <section className="l-section" id="inputs" aria-labelledby="inputs-h">
        <div className="l-section-head reveal">
          <p className="label">Inputs</p>
          <h2 id="inputs-h">
            Artifacts in, <em>canonical events out.</em>
          </h2>
          <p className="prose">
            The canonical event schema names these source formats. Coverage is
            honest: event formats are parsed into canonical records; other
            artifact classes are triaged and fingerprinted first. The console
            never claims analysis the parser did not perform.
          </p>
        </div>
        <div className="l-formats reveal">
          {FORMATS.map((f) => (
            <span className="l-chip" key={f}>
              {f}
            </span>
          ))}
        </div>
      </section>

      {/* ---------------- evidence ---------------- */}
      <section className="l-section" id="evidence" aria-labelledby="evidence-h">
        <div className="l-split">
          <div className="l-section-head reveal" style={{ marginBottom: 0 }}>
            <p className="label">Findings &amp; evidence</p>
            <h2 id="evidence-h">
              A finding is <em>a record, not a whisper.</em>
            </h2>
            <p className="prose">
              Detections land as findings with a stable fingerprint, the rule
              that produced them, the events they reference, and an evidence
              snapshot frozen at detection time — rule version, configuration
              hash, reason codes. Raw objects remain retrievable while hot;
              afterwards the snapshot is the evidence of record. Triage
              transitions are PATCHed through the API and written to a
              hash-chained audit log.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link
                to={session ? "/console/findings" : "/login"}
                className="btn btn-ghost"
              >
                {session ? "Browse findings" : "Sign in to browse findings"}
              </Link>
            </div>
          </div>
          <div className="l-split-card reveal">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <span className="label">evidence_snapshot · shape</span>
              <CopyButton text={DEMO_FINDING} />
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 12,
                lineHeight: 1.6,
                color: "var(--text-2)",
                overflow: "auto",
                maxHeight: 320,
              }}
            >
              {DEMO_FINDING}
            </pre>
          </div>
        </div>
      </section>

      {/* ---------------- demo ---------------- */}
      <section className="l-section" id="demo" aria-labelledby="demo-h">
        <div className="l-section-head reveal">
          <p className="label">Demonstration</p>
          <h2 id="demo-h">
            The model, <em>with real fixture data.</em>
          </h2>
          <p className="prose">
            Below is an excerpt from the canonical-event fixtures committed in
            this repository's test corpus — a Sysmon network connection
            normalized to <code>canonical-event/v1</code>. It is example data
            used to develop and test the parsers, not a live capture from your
            deployment.
          </p>
        </div>
        <div className="l-demo reveal">
          <div className="l-demo-banner">
            <span>
              Demonstration · committed test fixture — not live product output
            </span>
            <span
              className="mono"
              style={{ color: "var(--text-2)", letterSpacing: "0.04em" }}
            >
              tests/fixtures/canonical_events/003_network_network_connection.yaml
            </span>
          </div>
          <div className="l-demo-grid">
            <div className="l-demo-pane">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <span className="label">canonical-event/v1</span>
                <CopyButton text={DEMO_EVENT} />
              </div>
              <pre>{DEMO_EVENT}</pre>
            </div>
            <div className="l-demo-pane">
              <p className="label" style={{ marginBottom: 10 }}>
                Why it matters
              </p>
              <div
                style={{
                  display: "grid",
                  gap: 14,
                  fontSize: "var(--fs-sm)",
                  color: "var(--text-2)",
                }}
              >
                <p>
                  The original EVTX XML stays in{" "}
                  <code className="mono">raw</code>; the parsed fields land in
                  typed blocks (<code className="mono">network</code>,{" "}
                  <code className="mono">process</code>, …); everything the
                  mapper could not place is preserved in{" "}
                  <code className="mono">unmapped[]</code> instead of being
                  dropped.
                </p>
                <p>
                  Time carries its own honesty:{" "}
                  <code className="mono">state: inferred</code> and{" "}
                  <code className="mono">timezone_source</code> record exactly
                  how the UTC instant was derived.
                </p>
                <p>
                  Rules match against this shape — not against raw text — so
                  detections replay deterministically against stored events.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- platform facts ---------------- */}
      <section className="l-section" aria-labelledby="platform-h">
        <div className="l-section-head reveal">
          <p className="label">Platform</p>
          <h2 id="platform-h">
            API-first, <em>workspace-scoped.</em>
          </h2>
        </div>
        <div className="l-facts">
          <div className="l-fact reveal">
            <strong>Tenant isolation by default</strong>
            <span>
              Every /v1 path resolves the principal's tenant and workspace and
              enforces row-level security in Postgres. Clients never send tenant
              IDs.
            </span>
          </div>
          <div className="l-fact reveal">
            <strong>Idempotent mutations</strong>
            <span>
              Mutating POSTs accept an Idempotency-Key; replays return the
              original response and mismatched bodies are rejected with 409.
            </span>
          </div>
          <div className="l-fact reveal">
            <strong>Cursor pagination</strong>
            <span>
              List endpoints page with an opaque cursor and a next link, with a
              server-enforced maximum page size.
            </span>
          </div>
          <div className="l-fact reveal">
            <strong>Classified responses</strong>
            <span>
              Data-bearing responses carry an X-Data-Classification header; rate
              limits surface as 429 with standard RateLimit headers.
            </span>
          </div>
        </div>
      </section>

      {/* ---------------- final CTA ---------------- */}
      <section className="l-cta reveal" aria-labelledby="cta-h">
        <Mark size={34} />
        <h2 id="cta-h">Point it at your own workspace.</h2>
        <p className="prose" style={{ textAlign: "center" }}>
          The console is a thin client over the documented REST surface. Sign in
          with the API key issued for your workspace and the same endpoints you
          can curl are behind the UI.
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <Link
            to={session ? "/console" : "/login"}
            className="btn btn-primary"
            style={{ height: 48 }}
          >
            {session ? "Open the console" : "Sign in"}
          </Link>
          <Link
            to="/forgot-password"
            className="btn btn-ghost"
            style={{ height: 48 }}
          >
            Key recovery
          </Link>
        </div>
      </section>

      <footer className="l-footer">
        <span>Sentinel — light Windows-first HIDS backend + console</span>
        <span className="mono">
          Console reflects endpoints served by the running API build · M2
          vertical slice
        </span>
      </footer>
    </div>
  );
}
