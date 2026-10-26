"""M3 IOC integration gates — Stage-5 §6, exit ② (signed packs) and the
``kind: ioc`` slice of exit ① (planted finding).

Exit ②  an unsigned / invalidly-signed pack lands ``status='rejected'`` with
        an ``audit_log`` row and **zero** ``ioc_entry`` rows; a validly
        signed pack lands ``active``; a duplicate (name, version) is a 409
        that retains the last-known-good pack (Stage-4 T-06 posture).

Also covers the detector-time behaviour the M3 exit criteria lean on:
missing pack → ``IOC_PACK_MISSING`` (OK_PARTIAL, job continues), stale pack →
``IOC_PACK_STALE`` with LOW suppressed but MEDIUM+ firing (§6.4), and a
retired pack stops matching.

The trust store is a generated Ed25519 keypair written to ``tmp_path`` and
injected via ``$SENTINEL_IOC_TRUSTED_KEYS`` — no key material is committed.
"""
from __future__ import annotations

import base64
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from sentinel_core.db import tx

from ..keys import KEY_B

TENANT_ID = "tenant-b"
WORKSPACE_ID = "ws-b"
NOW = datetime.now(timezone.utc)

PLANTED_HASH = "e" * 64  # the indicator the planted event will carry
# rules.rule_id is uuid (schema.sql); the native document's id must be one too.
RULE_ID = "6f1e9a7b-2c3d-4e5f-8a9b-0c1d2e3f4a5b"


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def keypair():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes_raw()
    return priv, pub


@pytest.fixture
def trust_store(keypair, tmp_path, monkeypatch):
    """A workspace trust store with one valid, unexpired Ed25519 key."""
    _, pub = keypair
    path = tmp_path / "trusted_keys.json"
    path.write_text(
        json.dumps(
            {
                "keys": [
                    {
                        "key_id": "m3-test-key",
                        "algorithm": "ed25519",
                        "public_key": base64.b64encode(pub).decode(),
                        "not_after": (NOW + timedelta(days=365)).isoformat().replace(
                            "+00:00", "Z"
                        ),
                    }
                ]
            }
        )
    )
    monkeypatch.setenv("SENTINEL_IOC_TRUSTED_KEYS", str(path))
    return path


@pytest.fixture
def expired_store(keypair, tmp_path, monkeypatch):
    _, pub = keypair
    path = tmp_path / "expired_keys.json"
    path.write_text(
        json.dumps(
            {
                "keys": [
                    {
                        "key_id": "m3-expired-key",
                        "algorithm": "ed25519",
                        "public_key": base64.b64encode(pub).decode(),
                        "not_after": (NOW - timedelta(days=1)).isoformat().replace(
                            "+00:00", "Z"
                        ),
                    }
                ]
            }
        )
    )
    monkeypatch.setenv("SENTINEL_IOC_TRUSTED_KEYS", str(path))
    return path


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _purge(settings: Any) -> None:
    scope = (TENANT_ID, WORKSPACE_ID)
    with tx(settings.database_worker_url) as conn:
        conn.execute(
            "DELETE FROM findings WHERE tenant_id = %s AND workspace_id = %s", scope
        )
        conn.execute(
            "DELETE FROM rule_run WHERE run_id IN ("
            "  SELECT run_id FROM detection_runs"
            "   WHERE tenant_id = %s AND workspace_id = %s)",
            scope,
        )
        conn.execute(
            "DELETE FROM events WHERE tenant_id = %s AND workspace_id = %s", scope
        )
        conn.execute(
            "DELETE FROM ioc_entry WHERE tenant_id = %s AND workspace_id = %s", scope
        )
        conn.execute(
            "DELETE FROM ioc_pack WHERE tenant_id = %s AND workspace_id = %s", scope
        )
        conn.execute(
            "DELETE FROM uploads WHERE tenant_id = %s AND workspace_id = %s", scope
        )
        conn.execute(
            "DELETE FROM detection_runs WHERE tenant_id = %s AND workspace_id = %s",
            scope,
        )
        conn.execute(
            "DELETE FROM rules WHERE tenant_id = %s AND workspace_id = %s"
            "   AND rule_id = %s",
            (*scope, RULE_ID),
        )
        conn.execute(
            "DELETE FROM rule_source WHERE tenant_id = %s AND workspace_id = %s"
            "   AND rule_id = %s",
            (*scope, RULE_ID),
        )
        conn.commit()


