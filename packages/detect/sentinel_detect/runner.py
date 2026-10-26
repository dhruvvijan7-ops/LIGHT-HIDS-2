"""Detection run runner (Stage-5 §4.3 lifecycle).

``prepare()`` classifies every loaded rule (cold-start policy, spec §4.8),
``process()`` runs the compiled SQL or the native evaluator per rule and
freezes each finding into ``findings.evidence_snapshot`` (spec §1.5), and
``finalize()`` writes per-rule accounting and the terminal run status.

Invariants honoured here:

* zero rules ⇒ zero ``rule_run`` rows, zero findings, status ``completed``
  (M1 exit ①, D6-015);
* warm-up / cold-start is never silent — a suppressed rule is accounted with
  ``BASELINE_WARMUP`` and the run becomes ``completed_with_warnings`` (§4.8);
* the compiled SQL is never re-parsed; it is executed as stored (§1.10
  invariant 7);
* every finding carries ``detection_path`` and an ``author`` (DRL 1.1).
"""
from __future__ import annotations

import hashlib
import uuid
from time import perf_counter
from typing import Any, Iterable, Mapping, Sequence

import psycopg

from sentinel_storage import repos_detect, repos_findings

from .compile import CompileError, bind_params, plan
from .evaluate import evaluate
from .evidence import (
    attck_refs,
    build_finding,
    build_snapshot,
    falsepositives_note,
    payload_excerpt,
)
from .fingerprint import finding_fingerprint
from .ioc_engine import (
    IOC_PACK_MISSING,
    IOC_PACK_STALE,
    evaluate_ioc_rule,
    load_active_pack_indexes,
    resolve_pack_refs,
)
from .store import ENGINE_VERSION, DbRuleStore

_NATIVE_ROW_SQL = """
    SELECT e.event_uid, e.document, e.host_hostname, e.user_name,
           COALESCE(e.event_time_utc, e.ingest_time) AS finding_time
      FROM events e
     WHERE e.tenant_id = %s AND e.workspace_id = %s AND e.run_id = ANY(%s)
"""

_BASELINE_OBSERVATIONS_SQL = """
    SELECT COALESCE(sum(o.observations), 0)
      FROM rule_baseline o
     WHERE o.tenant_id = %s AND o.workspace_id = %s AND o.rule_id = %s
"""

_BASELINE_MISSING = "BASELINE_MISSING"
_BASELINE_WARMUP = "BASELINE_WARMUP"
_NATIVE_BY_COMPILE = "NATIVE_BY_COMPILE"
# A rule whose kind has no engine path yet (should be unreachable once B2–B5
# land their dispatchers) — accounted, never silently skipped.
_UNSUPPORTED_RULE_KIND = "UNSUPPORTED_RULE_KIND"


def _rule_kind(document: Mapping[str, Any]) -> str:
    return str(document.get("kind") or "sigma")


def _config_hash() -> bytes:
    from .sigma_import import default_manifest, pack_config_bytes

    return hashlib.sha256(pack_config_bytes(default_manifest(), ENGINE_VERSION)).digest()


def _scope_run_ids(
    conn: psycopg.Connection, tenant_id: str, workspace_id: str, scope: Mapping[str, Any]
) -> list[str]:
    harvest = scope.get("harvest_run_id")
    if harvest:
        return [str(harvest)]
    run_ids = scope.get("run_ids")
    if isinstance(run_ids, list) and run_ids:
        return [str(r) for r in run_ids]
    rows = conn.execute(
        "SELECT DISTINCT run_id FROM events WHERE tenant_id = %s AND workspace_id = %s",
        (tenant_id, workspace_id),
    ).fetchall()
    return [str(r[0]) for r in rows]


def _load_native_rows(
    conn: psycopg.Connection, tenant_id: str, workspace_id: str, run_ids: Sequence[str]
) -> list[tuple[Any, ...]]:
    return conn.execute(_NATIVE_ROW_SQL, (tenant_id, workspace_id, list(run_ids))).fetchall()


