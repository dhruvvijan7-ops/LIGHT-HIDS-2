from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import APIRouter, Query, Request
from starlette.responses import Response

from sentinel_core.db import tx
from sentinel_core.errors import BadRequestError, ConflictError, NotFoundError
from sentinel_core.rls import set_rls
from sentinel_detect.ioc_engine import (
    PackLoadError,
    load_trusted_keys,
    normalize_indicator,
    pack_entries_digest,
    trusted_keys_path,
    verify_pack_signature,
)

from .audit import write_audit
from .auth import Principal, authenticate
from .routes_uploads import _check_workspace, _settings, require_workspace

router = APIRouter()

_IOC_KINDS = {"sha256", "sha1", "md5", "ipv4", "ipv6", "domain", "url"}
_MAX_INDICATORS = 10000
_MAX_DOC_BYTES = 1024 * 1024


def _principal(request: Request) -> Principal:
    settings = _settings(request)
    return authenticate(settings, request.headers.get(settings.security_api_key_header))


def _pack_row(r: Any) -> dict[str, Any]:
    return {
        "pack_id": str(r[0]),
        "name": r[1],
        "version": r[2],
        "sha256": r[3],
        "signing_key_id": r[4],
        "status": r[5],
        "imported_at": r[6].isoformat() if r[6] else None,
    }


@router.get("/v1/workspaces/{workspaceId}/ioc-packs")
def list_ioc_packs(
    workspaceId: str,
    request: Request,
    limit: int = Query(50, ge=1, le=500),
):
    settings = _settings(request)
    principal = _principal(request)
    _check_workspace(principal, workspaceId)
    with tx(settings.database_url) as conn:
        set_rls(conn, principal.tenant_id, principal.workspace_id)
        rows = conn.execute(
            "SELECT pack_id, name, version, encode(sha256, 'hex'), "
            "       signing_key_id, status, imported_at "
            "FROM ioc_pack ORDER BY imported_at DESC LIMIT %s",
            (limit,),
        ).fetchall()
    return {"items": [_pack_row(r) for r in rows], "next": None}


@router.get("/v1/workspaces/{workspaceId}/ioc-packs/{packId}")
def get_ioc_pack(workspaceId: str, packId: str, request: Request):
    settings = _settings(request)
    principal = _principal(request)
    _check_workspace(principal, workspaceId)
    with tx(settings.database_url) as conn:
        set_rls(conn, principal.tenant_id, principal.workspace_id)
        row = conn.execute(
            "SELECT pack_id, name, version, encode(sha256, 'hex'), "
            "       signing_key_id, status, imported_at "
            "FROM ioc_pack WHERE pack_id = %s",
            (packId,),
        ).fetchone()
        if row is None:
            raise NotFoundError("ioc pack not found")
        entries = conn.execute(
            "SELECT kind, value_norm FROM ioc_entry WHERE pack_id = %s LIMIT 200",
            (packId,),
        ).fetchall()
    out = _pack_row(row)
    out["indicators"] = [{"kind": e[0], "value": e[1]} for e in entries]
    return out


