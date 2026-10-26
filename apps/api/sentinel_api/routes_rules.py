from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, Query, Request

from sentinel_core.db import tx
from sentinel_core.errors import BadRequestError, NotFoundError
from sentinel_core.rls import set_rls
from sentinel_detect.sigma_import import (
    DISABLED,
    IMPORTED,
    RuleParseError,
    RuleValidationError,
    compile_native_rule,
    compile_rule_text,
    insert_rule,
)

from .audit import write_audit
from .auth import Principal, authenticate
from .routes_uploads import _check_workspace, _settings, require_workspace

router = APIRouter()

_MAX_RAW_BYTES = 256 * 1024
_DOC_SPLIT = re.compile(r"(?m)^---\s*$")


def _principal(request: Request) -> Principal:
    settings = _settings(request)
    return authenticate(settings, request.headers.get(settings.security_api_key_header))


@router.get("/v1/workspaces/{workspaceId}/rules")
def list_rules(
    workspaceId: str,
    request: Request,
    kind: str | None = None,
    enabled: bool | None = None,
    q: str | None = None,
    limit: int = Query(50, ge=1, le=500),
):
    settings = _settings(request)
    principal = _principal(request)
    _check_workspace(principal, workspaceId)
    sql = (
        "SELECT rule_id, name, kind, source, source_id, license, author, title, "
        "       status, level_original, severity, enabled, document, "
        "       imported_at, updated_at, schema_tag, source_ref, source_spec, "
        "       description, provenance "
        "FROM rules WHERE deleted_at IS NULL"
    )
    args: list[Any] = []
    if kind:
        sql += " AND kind = %s"
        args.append(kind)
    if enabled is not None:
        sql += " AND enabled = %s"
        args.append(enabled)
    if q:
        sql += " AND (name ILIKE %s OR title ILIKE %s)"
        args.extend([f"%{q}%", f"%{q}%"])
    sql += " ORDER BY imported_at DESC LIMIT %s"
    args.append(limit)
    with tx(settings.database_url) as conn:
        set_rls(conn, principal.tenant_id, principal.workspace_id)
        rows = conn.execute(sql, args).fetchall()
    items = [
        {
            "rule_id": str(r[0]),
            "name": r[1],
            "kind": r[2],
            "source": r[3],
            "source_id": r[4],
            "license": r[5],
            "author": r[6],
            "title": r[7],
            "status": r[8],
            "level_original": r[9],
            "severity": r[10],
            "enabled": r[11],
            "document": dict(r[12] or {}),
            "imported_at": r[13].isoformat() if r[13] else None,
            "updated_at": r[14].isoformat() if r[14] else None,
            "schema_tag": r[15],
            "source_ref": r[16],
            "source_spec": r[17],
            "description": r[18],
            "provenance": dict(r[19]) if r[19] is not None else None,
        }
        for r in rows
    ]
    return {"items": items, "next": None}


@router.get("/v1/workspaces/{workspaceId}/rules/{ruleId}")
def get_rule(workspaceId: str, ruleId: str, request: Request):
    settings = _settings(request)
    principal = _principal(request)
    _check_workspace(principal, workspaceId)
    with tx(settings.database_url) as conn:
        set_rls(conn, principal.tenant_id, principal.workspace_id)
        row = conn.execute(
            "SELECT rule_id, name, kind, severity, enabled, document, imported_at "
            "FROM rules WHERE rule_id = %s AND deleted_at IS NULL",
            (ruleId,),
        ).fetchone()
    if row is None:
        raise NotFoundError("rule not found")
    return {
        "rule_id": str(row[0]),
        "name": row[1],
        "kind": row[2],
        "severity": row[3],
        "enabled": row[4],
        "document": dict(row[5] or {}),
        "imported_at": row[6].isoformat() if row[6] else None,
    }


@router.get("/v1/workspaces/{workspaceId}/rules/{ruleId}/source")
def get_rule_source(workspaceId: str, ruleId: str, request: Request):
    settings = _settings(request)
    principal = _principal(request)
    _check_workspace(principal, workspaceId)
    with tx(settings.database_url) as conn:
        set_rls(conn, principal.tenant_id, principal.workspace_id)
        row = conn.execute(
            "SELECT text, encode(sha256, 'hex'), imported_at "
            "FROM rule_source WHERE rule_id = %s ORDER BY imported_at DESC LIMIT 1",
            (ruleId,),
        ).fetchone()
    if row is None:
        raise NotFoundError("rule not found")
    return {
        "text": row[0],
        "sha256": row[1],
        "imported_at": row[2].isoformat() if row[2] else None,
    }


