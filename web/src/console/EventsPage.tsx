/* Events — canonical-event/v1 browser. Items are storage rows
   {event_uid, ingest_time, document}; the envelope lives under `document`.
   Filters mirror the query contract: run_id, category, host, since, until,
   cursor, limit. Detail expands inline from the list payload; GET by event
   uid is also served. */

import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { JsonBlock } from "../components/Json";
import { EmptyState, ErrorState, LoadingRows } from "../components/States";
import type { CanonicalEvent, EventListItem } from "../lib/api";
import { eventSeverityClass, fmtTime, hostName, userName } from "../lib/format";
import { useListPage } from "../lib/useListPage";
import { PageHead } from "./ConsoleLayout";

const EVENT_CATEGORIES = [
  "process",
  "network",
  "file",
  "dns",
  "authentication",
  "account",
  "service",
  "powershell",
  "fim",
];

const LIMITS = [25, 50, 100, 200];

export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const runId = params.get("run_id") ?? "";
  const host = params.get("host") ?? "";
  const limitParam = params.get("limit") ?? "";
  const limit = LIMITS.includes(Number(limitParam)) ? Number(limitParam) : 50;
  const hasFilter = Boolean(category || runId || host);

  const [catDraft, setCatDraft] = useState(category);
  const [runDraft, setRunDraft] = useState(runId);
  const [hostDraft, setHostDraft] = useState(host);

  // keep drafts in sync when the URL changes externally (back/forward, clear)
  useEffect(() => {
    setCatDraft(category);
    setRunDraft(runId);
    setHostDraft(host);
  }, [category, runId, host]);

  const list = useListPage<EventListItem>(
    (ws) => `/v1/workspaces/${encodeURIComponent(ws)}/events`,
    {
      limit,
      category: category || undefined,
      run_id: runId || undefined,
      host: host || undefined,
    },
  );

  const [expanded, setExpanded] = useState<string | null>(null);

  const apply = () => {
    const next = new URLSearchParams();
    if (catDraft.trim()) next.set("category", catDraft.trim());
    if (runDraft.trim()) next.set("run_id", runDraft.trim());
    if (hostDraft.trim()) next.set("host", hostDraft.trim());
    if (limit !== 50) next.set("limit", String(limit));
    setParams(next);
    setExpanded(null);
  };

  const clearFilters = () => {
    setParams(new URLSearchParams());
    setExpanded(null);
  };

  const setLimit = (value: number) => {
    const next = new URLSearchParams(params);
    if (value !== 50) next.set("limit", String(value));
    else next.delete("limit");
    setParams(next);
  };

  return (
    <>
      <PageHead
        title="Events"
        subtitle="Canonical events parsed from ingested artifacts. Every record carries parser provenance, explicit time state, and any unmapped fields preserved verbatim."
        actions={
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={list.reload}
            disabled={list.loading}
          >
            Refresh
          </button>
        }
      />

      <div className="c-filters">
        <label>
          Category
          <input
            className="input mono"
            list="ev-categories"
            placeholder="e.g. process"
            value={catDraft}
            onChange={(e) => setCatDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
          />
          <datalist id="ev-categories">
            {EVENT_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label>
          Run ID
          <input
            className="input mono"
            placeholder="run-…"
            value={runDraft}
            onChange={(e) => setRunDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
          />
        </label>
        <label>
          Host
          <input
            className="input mono"
            placeholder="e.g. WS-DEMO01"
            value={hostDraft}
            onChange={(e) => setHostDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
          />
        </label>
        <label>
          Rows
          <select
            className="select"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {LIMITS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={apply}
        >
          Apply filters
        </button>
        {hasFilter && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      <section className="c-panel">
        <div className="c-panel-head">
          <span className="label">Canonical events</span>
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)" }}
          >
            GET …/events
          </span>
        </div>
        {hasFilter && !list.loading && !list.error ? (
          <div className="c-filter-note" role="status">
            <span>
              Filtered view
              {runId ? (
                <>
                  {" — events for harvest run "}
                  <code className="mono">{runId}</code>
                </>
              ) : null}
              {category ? (
                <>
                  {" · category "}
                  <code className="mono">{category}</code>
                </>
              ) : null}
              {host ? (
                <>
                  {" · host "}
                  <code className="mono">{host}</code>
                </>
              ) : null}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={clearFilters}
            >
              Show all events
            </button>
          </div>
        ) : null}
        {list.loading ? (
          <div style={{ padding: 14 }}>
            <LoadingRows rows={8} cols={5} />
          </div>
        ) : list.error ? (
          <div style={{ padding: 14 }}>
            <ErrorState error={list.error} onRetry={list.reload} />
          </div>
        ) : list.items.length === 0 ? (
          <div style={{ padding: 14 }}>
            <EmptyState
              title={
                hasFilter
                  ? "No events match the current filters"
                  : "No events yet"
              }
              body={
                hasFilter
                  ? "No stored events match these filters. Adjust or clear them to see everything."
                  : "Events appear here after an artifact is ingested and its parser writes canonical records. Upload an EVTX artifact to get started."
              }
            />
          </div>
        ) : (
          <div
            className="table-wrap"
            style={{ border: "none", borderRadius: 0 }}
          >
            <table className="data">
              <thead>
                <tr>
                  <th>Time (UTC)</th>
                  <th>Category / type</th>
                  <th>Action</th>
                  <th>Outcome</th>
                  <th>Severity</th>
                  <th>Host</th>
                  <th>User</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((ev) => {
                  const doc = (ev.document ?? {}) as CanonicalEvent;
                  const utc = doc.time?.utc ?? null;
                  const timeState = doc.time?.state;
                  const sev = doc.event?.severity ?? "";
                  const open = expanded === ev.event_uid;
                  return (
                    <Fragment key={ev.event_uid}>
                      <tr
                        style={{ cursor: "pointer" }}
                        onClick={() => setExpanded(open ? null : ev.event_uid)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpanded(open ? null : ev.event_uid);
                          }
                        }}
                        aria-expanded={open}
                      >
                        <td
                          className="mono"
                          title={
                            utc
                              ? "event time (UTC)"
                              : "event time unavailable — showing ingest time (UTC)"
                          }
                        >
                          {fmtTime(utc ?? ev.ingest_time)}
                          {!utc && timeState && timeState !== "ok" ? (
                            <span
                              className="badge badge-plain"
                              style={{ marginLeft: 6 }}
                            >
                              {timeState}
                            </span>
                          ) : null}
                        </td>
                        <td className="mono">
                          <span style={{ color: "var(--text)" }}>
                            {doc.event?.category || "—"}
                          </span>
                          {doc.event?.type ? (
                            <span style={{ color: "var(--text-3)" }}>
                              {" / "}
                              {doc.event.type}
                            </span>
                          ) : null}
                        </td>
                        <td className="mono">{doc.event?.action || "—"}</td>
                        <td className="mono">{doc.event?.outcome || "—"}</td>
                        <td>
                          <span
                            className={`badge ${
                              sev ? eventSeverityClass(sev) : "badge-plain"
                            }`}
                          >
                            {sev || "—"}
                          </span>
                        </td>
                        <td className="mono">{hostName(doc.host)}</td>
                        <td className="mono">{userName(doc.user)}</td>
                        <td className="mono">{doc.source?.format || "—"}</td>
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={8} style={{ background: "var(--bg-2)" }}>
                            <div
                              style={{
                                display: "grid",
                                gap: 12,
                                padding: "4px 0",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  gap: 10,
                                  flexWrap: "wrap",
                                }}
                              >
                                <span className="badge badge-plain">
                                  parser {doc.source?.parser}{" "}
                                  {doc.source?.parser_version}
                                </span>
                                {doc.source?.channel ? (
                                  <span className="badge badge-plain">
                                    {doc.source.channel}
                                  </span>
                                ) : null}
                                {doc.source?.event_id !== undefined ? (
                                  <span className="badge badge-plain">
                                    eid {doc.source.event_id}
                                  </span>
                                ) : null}
                                <span className="badge badge-plain">
                                  time {timeState ?? "unknown"}
                                </span>
                                <span className="badge badge-plain">
                                  run {doc.run_id ?? "—"}
                                </span>
                                <span className="badge badge-plain">
                                  uid {ev.event_uid}
                                </span>
                              </div>
                              <JsonBlock
                                data={ev}
                                header="canonical event row · event_uid · ingest_time · document (canonical-event/v1)"
                                maxHeight={360}
                              />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="c-pager" style={{ padding: "0 14px 14px" }}>
          <span>
            {list.items.length} shown
            {list.pageDepth > 0 ? ` · page ${list.pageDepth + 1}` : ""}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={list.goPrev}
              disabled={!list.canGoPrev}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={list.goNext}
              disabled={!list.next}
            >
              Next
            </button>
          </span>
        </div>
      </section>

      <p
        style={{
          marginTop: 12,
          fontSize: "var(--fs-xs)",
          color: "var(--text-3)",
        }}
      >
        Select a row to expand the full envelope. GET by event uid (…/events/
        {"{eventUid}"}) fetches a single row; filters and paging are URL query
        parameters and survive refresh.
      </p>
    </>
  );
}
