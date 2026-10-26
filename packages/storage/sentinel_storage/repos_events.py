from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime
from typing import Any, Sequence

import psycopg

EVENT_INSERT_SQL = """
    INSERT INTO events (
        tenant_id, workspace_id, run_id, artifact_id,
        event_time_utc, event_time_state,
        event_category, event_type, event_action, event_outcome,
        event_severity, event_derived_by, classification,
        host_hostname, user_name, user_sid,
        source_format, source_parser, source_channel, source_provider,
        source_event_id, source_record_type, document
    ) VALUES (
        %(tenant_id)s, %(workspace_id)s, %(run_id)s, %(artifact_id)s,
        %(event_time_utc)s, %(event_time_state)s,
        %(event_category)s, %(event_type)s, %(event_action)s, %(event_outcome)s,
        %(event_severity)s, %(event_derived_by)s, %(classification)s,
        %(host_hostname)s, %(user_name)s, %(user_sid)s,
        %(source_format)s, %(source_parser)s, %(source_channel)s, %(source_provider)s,
        %(source_event_id)s, %(source_record_type)s, %(document)s
    )
"""

_CHUNK = 500


def bulk_insert(conn: psycopg.Connection, rows: Sequence[dict[str, Any]]) -> int:
    total = 0
    for start in range(0, len(rows), _CHUNK):
        chunk = rows[start : start + _CHUNK]
        with conn.cursor() as cur:
            cur.executemany(EVENT_INSERT_SQL, chunk)
            total += cur.rowcount if cur.rowcount and cur.rowcount > 0 else len(chunk)
    return total


def count_for_run(conn: psycopg.Connection, harvest_run_id: str) -> int:
    row = conn.execute(
        "SELECT count(*) FROM events WHERE run_id = %s", (harvest_run_id,)
    ).fetchone()
    return int(row[0]) if row else 0


def list_events(
    conn: psycopg.Connection,
    *,
    harvest_run_id: str | None = None,
    category: str | None = None,
    host: str | None = None,
    since: Any | None = None,
    until: Any | None = None,
    cursor: str | None = None,
    limit: int = 50,
) -> tuple[list[dict[str, Any]], str | None]:
    """One keyset-paginated page of events.

    Returns ``(items, next_cursor)`` — ``next_cursor`` is an opaque string
    when another page exists, else ``None``.  Raises ``ValueError`` on a
    malformed cursor.  ``since``/``until`` bound the effective event time
    (``COALESCE(event_time_utc, ingest_time)``, so null-time events still
    fall inside a window).
    """
    sql = "SELECT event_uid, ingest_time, document FROM events"
    conds: list[str] = []
    args: list[Any] = []
    if harvest_run_id:
        conds.append("run_id = %s")
        args.append(harvest_run_id)
    if category:
        conds.append("event_category = %s")
        args.append(category)
    if host:
        conds.append("lower(host_hostname) = lower(%s)")
        args.append(host)
    if since is not None:
        conds.append("COALESCE(event_time_utc, ingest_time) >= %s")
        args.append(since)
    if until is not None:
        conds.append("COALESCE(event_time_utc, ingest_time) < %s")
        args.append(until)
    if cursor is not None:
        cursor_time, cursor_uid = decode_cursor(cursor)
        conds.append("(ingest_time, event_uid) < (%s, %s)")
        args.extend([cursor_time, cursor_uid])
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY ingest_time DESC, event_uid DESC LIMIT %s"
    args.append(limit + 1)
    rows = conn.execute(sql, args).fetchall()
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [
        {"event_uid": str(r[0]), "ingest_time": r[1], "document": r[2]} for r in rows
    ]
    next_cursor = encode_cursor(rows[-1][1], rows[-1][0]) if has_more else None
    return items, next_cursor


def get_event(
    conn: psycopg.Connection, *, event_uid: str
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT event_uid, ingest_time, document FROM events WHERE event_uid = %s",
        (event_uid,),
    ).fetchone()
    if row is None:
        return None
    return {"event_uid": str(row[0]), "ingest_time": row[1], "document": row[2]}


def encode_cursor(ingest_time: Any, event_uid: Any) -> str:
    payload = {"t": ingest_time.isoformat(), "u": str(event_uid)}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> tuple[Any, uuid.UUID]:
    """Opaque cursor → ``(ingest_time, event_uid)``; ``ValueError`` if invalid."""
    pad = "=" * (-len(cursor) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor + pad))
        ingest_time = datetime.fromisoformat(payload["t"])
        event_uid = uuid.UUID(payload["u"])
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError("invalid cursor") from exc
    return ingest_time, event_uid