@router.post("/v1/workspaces/{workspaceId}/ioc-packs", status_code=201)
def create_ioc_pack(workspaceId: str, request: Request, body: dict[str, Any]):
    """Import a pack. Verification-first posture (C-11 / exit ②):

    * unsigned, unknown-key, expired-key, or bad-signature → status
      ``rejected`` + an ``audit_log`` row. The pack row is still recorded so
      the attempt is queryable, but **no entries are ingested** — an
      unverified pack can never reach detection (``load_active_pack_indexes``
      only selects ``status='active'``).
    * signature valid against the workspace trust store → ``active``.
    * ``(name, version)`` already present → 409, last-known-good retained
      (Stage-4 T-06 posture: a failed *update* never clobbers a good pack).
    """
    settings = _settings(request)
    principal = _principal(request)
    require_workspace(request, principal, workspaceId, action="ioc_import")

    name = body.get("name")
    version = body.get("version")
    if not isinstance(name, str) or not name.strip():
        raise BadRequestError("name is required")
    if not isinstance(version, str) or not version.strip():
        raise BadRequestError("version is required")
    indicators = body.get("indicators")
    if not isinstance(indicators, list) or not indicators:
        raise BadRequestError("indicators must be a non-empty array")
    if len(indicators) > _MAX_INDICATORS:
        raise BadRequestError(f"indicators exceeds the {_MAX_INDICATORS} cap")
    signature = body.get("signature")
    signing_key_id = body.get("signing_key_id")
    if signature is not None and not isinstance(signature, str):
        raise BadRequestError("signature must be a base64 string")
    if signing_key_id is not None and not isinstance(signing_key_id, str):
        raise BadRequestError("signing_key_id must be a string")

    canon = json.dumps(
        {"name": name.strip(), "version": version.strip(), "indicators": indicators},
        sort_keys=True,
        separators=(",", ":"),
    )
    canon_bytes = canon.encode("utf-8")
    if len(canon_bytes) > _MAX_DOC_BYTES:
        raise BadRequestError("pack document exceeds the 1 MiB cap")
    pack_sha = hashlib.sha256(canon_bytes).hexdigest()

    import base64

    sig_bytes = None
    if signature:
        try:
            sig_bytes = base64.b64decode(signature, validate=True)
        except Exception:
            raise BadRequestError("signature is not valid base64")

    # --- verification (D4-003) -------------------------------------------
    # Verify BEFORE touching the DB. A rejected pack still lands as a row for
    # auditability, but never with entries.
    verify_error: str | None = None
    if not sig_bytes:
        verify_error = "pack is unsigned"
    else:
        try:
            verify_pack_signature(
                canon_bytes,
                signature,
                signing_key_id,
                load_trusted_keys(trusted_keys_path()),
            )
        except PackLoadError as exc:
            verify_error = str(exc)
    status = "rejected" if verify_error else "active"

    seen: set[tuple[str, str]] = set()
    entries: list[tuple[str, str, str]] = []
    for i, ind in enumerate(indicators):
        if not isinstance(ind, dict):
            raise BadRequestError(f"indicators[{i}] must be an object")
        kind = ind.get("kind")
        value = ind.get("value")
        if kind not in _IOC_KINDS:
            raise BadRequestError(
                f"indicators[{i}].kind must be one of {sorted(_IOC_KINDS)}"
            )
        if not isinstance(value, str) or not value.strip():
            raise BadRequestError(f"indicators[{i}].value must be a non-empty string")
        # §6.1: normalize-or-reject at LOAD time, never at match time.
        try:
            norm = normalize_indicator(kind, value)
        except ValueError as exc:
            raise BadRequestError(f"indicators[{i}]: {exc}")
        key = (kind, norm)
        if key in seen:
            continue
        seen.add(key)
        entries.append((kind, norm, hashlib.sha256(norm.encode("utf-8")).hexdigest()))

    # digest the engine will pin (order-insensitive, normalized) — surfaced on
    # the response so a rule's digest_sha256 can be written against it.
    digest = pack_entries_digest(
        [{"kind": k, "value": v} for k, v, _ in entries]
    )

    pack_id = None
    with tx(settings.database_url) as conn:
        set_rls(conn, principal.tenant_id, principal.workspace_id)
        # last-known-good guard: a duplicate (name, version) is a conflict, not
        # a silent overwrite, regardless of this import's verification result.
        existing = conn.execute(
            "SELECT pack_id, status FROM ioc_pack "
            "WHERE tenant_id = %s AND workspace_id = %s AND name = %s AND version = %s",
            (principal.tenant_id, principal.workspace_id, name.strip(), version.strip()),
        ).fetchone()
        if existing is not None:
            write_audit(
                settings,
                principal=principal,
                action="ioc_import",
                outcome="error",
                object_kind="ioc_pack",
                object_id=str(existing[0]),
                detail={
                    "name": name.strip(),
                    "version": version.strip(),
                    "reason": "pack name+version already exists; last-known-good retained",
                    "existing_status": existing[1],
                },
            )
            raise ConflictError("ioc pack name+version already exists")

        row = conn.execute(
            "INSERT INTO ioc_pack (tenant_id, workspace_id, name, version, sha256, "
            "                      signature, signing_key_id, status) "
            "VALUES (%s, %s, %s, %s, %s::bytea, %s::bytea, %s, %s) "
            "RETURNING pack_id, imported_at",
            (
                principal.tenant_id,
                principal.workspace_id,
                name.strip(),
                version.strip(),
                bytes.fromhex(pack_sha),
                sig_bytes,
                signing_key_id,
                status,
            ),
        ).fetchone()
        pack_id = str(row[0])
        imported_at = row[1]
        # Only an ACTIVE pack ingests entries. A rejected pack keeps its
        # manifest digest + signature for forensics, but no indicator data.
        if status == "active":
            for kind, norm, entry_digest in entries:
                conn.execute(
                    "INSERT INTO ioc_entry (tenant_id, workspace_id, pack_id, kind, "
                    "                        value_hash, value_norm) "
                    "VALUES (%s, %s, %s, %s, %s::bytea, %s) "
                    "ON CONFLICT DO NOTHING",
                    (
                        principal.tenant_id,
                        principal.workspace_id,
                        pack_id,
                        kind,
                        bytes.fromhex(entry_digest),
                        norm,
                    ),
                )
        conn.commit()

    write_audit(
        settings,
        principal=principal,
        action="ioc_import",
        # audit_log.outcome vocabulary is frozen to ok|denied|error (schema.sql);
        # a verification failure is an error, with the reason in detail.
        outcome="error" if verify_error else "ok",
        object_kind="ioc_pack",
        object_id=pack_id,
        detail={
            "name": name.strip(),
            "version": version.strip(),
            "indicators": len(entries),
            "digest_sha256": digest,
            **({"verify_error": verify_error} if verify_error else {}),
        },
    )
    return {
        "pack_id": pack_id,
        "name": name.strip(),
        "version": version.strip(),
        "sha256": pack_sha,
        "digest_sha256": digest,
        "signing_key_id": signing_key_id,
        "status": status,
        "imported_at": imported_at.isoformat() if imported_at else None,
        **({"verify_error": verify_error} if verify_error else {}),
    }


@router.delete("/v1/workspaces/{workspaceId}/ioc-packs/{packId}", status_code=204)
def retire_ioc_pack(workspaceId: str, packId: str, request: Request):
    """Retire a pack (status=retired) — it stops matching but is kept for
    provenance. Audited per §5.4."""
    settings = _settings(request)
    principal = _principal(request)
    require_workspace(request, principal, workspaceId, action="ioc_retire")
    with tx(settings.database_url) as conn:
        set_rls(conn, principal.tenant_id, principal.workspace_id)
        row = conn.execute(
            "UPDATE ioc_pack SET status = 'retired' "
            "WHERE pack_id = %s AND status <> 'retired' "
            "RETURNING pack_id",
            (packId,),
        ).fetchone()
        if row is None:
            found = conn.execute(
                "SELECT pack_id FROM ioc_pack WHERE pack_id = %s", (packId,)
            ).fetchone()
            if found is None:
                raise NotFoundError("ioc pack not found")
            # already retired — idempotent success, no second audit row
            return Response(status_code=204)
        conn.commit()
    write_audit(
        settings,
        principal=principal,
        action="ioc_retire",
        outcome="ok",
        object_kind="ioc_pack",
        object_id=packId,
    )
    return Response(status_code=204)