def _native_outcome_row(compiled: Any, source_ref: str) -> dict[str, Any]:
    if compiled.outcome == IMPORTED:
        return {
            "source_ref": source_ref,
            "rule_id": compiled.rule_id,
            "outcome": "OK",
            "reason_codes": list(compiled.reason_codes),
        }
    if compiled.outcome == DISABLED:
        return {
            "source_ref": source_ref,
            "rule_id": compiled.rule_id,
            "outcome": "OK_PARTIAL",
            "reason_codes": list(compiled.reason_codes),
        }
    return {
        "source_ref": source_ref,
        "rule_id": compiled.rule_id,
        "outcome": "REJECTED",
        "reason_codes": list(compiled.reason_codes),
    }


@router.post("/v1/workspaces/{workspaceId}/rules", status_code=200)
def import_rules(
    workspaceId: str,
    request: Request,
    body: dict[str, Any] | list[dict[str, Any]],
):
    """Three import shapes (openapi importRules oneOf):

    * ``{raw_text, format: "sigma"}`` — upstream Sigma text, ``---``-separated
      (the M2 path, unchanged);
    * ``{raw_text, format: "sentinel"}`` — JSON ``sentinel-rule/v1`` document
      or array of them, serialized as text (M3-A8);
    * a bare ``RuleDocument`` or array of them, as already documented in
      openapi but never previously honored.
    """
    settings = _settings(request)
    principal = _principal(request)
    require_workspace(request, principal, workspaceId, action="rule_import")

    sigma_texts: list[str] = []
    native_docs: list[tuple[dict[str, Any], str]] = []

    if isinstance(body, list):
        for i, doc in enumerate(body):
            if not isinstance(doc, dict):
                raise BadRequestError(f"body[{i}] must be a rule document object")
            native_docs.append((doc, f"body[{i}]"))
    elif isinstance(body, dict) and "raw_text" in body:
        raw_text = body.get("raw_text")
        if not isinstance(raw_text, str) or not raw_text.strip():
            raise BadRequestError("raw_text is required and must be a non-empty string")
        if len(raw_text.encode("utf-8")) > _MAX_RAW_BYTES:
            raise BadRequestError("raw_text exceeds the 256 KiB import cap")
        fmt = body.get("format", "sigma")
        if fmt == "sigma":
            sigma_texts = [d.strip() for d in _DOC_SPLIT.split(raw_text) if d.strip()]
            if not sigma_texts:
                raise BadRequestError("raw_text contains no rule documents")
        elif fmt == "sentinel":
            try:
                parsed = json.loads(raw_text)
            except json.JSONDecodeError as exc:
                raise BadRequestError(f"raw_text is not valid JSON: {exc}")
            docs = parsed if isinstance(parsed, list) else [parsed]
            for i, doc in enumerate(docs):
                if not isinstance(doc, dict):
                    raise BadRequestError(f"document[{i}] must be a JSON object")
                native_docs.append((doc, f"raw_text[{i}]"))
        else:
            raise BadRequestError('format must be "sigma" or "sentinel"')
    elif isinstance(body, dict) and ("kind" in body or "schema" in body):
        native_docs.append((body, "body[0]"))
    else:
        raise BadRequestError(
            "body must be {raw_text}, a rule document, or an array of rule documents"
        )

    results: list[dict[str, Any]] = []
    imported = disabled = rejected = 0
    with tx(settings.database_url) as conn:
        set_rls(conn, principal.tenant_id, principal.workspace_id)
        for i, text in enumerate(sigma_texts, start=1):
            source_ref = f"raw_text[{i}]"
            try:
                compiled = compile_rule_text(text, source_ref=source_ref)
                insert_rule(conn, principal.tenant_id, principal.workspace_id, compiled)
            except (RuleParseError, RuleValidationError) as exc:
                results.append(
                    {
                        "source_ref": source_ref,
                        "rule_id": None,
                        "outcome": "REJECTED",
                        "reason_codes": ["VALIDATION_FAILED"],
                        "detail": str(exc),
                    }
                )
                rejected += 1
                continue
            if compiled.outcome == IMPORTED:
                results.append(_native_outcome_row(compiled, source_ref))
                imported += 1
            elif compiled.outcome == DISABLED:
                results.append(_native_outcome_row(compiled, source_ref))
                disabled += 1
            else:
                results.append(_native_outcome_row(compiled, source_ref))
                rejected += 1
        for doc, source_ref in native_docs:
            try:
                compiled = compile_native_rule(doc, source_ref=source_ref)
                insert_rule(conn, principal.tenant_id, principal.workspace_id, compiled)
            except RuleValidationError as exc:
                results.append(
                    {
                        "source_ref": source_ref,
                        "rule_id": None,
                        "outcome": "REJECTED",
                        "reason_codes": ["VALIDATION_FAILED"],
                        "detail": str(exc),
                    }
                )
                rejected += 1
                continue
            results.append(_native_outcome_row(compiled, source_ref))
            imported += 1
        conn.commit()

    write_audit(
        settings,
        principal=principal,
        action="rule_import",
        outcome="ok" if rejected == 0 else "error",
        object_kind="rules",
        detail={"imported": imported, "disabled": disabled, "rejected": rejected},
    )
    return {"results": results}