def _filter_rules(rules: Iterable[Mapping[str, Any]], scope: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    wanted = scope.get("rule_ids")
    if not isinstance(wanted, list) or not wanted:
        return list(rules)
    wanted_ids = {str(r) for r in wanted}
    return [r for r in rules if str(r["rule_id"]) in wanted_ids]


def _prepare(
    conn: psycopg.Connection,
    rules: Sequence[Mapping[str, Any]],
    tenant_id: str,
    workspace_id: str,
) -> tuple[list[Mapping[str, Any]], list[tuple[uuid.UUID, list[str]]]]:
    """Split loaded rules into (runnable, cold-start suppressed with codes)."""
    runnable: list[Mapping[str, Any]] = []
    suppressed: list[tuple[uuid.UUID, list[str]]] = []
    for rule in rules:
        codes = _cold_start_codes(conn, rule, tenant_id, workspace_id)
        if codes:
            suppressed.append((rule["rule_id"], codes))
        else:
            runnable.append(rule)
    return runnable, suppressed


def _min_observations(document: Mapping[str, Any]) -> int:
    """§1.7 / §9.1: the cold-start gate lives in ``statistical.baseline``.

    The rule schema has no top-level ``baseline`` property, so a top-level
    one is tolerated for hand-authored documents but never required.
    """
    for block in (document.get("statistical"), document):
        if isinstance(block, Mapping) and isinstance(block.get("baseline"), Mapping):
            return int(block["baseline"].get("min_observations") or 0)
    return 0


def _cold_start_codes(
    conn: psycopg.Connection,
    rule: Mapping[str, Any],
    tenant_id: str,
    workspace_id: str,
) -> list[str]:
    """§4.8: statistical rules need a seeded baseline; everything else is
    cold-start-free.  Returns the reason codes that suppress the rule."""
    if rule.get("kind") != "statistical":
        return []
    min_observations = _min_observations(rule["document"])
    row = conn.execute(
        _BASELINE_OBSERVATIONS_SQL, (tenant_id, workspace_id, rule["rule_id"])
    ).fetchone()
    observations = int(row[0]) if row else 0
    if observations <= 0:
        return [_BASELINE_MISSING]
    if min_observations and observations < min_observations:
        return [_BASELINE_WARMUP]
    return []


def _codes_from_block(block: Mapping[str, Any] | None) -> list[str]:
    """Every registered reason code attached to this rule at compile time."""
    if not isinstance(block, Mapping):
        return []
    codes: list[str] = []
    for item in block.get("unsupported") or ():
        code = item.get("code") if isinstance(item, Mapping) else str(item)
        if code and code not in codes:
            codes.append(code)
    fallback = block.get("fallback_reason")
    if fallback and fallback not in codes:
        codes.append(fallback)
    return codes


def _needs_native(rule: Mapping[str, Any]) -> bool:
    block = rule.get("compile")
    if not isinstance(block, Mapping) or not block.get("sql"):
        return True
    return block.get("detection_path") != "sql"


def _compile_on_demand(rule: Mapping[str, Any]) -> Mapping[str, Any]:
    """§4.8 compile cache row: absent → compile at job start.

    A block compiled by a different engine version is not trusted — the bind
    list is derived from the document, so a stale ``sql`` would desynchronise
    its placeholders from ``bind_params()``.

    Non-sigma kinds never go through the Sigma planner (their documents have
    no ``detection`` block); they carry a native compile block and are
    dispatched by kind in ``_process_rule``.
    """
    stored = rule.get("compile")
    if _rule_kind(rule.get("document") or {}) != "sigma":
        if isinstance(stored, Mapping):
            return stored
        return {
            "engine_version": ENGINE_VERSION,
            "detection_path": "native",
            "unsupported": [],
        }
    if isinstance(stored, Mapping) and stored.get("engine_version") == ENGINE_VERSION:
        return stored
    fresh, _ = plan(rule["document"])
    if isinstance(stored, Mapping) and stored.get("unsupported"):
        fresh = dict(fresh)
        fresh["unsupported"] = stored["unsupported"]
    return fresh


def run_detection(
    conn: psycopg.Connection,
    *,
    run_id: uuid.UUID,
    tenant_id: str,
    workspace_id: str,
    requested_by: str,
    scope: dict[str, Any],
) -> dict[str, Any]:
    repos_detect.mark_running(conn, run_id)

    config_hash = _config_hash()
    config_hex = config_hash.hex()
    conn.execute(
        "UPDATE detection_runs SET config_hash = %s WHERE run_id = %s",
        (config_hash, run_id),
    )

    rules = _filter_rules(DbRuleStore(conn).load(tenant_id, workspace_id), scope)
    run_ids = _scope_run_ids(conn, tenant_id, workspace_id, scope)

    prepared, suppressed = _prepare(conn, rules, tenant_id, workspace_id)

    # §6: load every active pack once per run; per-rule refs resolve against
    # this set (missing → IOC_PACK_MISSING on that rule only).
    ioc_context: dict[str, Any] = {}
    if any(_rule_kind(r.get("document") or {}) == "ioc" for r in prepared):
        ioc_context["packs"] = load_active_pack_indexes(conn, tenant_id, workspace_id)

    native_rows: list[tuple[Any, ...]] | None = None
    if run_ids and any(_needs_native(rule) for rule in prepared):
        native_rows = _load_native_rows(conn, tenant_id, workspace_id, run_ids)
    event_count = len(native_rows) if native_rows is not None else _count_events(
        conn, tenant_id, workspace_id, run_ids
    )

    total_findings = 0
    outcomes: list[str] = []
    warning_codes: list[str] = []
    paths = {"sql": 0, "native": 0}

    for rule in prepared:
        rule_id = rule["rule_id"]
        try:
            result = _process_rule(
                conn,
                rule,
                tenant_id=tenant_id,
                workspace_id=workspace_id,
                run_id=run_id,
                run_ids=run_ids,
                native_rows=native_rows or [],
                config_hex=config_hex,
                event_count=event_count,
                ioc_context=ioc_context,
            )
        except psycopg.errors.QueryCanceled:
            repos_detect.upsert_rule_run(
                conn,
                run_id=run_id,
                rule_id=rule_id,
                outcome="error",
                processed_events=event_count,
                detection_path="sql" if not _needs_native(rule) else "native",
                reason_codes=["SQL_TIMEOUT"],
            )
            outcomes.append("error")
            warning_codes.append("SQL_TIMEOUT")
            continue
        except CompileError:
            repos_detect.upsert_rule_run(
                conn,
                run_id=run_id,
                rule_id=rule_id,
                outcome="error",
                processed_events=event_count,
                reason_codes=["UNSUPPORTED_CONDITION_FORM"],
            )
            outcomes.append("error")
            warning_codes.append("UNSUPPORTED_CONDITION_FORM")
            continue

        # OK_PARTIAL: the rule ran, but a registered reason code narrows what
        # it could see.  Never folded into a clean `ok` (no silent skip).
        outcome = "ok_partial" if result["reason_codes"] else "ok"
        repos_detect.upsert_rule_run(
            conn,
            run_id=run_id,
            rule_id=rule_id,
            outcome=outcome,
            findings=result["findings"],
            processed_events=event_count,
            detection_path=result["detection_path"],
            reason_codes=result["reason_codes"],
            sql_ms=result["sql_ms"],
            native_ms=result["native_ms"],
        )
        outcomes.append(outcome)
        paths[result["detection_path"]] += 1
        total_findings += result["findings"]
        warning_codes.extend(result["reason_codes"])

    for rule_id, codes in suppressed:
        repos_detect.upsert_rule_run(
            conn,
            run_id=run_id,
            rule_id=rule_id,
            outcome="skipped",
            processed_events=0,
            reason_codes=codes,
        )
        outcomes.append("skipped")
        warning_codes.extend(codes)

    errors = sum(1 for o in outcomes if o == "error")
    if prepared and errors == len(prepared):
        status = "failed"
    elif any(o != "ok" for o in outcomes):
        status = "completed_with_warnings"
    else:
        status = "completed"

    outcome_counts = {name: outcomes.count(name) for name in sorted(set(outcomes))}
    summary = {
        "rules_total": len(rules),
        "rules_evaluated": len(prepared),
        "rules_suppressed": len(suppressed),
        "rule_outcomes": outcome_counts,
        "findings": total_findings,
        "events": event_count,
        "detection_paths": paths,
        "engine": "empty-pack" if not rules else "sentinel-detect",
        "reason_codes": sorted({c for c in warning_codes}),
        "run_ids": run_ids,
    }
    from .sigma_import import default_manifest

    manifest = default_manifest()
    if manifest is not None:
        summary["pack"] = {
            "pack_id": manifest.pack_id,
            "pack_version": manifest.pack_version,
            "pack_sha256": manifest.pack_sha256,
        }

    repos_detect.finish_run(conn, run_id, status=status, summary=summary)
    return {"run_id": str(run_id), "status": status, **summary}


def _count_events(
    conn: psycopg.Connection, tenant_id: str, workspace_id: str, run_ids: Sequence[str]
) -> int:
    if not run_ids:
        return 0
    row = conn.execute(
        "SELECT count(*) FROM events WHERE tenant_id = %s AND workspace_id = %s AND run_id = ANY(%s)",
        (tenant_id, workspace_id, list(run_ids)),
    ).fetchone()
    return int(row[0]) if row else 0


def _process_rule(
    conn: psycopg.Connection,
    rule: Mapping[str, Any],
    *,
    tenant_id: str,
    workspace_id: str,
    run_id: uuid.UUID,
    run_ids: Sequence[str],
    native_rows: Sequence[tuple[Any, ...]],
    config_hex: str,
    event_count: int,
    ioc_context: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    document = rule["document"]
    kind = _rule_kind(document)
    if kind == "ioc":
        return _process_ioc_rule(
            conn,
            rule,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            run_id=run_id,
            native_rows=native_rows or [],
            config_hex=config_hex,
            ioc_context=ioc_context or {},
        )
    if kind != "sigma":
        # Accounted non-silent placeholder until B2–B5 land their dispatchers.
        # The caller writes rule_run from this result — no upsert here.
        return {
            "findings": 0,
            "detection_path": "native",
            "reason_codes": [_UNSUPPORTED_RULE_KIND],
            "sql_ms": None,
            "native_ms": None,
        }

    block = _compile_on_demand(rule)
    reason_codes = _codes_from_block(block)

    sql_ms: int | None = None
    native_ms: int | None = None

    if block.get("detection_path") == "sql" and block.get("sql"):
        started = perf_counter()
        rows = conn.execute(
            block["sql"], bind_params(document, tenant_id, workspace_id, run_ids)
        ).fetchall()
        sql_ms = int((perf_counter() - started) * 1000)
        detection_path = "sql"
    else:
        started = perf_counter()
        rows = [
            (m.event_uid, m.event, m.host_hostname, m.user_name, m.finding_time)
            for m in evaluate(document, native_rows)
        ]
        native_ms = int((perf_counter() - started) * 1000)
        detection_path = "native"
        if not reason_codes:
            reason_codes = [_NATIVE_BY_COMPILE]

    for row in rows:
        _emit_finding(
            conn,
            rule,
            row,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            run_id=run_id,
            config_hex=config_hex,
            detection_path=detection_path,
            reason_codes=reason_codes,
        )

    return {
        "findings": len(rows),
        "detection_path": detection_path,
        "reason_codes": reason_codes,
        "sql_ms": sql_ms,
        "native_ms": native_ms,
    }


def _process_ioc_rule(
    conn: psycopg.Connection,
    rule: Mapping[str, Any],
    *,
    tenant_id: str,
    workspace_id: str,
    run_id: uuid.UUID,
    native_rows: Sequence[tuple[Any, ...]],
    config_hex: str,
    ioc_context: Mapping[str, Any],
) -> dict[str, Any]:
    """Stage-5 §6 detector-time pass for ``kind: ioc`` rules.

    The pack set is resolved once per run (``ioc_context``); each rule pins
    its own (name, version, digest) refs. Missing packs → ``IOC_PACK_MISSING``
    (OK_PARTIAL, job continues); digest drift or age → ``IOC_PACK_STALE``
    with LOW-severity findings suppressed (§6.4). Both codes are registered
    in the tripwire allowlist (M3-A7).
    """
    document = rule["document"]
    started = perf_counter()
    packs = ioc_context.get("packs") or {}
    refs = (document.get("ioc") or {}).get("packs") or []
    indexes, codes, stale = resolve_pack_refs(refs, packs)
    matches, suppressed = evaluate_ioc_rule(
        document, indexes, native_rows, stale=stale
    )
    if suppressed and IOC_PACK_STALE not in codes:
        codes.append(IOC_PACK_STALE)
    native_ms = int((perf_counter() - started) * 1000)

    for m in matches:
        _emit_finding(
            conn,
            rule,
            (m.event_uid, m.event, m.host_hostname, m.user_name, m.finding_time),
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            run_id=run_id,
            config_hex=config_hex,
            detection_path="native",
            reason_codes=codes or [_NATIVE_BY_COMPILE],
            indicator={
                "pack": m.pack_name,
                "kind": m.indicator_kind,
                "value": m.indicator_value,
                "observed": m.observed,
                "field": m.matched_field,
            },
        )

    return {
        "findings": len(matches),
        "detection_path": "native",
        "reason_codes": codes,
        "sql_ms": None,
        "native_ms": native_ms,
    }


def _emit_finding(
    conn: psycopg.Connection,
    rule: Mapping[str, Any],
    row: Sequence[Any],
    *,
    tenant_id: str,
    workspace_id: str,
    run_id: uuid.UUID,
    config_hex: str,
    detection_path: str,
    reason_codes: Sequence[str],
    indicator: Mapping[str, Any] | None = None,
) -> None:
    event_uid, document, host_hostname, user_name, finding_time = row
    document = document if isinstance(document, Mapping) else {}
    doc = rule["document"]
    rule_id = rule["rule_id"]

    fingerprint = finding_fingerprint(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        rule_id=str(rule_id),
        time_utc=finding_time,
        event_uids=[event_uid],
        host_hostname=host_hostname,
        user_name=user_name,
    )

    finding_doc = build_finding(
        rule_id=str(rule_id),
        rule_name=str(doc.get("name") or doc.get("title") or rule_id),
        kind=str(doc.get("kind") or "sigma"),
        severity=str(doc.get("severity") or "MEDIUM"),
        level_original=doc.get("level_original"),
        author=_author(doc),
        time_utc=finding_time,
        event_ids=[event_uid],
        host={"agent_id": None, "instance_id": None, "name": host_hostname},
        user={"name": user_name, "domain": None},
        detection_path=detection_path,
        reason_codes=reason_codes,
        payload_excerpt_value=payload_excerpt(document),
        attck_refs_value=attck_refs(doc),
        falsepositives_note_value=falsepositives_note(doc),
        fingerprint_hex=fingerprint.hex(),
    )

    snapshot = build_snapshot(
        finding_doc,
        rule_document=doc,
        rule_source_sha256=rule.get("source_sha256"),
        run_id=run_id,
        config_hash=config_hex,
        events=[{"event_uid": event_uid, "document": document}],
    )
    if indicator:
        # M3-A12: IOC evidence carries the matched pack indicator (the spec
        # §10.3 provenance obligation, as far as the frozen schema allows).
        snapshot["ioc"] = dict(indicator)

    repos_findings.upsert_finding(
        conn,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        run_id=run_id,
        rule_id=rule_id,
        rule_name=finding_doc["rule_name"],
        author=finding_doc["author"],
        kind=finding_doc["kind"],
        severity=finding_doc["severity"],
        level_original=finding_doc["level"],
        time_utc=finding_time,
        host_hostname=host_hostname,
        user_name=user_name,
        detection_path=detection_path,
        reason_codes=reason_codes,
        fingerprint=fingerprint,
        event_uids=[event_uid],
        evidence_snapshot=snapshot,
    )


def _author(document: Mapping[str, Any]) -> str:
    author = document.get("author")
    if isinstance(author, list):
        return "; ".join(str(a) for a in author) or "sentinel"
    if isinstance(author, str) and author.strip():
        return author
    return "sentinel"