@pytest.fixture
def workspace(app_settings):
    _purge(app_settings)
    yield app_settings
    _purge(app_settings)


def _sign(priv, body: dict[str, Any]) -> str:
    canon = json.dumps(
        {"name": body["name"], "version": body["version"], "indicators": body["indicators"]},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return base64.b64encode(priv.sign(canon)).decode()


def _pack_body(name: str, version: str, indicators: list[dict[str, str]]) -> dict[str, Any]:
    return {"name": name, "version": version, "indicators": indicators}


def _import_pack(client: Any, body: dict[str, Any], *, signature=None, key_id=None):
    payload = dict(body)
    if signature is not None:
        payload["signature"] = signature
    if key_id is not None:
        payload["signing_key_id"] = key_id
    return client.post(
        f"/v1/workspaces/{WORKSPACE_ID}/ioc-packs",
        json=payload,
        headers={"X-API-Key": KEY_B},
    )


def _audit_rows(settings: Any, action: str = "ioc_import") -> list[dict[str, Any]]:
    with tx(settings.database_worker_url) as conn:
        rows = conn.execute(
            "SELECT outcome, object_id, detail FROM audit_log"
            " WHERE tenant_id = %s AND workspace_id = %s AND action = %s"
            " ORDER BY at DESC",
            (TENANT_ID, WORKSPACE_ID, action),
        ).fetchall()
    return [
        {"outcome": r[0], "object_id": str(r[1]), "detail": dict(r[2] or {})}
        for r in rows
    ]


def _ioc_rule_document(digest_sha256: str, *, severity: str = "MEDIUM") -> dict[str, Any]:
    return {
        "schema": "sentinel-rule/v1",
        "id": RULE_ID,
        "kind": "ioc",
        "source": "native",
        "title": "M3 planted IOC match",
        "severity": severity,
        "enabled": True,
        "author": "m3-test",
        "ioc": {
            "packs": [
                {"pack": "m3-intel", "version": "2026.10.0", "digest_sha256": digest_sha256}
            ],
            "match": {
                "fields": ["process.hashes.sha256"],
                "kinds": ["sha256"],
                "normalize": ["hash_lower", "trim"],
            },
            "confirm_exact": True,
            "emit_fields": ["process.hashes.sha256", "process.exe"],
        },
    }


def _import_ioc_rule(client: Any, digest_sha256: str, *, severity: str = "MEDIUM"):
    # Bare-document shape (openapi importRules oneOf; M3-A8).
    return client.post(
        f"/v1/workspaces/{WORKSPACE_ID}/rules",
        json=_ioc_rule_document(digest_sha256, severity=severity),
        headers={"X-API-Key": KEY_B},
    )


def _plant_event(settings: Any, run_id: str, *, sha256_value: str) -> str:
    """Insert one raw_objects → uploads → events chain carrying the hash.

    Returns the event_uid. Uses the worker (BYPASSRLS) connection, same as
    the ingest handler does.
    """
    artifact_id = uuid.uuid4()
    event_uid = uuid.uuid4()
    blob = b"m3-ioc-plant"
    object_sha = hashlib.sha256(blob).digest()
    document = {
        "schema_version": "canonical-event/v1",
        "event": {
            "category": "process",
            "type": "process_create",
            "action": "create",
            "outcome": "success",
            "severity": "informational",
            "derived_by": "source",
        },
        "process": {"exe": "C:\\evil.exe", "hashes": {"sha256": sha256_value}},
        "host": {"hostname": "plant-host"},
        "user": {"name": "plant-user"},
        "source": {"format": "evtx", "parser": "evtx-canonical", "event_id": 1},
    }
    with tx(settings.database_worker_url) as conn:
        conn.execute(
            "INSERT INTO raw_objects (sha256, size, storage_uri, state,"
            "                        retention_until)"
            " VALUES (%s, %s, %s, 'hot', now() + interval '30 days')"
            " ON CONFLICT DO NOTHING",
            (object_sha, len(blob), f"file:///dev/null/{object_sha.hex()}"),
        )
        conn.execute(
            "INSERT INTO uploads (artifact_id, tenant_id, workspace_id, run_id,"
            "                    sha256, size, original_filename, display_name)"
            " VALUES (%s, %s, %s, %s, %s, %s, 'plant.bin', 'plant.bin')",
            (
                artifact_id,
                TENANT_ID,
                WORKSPACE_ID,
                run_id,
                object_sha,
                len(blob),
            ),
        )
        conn.execute(
            "INSERT INTO events (event_uid, tenant_id, workspace_id, run_id,"
            "    artifact_id, event_time_state, event_category, event_type,"
            "    event_action, event_outcome, event_severity, event_derived_by,"
            "    classification, host_hostname, user_name, source_format,"
            "    source_parser, source_record_type, document)"
            " VALUES (%s, %s, %s, %s, %s, 'unknown', 'process', 'process_create',"
            "    'create', 'success', 'informational', 'source', 'internal',"
            "    'plant-host', 'plant-user', 'evtx', 'evtx-canonical',"
            "    'event_record', %s)",
            (
                event_uid,
                TENANT_ID,
                WORKSPACE_ID,
                run_id,
                artifact_id,
                json.dumps(document),
            ),
        )
        conn.commit()
    return str(event_uid)


def _run_detect(settings: Any, run_id: str, *, scope_run_ids: list[str]) -> dict[str, Any]:
    from sentinel_detect.runner import run_detection
    from sentinel_storage import repos_detect

    with tx(settings.database_worker_url) as conn:
        detect_run_id = repos_detect.create_run(
            conn,
            tenant_id=TENANT_ID,
            workspace_id=WORKSPACE_ID,
            requested_by="m3-test",
            scope={"run_ids": scope_run_ids},
            config_hash=hashlib.sha256(b"m3-ioc").digest(),
        )
        result = run_detection(
            conn,
            run_id=detect_run_id,
            tenant_id=TENANT_ID,
            workspace_id=WORKSPACE_ID,
            requested_by="m3-test",
            scope={"run_ids": scope_run_ids},
        )
        conn.commit()
    return result


def _findings(settings: Any) -> list[dict[str, Any]]:
    with tx(settings.database_worker_url) as conn:
        rows = conn.execute(
            "SELECT rule_id, kind, severity, detection_path, reason_codes,"
            "       evidence_snapshot FROM findings"
            " WHERE tenant_id = %s AND workspace_id = %s"
            " ORDER BY time_utc",
            (TENANT_ID, WORKSPACE_ID),
        ).fetchall()
    return [
        {
            "rule_id": str(r[0]),
            "kind": r[1],
            "severity": r[2],
            "detection_path": r[3],
            "reason_codes": list(r[4] or []),
            "evidence": dict(r[5] or {}),
        }
        for r in rows
    ]


def _rule_runs(settings: Any, detect_run_id: str) -> list[dict[str, Any]]:
    with tx(settings.database_worker_url) as conn:
        rows = conn.execute(
            "SELECT rule_id, outcome, findings, reason_codes FROM rule_run"
            " WHERE run_id = %s ORDER BY rule_id",
            (detect_run_id,),
        ).fetchall()
    return [
        {
            "rule_id": str(r[0]),
            "outcome": r[1],
            "findings": int(r[2]),
            "reason_codes": list(r[3] or []),
        }
        for r in rows
    ]


def _pack_status(settings: Any, pack_id: str) -> str | None:
    with tx(settings.database_worker_url) as conn:
        row = conn.execute(
            "SELECT status FROM ioc_pack WHERE pack_id = %s", (pack_id,)
        ).fetchone()
    return row[0] if row else None


def _entry_count(settings: Any, pack_id: str) -> int:
    with tx(settings.database_worker_url) as conn:
        row = conn.execute(
            "SELECT count(*) FROM ioc_entry WHERE pack_id = %s", (pack_id,)
        ).fetchone()
    return int(row[0])


# ---------------------------------------------------------------------------
# exit ② — verification posture
# ---------------------------------------------------------------------------


def test_signed_pack_activates_and_ingests_entries(workspace, client, keypair, trust_store):
    priv, _ = keypair
    body = _pack_body(
        "m3-intel", "2026.10.0", [{"kind": "sha256", "value": PLANTED_HASH}]
    )
    resp = _import_pack(client, body, signature=_sign(priv, body), key_id="m3-test-key")
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "active"
    assert data["digest_sha256"]  # order-insensitive digest for rule pinning
    assert _entry_count(workspace, data["pack_id"]) == 1
    audits = _audit_rows(workspace)
    assert audits and audits[0]["outcome"] == "ok"


def test_unsigned_pack_is_rejected_and_audited(workspace, client):
    """Exit ②: unsigned → rejected + audit row + zero entries."""
    body = _pack_body(
        "m3-intel", "2026.10.0", [{"kind": "sha256", "value": PLANTED_HASH}]
    )
    resp = _import_pack(client, body)
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "rejected"
    assert data["verify_error"]
    assert _entry_count(workspace, data["pack_id"]) == 0
    audits = _audit_rows(workspace)
    assert audits, "rejected import must leave an audit row (exit ②)"
    assert audits[0]["outcome"] == "error"  # frozen audit vocabulary
    assert "unsigned" in audits[0]["detail"].get("verify_error", "")


def test_tampered_signature_is_rejected(workspace, client, keypair, trust_store):
    priv, _ = keypair
    body = _pack_body(
        "m3-intel", "2026.10.0", [{"kind": "sha256", "value": PLANTED_HASH}]
    )
    sig = _sign(priv, body)
    raw = bytearray(base64.b64decode(sig))
    raw[0] ^= 0xFF
    resp = _import_pack(
        client, body, signature=base64.b64encode(bytes(raw)).decode(), key_id="m3-test-key"
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "rejected"
    assert _audit_rows(workspace)[0]["outcome"] == "error"


def test_unknown_signing_key_is_rejected(workspace, client, keypair, trust_store):
    priv, _ = keypair
    body = _pack_body(
        "m3-intel", "2026.10.0", [{"kind": "sha256", "value": PLANTED_HASH}]
    )
    resp = _import_pack(client, body, signature=_sign(priv, body), key_id="ghost")
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "rejected"
    assert "ghost" in data["verify_error"]
    assert _entry_count(workspace, data["pack_id"]) == 0


def test_expired_key_is_rejected(workspace, client, keypair, expired_store):
    priv, _ = keypair
    body = _pack_body(
        "m3-intel", "2026.10.0", [{"kind": "sha256", "value": PLANTED_HASH}]
    )
    resp = _import_pack(
        client, body, signature=_sign(priv, body), key_id="m3-expired-key"
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "rejected"
    assert _audit_rows(workspace)[0]["outcome"] == "error"


def test_duplicate_version_keeps_last_known_good(workspace, client, keypair, trust_store):
    priv, _ = keypair
    body = _pack_body(
        "m3-intel", "2026.10.0", [{"kind": "sha256", "value": PLANTED_HASH}]
    )
    ok = _import_pack(client, body, signature=_sign(priv, body), key_id="m3-test-key")
    assert ok.json()["status"] == "active"
    pack_id = ok.json()["pack_id"]

    # A bad-signature re-import of the same (name, version) must not clobber.
    bad = _import_pack(client, body, signature="A" * 64, key_id="m3-test-key")
    assert bad.status_code == 409
    assert _pack_status(workspace, pack_id) == "active"
    assert _entry_count(workspace, pack_id) == 1
    # The denied attempt is itself audited.
    assert any(
        a["outcome"] == "error" and a["object_id"] == pack_id
        for a in _audit_rows(workspace)
    )


def test_retired_pack_stops_being_active(workspace, client, keypair, trust_store):
    priv, _ = keypair
    body = _pack_body(
        "m3-intel", "2026.10.0", [{"kind": "sha256", "value": PLANTED_HASH}]
    )
    ok = _import_pack(client, body, signature=_sign(priv, body), key_id="m3-test-key")
    pack_id = ok.json()["pack_id"]
    resp = client.delete(
        f"/v1/workspaces/{WORKSPACE_ID}/ioc-packs/{pack_id}",
        headers={"X-API-Key": KEY_B},
    )
    assert resp.status_code == 204
    assert _pack_status(workspace, pack_id) == "retired"
    assert _audit_rows(workspace, action="ioc_retire")[0]["outcome"] == "ok"


# ---------------------------------------------------------------------------
# exit ① slice — detector-time membership + cold-start codes
# ---------------------------------------------------------------------------


def test_planted_event_produces_ioc_finding(workspace, client, keypair, trust_store):
    priv, _ = keypair
    body = _pack_body(
        "m3-intel", "2026.10.0", [{"kind": "sha256", "value": PLANTED_HASH}]
    )
    ok = _import_pack(client, body, signature=_sign(priv, body), key_id="m3-test-key")
    digest = ok.json()["digest_sha256"]

    rule = _import_ioc_rule(client, digest)
    assert rule.status_code == 200, rule.text
    assert rule.json()["results"][0]["outcome"] == "OK"

    harvest_run = str(uuid.uuid4())
    _plant_event(workspace, harvest_run, sha256_value=PLANTED_HASH.upper())
    result = _run_detect(workspace, "detect-plant", scope_run_ids=[harvest_run])

    findings = _findings(workspace)
    assert len(findings) == 1, f"expected exactly 1 finding, got {len(findings)}"
    f = findings[0]
    assert f["kind"] == "ioc"
    assert f["detection_path"] == "native"
    ioc_ev = f["evidence"].get("ioc") or {}
    assert ioc_ev.get("value") == PLANTED_HASH
    assert ioc_ev.get("pack") == "m3-intel"
    assert ioc_ev.get("field") == "process.hashes.sha256"

    runs = _rule_runs(workspace, result["run_id"])
    assert runs[0]["findings"] == 1
    assert runs[0]["outcome"] == "ok"


def test_missing_pack_is_ok_partial_not_silent(workspace, client, keypair, trust_store):
    priv, _ = keypair
    body = _pack_body(
        "m3-intel", "2026.10.0", [{"kind": "sha256", "value": PLANTED_HASH}]
    )
    ok = _import_pack(client, body, signature=_sign(priv, body), key_id="m3-test-key")
    digest = ok.json()["digest_sha256"]
    _import_ioc_rule(client, digest)

    # Point the stored rule at a pack version that was never imported.
    with tx(workspace.database_worker_url) as conn:
        conn.execute(
            "UPDATE rules SET document = jsonb_set(document, '{ioc,packs}',"
            "  %s::jsonb)"
            " WHERE rule_id = %s",
            (
                json.dumps(
                    [{"pack": "m3-intel", "version": "GONE", "digest_sha256": digest}]
                ),
                RULE_ID,
            ),
        )
        conn.commit()

    harvest_run = str(uuid.uuid4())
    result = _run_detect(workspace, "detect-missing", scope_run_ids=[harvest_run])
    runs = _rule_runs(workspace, result["run_id"])
    assert runs[0]["outcome"] == "ok_partial"
    assert "IOC_PACK_MISSING" in runs[0]["reason_codes"]
    assert result["status"] == "completed_with_warnings"


def test_stale_pack_suppresses_low_fires_medium(workspace, client, keypair, trust_store):
    priv, _ = keypair
    body = _pack_body(
        "m3-intel", "2026.10.0", [{"kind": "sha256", "value": PLANTED_HASH}]
    )
    ok = _import_pack(client, body, signature=_sign(priv, body), key_id="m3-test-key")
    digest = ok.json()["digest_sha256"]
    _import_ioc_rule(client, digest, severity="LOW")

    # Age the pack past the §6.4 freshness gate.
    with tx(workspace.database_worker_url) as conn:
        conn.execute(
            "UPDATE ioc_pack SET imported_at = now() - interval '10 days'"
            " WHERE name = 'm3-intel'",
        )
        conn.commit()

    harvest_run = str(uuid.uuid4())
    _plant_event(workspace, harvest_run, sha256_value=PLANTED_HASH)
    result = _run_detect(workspace, "detect-stale-low", scope_run_ids=[harvest_run])

    assert _findings(workspace) == [], "LOW finding must be suppressed on a stale pack"
    runs = _rule_runs(workspace, result["run_id"])
    assert "IOC_PACK_STALE" in runs[0]["reason_codes"]
    assert runs[0]["outcome"] == "ok_partial"

    # MEDIUM+ still fires on the same stale pack.
    _purge_findings_only(workspace)
    _import_ioc_rule(client, digest, severity="MEDIUM")
    with tx(workspace.database_worker_url) as conn:
        conn.execute(
            "UPDATE ioc_pack SET imported_at = now() - interval '10 days'"
            " WHERE name = 'm3-intel'",
        )
        conn.execute(
            "UPDATE rules SET enabled = true WHERE rule_id = %s AND severity = 'LOW'",
            (RULE_ID,),
        )
        # Both severities now exist under one rule_id — keep only the MEDIUM.
        conn.execute(
            "DELETE FROM rules WHERE rule_id = %s AND severity = 'LOW'", (RULE_ID,)
        )
        conn.commit()
    result2 = _run_detect(workspace, "detect-stale-med", scope_run_ids=[harvest_run])
    findings = _findings(workspace)
    assert len(findings) == 1
    assert findings[0]["severity"] == "MEDIUM"
    runs2 = _rule_runs(workspace, result2["run_id"])
    assert "IOC_PACK_STALE" in runs2[0]["reason_codes"]


def _purge_findings_only(settings: Any) -> None:
    with tx(settings.database_worker_url) as conn:
        conn.execute(
            "DELETE FROM findings WHERE tenant_id = %s AND workspace_id = %s",
            (TENANT_ID, WORKSPACE_ID),
        )
        conn.execute(
            "DELETE FROM rule_run WHERE run_id IN ("
            "  SELECT run_id FROM detection_runs"
            "   WHERE tenant_id = %s AND workspace_id = %s)",
            (TENANT_ID, WORKSPACE_ID),
        )
        conn.commit()


def test_rejected_pack_never_reaches_detection(workspace, client, keypair):
    """A rejected pack's (name, version) is absent from the active set, so a
    rule pinned to it degrades to IOC_PACK_MISSING — unverified data can
    never produce a finding."""
    body = _pack_body(
        "m3-intel", "2026.10.0", [{"kind": "sha256", "value": PLANTED_HASH}]
    )
    rejected = _import_pack(client, body)  # unsigned → rejected
    assert rejected.json()["status"] == "rejected"
    # digest the RULE would pin had it been trusted:
    digest = rejected.json()["digest_sha256"]
    _import_ioc_rule(client, digest)

    harvest_run = str(uuid.uuid4())
    _plant_event(workspace, harvest_run, sha256_value=PLANTED_HASH)
    result = _run_detect(workspace, "detect-rejected", scope_run_ids=[harvest_run])

    assert _findings(workspace) == [], "rejected pack must never fire"
    runs = _rule_runs(workspace, result["run_id"])
    assert "IOC_PACK_MISSING" in runs[0]["reason_codes"]
