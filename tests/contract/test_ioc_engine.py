"""IOC engine contract tests (Stage-5 §6) — no database required.

Covers the pure functions M3's exit criteria lean on:

* Bloom prefilter has no false negatives (Stage-A contract: only Stage-B
  may reject);
* ``normalize_indicator`` rejects malformed values at load, not at match
  (§6.1);
* Ed25519 verification is fail-closed (D4-003): unsigned, unknown key,
  expired key, bad signature → ``PackLoadError``, never a silent pass;
* ``resolve_pack_refs`` produces the registered cold-start codes
  ``IOC_PACK_MISSING`` / ``IOC_PACK_STALE`` (§4.8 / §6.4, M3-A7 allowlist);
* two-stage membership emits only exact-confirm hits (Bloom false positives
  never become findings), and stale packs suppress LOW but not MEDIUM (§6.4).
"""
from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest
from unittest.mock import patch

from sentinel_detect.ioc_engine import (
    IOC_PACK_MISSING,
    IOC_PACK_STALE,
    BloomFilter,
    PackIndex,
    PackLoadError,
    build_pack_index,
    evaluate_ioc_rule,
    load_trusted_keys,
    normalize_indicator,
    pack_entries_digest,
    resolve_pack_refs,
    verify_pack_signature,
)

NOW = datetime(2026, 10, 13, 12, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Bloom prefilter (Stage-A contract)
# ---------------------------------------------------------------------------


def test_bloom_has_no_false_negatives():
    keys = [hashlib.sha256(f"item-{i}".encode()).digest() for i in range(500)]
    bloom = BloomFilter(expected_items=len(keys))
    for k in keys:
        bloom.add(k)
    missing = [k for k in keys if not bloom.might_contain(k)]
    assert missing == [], f"Bloom produced {len(missing)} false negatives"


def test_bloom_false_positive_rate_is_bounded():
    # §6.2 sizing: k=6, 10 bits/entry → FPP ≈ 1%. Assert a loose 10% bound
    # so the test is stable but catches a broken hash/size.
    present = [hashlib.sha256(f"in-{i}".encode()).digest() for i in range(2000)]
    absent = [hashlib.sha256(f"out-{i}".encode()).digest() for i in range(2000)]
    bloom = BloomFilter(expected_items=len(present))
    for k in present:
        bloom.add(k)
    fp = sum(1 for k in absent if bloom.might_contain(k))
    assert fp / len(absent) < 0.10


# ---------------------------------------------------------------------------
# load-path normalization (§6.1)
# ---------------------------------------------------------------------------


def test_normalize_hash_lowercases_and_accepts_valid_lengths():
    h = "A" * 64
    assert normalize_indicator("sha256", h) == "a" * 64
    assert normalize_indicator("sha1", "B" * 40) == "b" * 40
    assert normalize_indicator("md5", "c" * 32) == "c" * 32


@pytest.mark.parametrize(
    "kind,value",
    [
        ("sha256", "z" * 64),       # non-hex
        ("sha256", "a" * 63),       # wrong length
        ("sha1", "a" * 64),         # sha256-length in a sha1 slot
        ("domain", "not a domain"),
        ("domain", ""),
        ("ipv4", "999.1.1.1"),
        ("ipv6", "gg::1"),
        ("url", "no-scheme-here"),
        ("bogus", "x"),
    ],
)
def test_normalize_rejects_invalid_at_load(kind, value):
    with pytest.raises(ValueError):
        normalize_indicator(kind, value)


def test_normalize_domain_strips_trailing_dot_and_lowercases():
    assert normalize_indicator("domain", "Bad.Example.") == "bad.example"


def test_normalize_ipv4_canonicalizes():
    # ipaddress rejects leading zeros ("203.000.013.007" → ValueError, an
    # intentional octal-ambiguity guard); canonical form of a valid address:
    assert normalize_indicator("ipv4", "203.0.113.7") == "203.0.113.7"


def test_normalize_ipv6_canonicalizes():
    assert normalize_indicator("ipv6", "2001:0DB8:0000::0001") == "2001:db8::1"


def test_normalize_ipv4_rejects_leading_zeros():
    with pytest.raises(ValueError):
        normalize_indicator("ipv4", "203.000.013.007")


def test_pack_entries_digest_is_order_insensitive():
    a = [
        {"kind": "sha256", "value": "a" * 64},
        {"kind": "domain", "value": "bad.example"},
    ]
    b = list(reversed(a))
    assert pack_entries_digest(a) == pack_entries_digest(b)


# ---------------------------------------------------------------------------
# Ed25519 verification (D4-003) — fail-closed
# ---------------------------------------------------------------------------


def _keypair():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes_raw()
    return priv, pub


def _trust(pub_raw: bytes, *, key_id: str = "test-key", expires: datetime | None = None):
    from sentinel_detect.ioc_engine import TrustedKey

    return {key_id: TrustedKey(key_id, pub_raw, None, expires)}


def test_valid_signature_verifies():
    priv, pub = _keypair()
    payload = b'{"name":"p","version":"1","indicators":[]}'
    sig = base64.b64encode(priv.sign(payload)).decode()
    verify_pack_signature(payload, sig, "test-key", _trust(pub), now=NOW)


def test_unsigned_pack_fails_closed():
    with pytest.raises(PackLoadError, match="unsigned"):
        verify_pack_signature(b"{}", None, None, {}, now=NOW)


def test_unknown_key_id_fails():
    priv, pub = _keypair()
    payload = b"{}"
    sig = base64.b64encode(priv.sign(payload)).decode()
    with pytest.raises(PackLoadError, match="unknown signing key"):
        verify_pack_signature(payload, sig, "nope", _trust(pub), now=NOW)


def test_expired_key_fails():
    priv, pub = _keypair()
    payload = b"{}"
    sig = base64.b64encode(priv.sign(payload)).decode()
    trust = _trust(pub, expires=NOW - timedelta(days=1))
    with pytest.raises(PackLoadError, match="not valid"):
        verify_pack_signature(payload, sig, "test-key", trust, now=NOW)


def test_tampered_payload_fails():
    priv, pub = _keypair()
    sig = base64.b64encode(priv.sign(b"original")).decode()
    with pytest.raises(PackLoadError, match="verification failed"):
        verify_pack_signature(b"tampered", sig, "test-key", _trust(pub), now=NOW)


def test_trusted_keys_loader_accepts_object_and_list_forms(tmp_path):
    _, pub = _keypair()
    b64 = base64.b64encode(pub).decode()
    obj = tmp_path / "obj.json"
    obj.write_text(json.dumps({"keys": [{"key_id": "k1", "public_key": b64}]}))
    lst = tmp_path / "lst.json"
    lst.write_text(json.dumps([{"key_id": "k2", "public_key": b64}]))
    assert set(load_trusted_keys(obj)) == {"k1"}
    assert set(load_trusted_keys(lst)) == {"k2"}
    # missing file → empty trust store (fail-closed default)
    assert load_trusted_keys(tmp_path / "none.json") == {}


# ---------------------------------------------------------------------------
# pack resolution + cold-start codes (§4.8 / §6.4)
# ---------------------------------------------------------------------------


def _index(name="intel", version="1.0", digest="d" * 64, age_days=0, entries=None):
    entries = entries or [{"kind": "sha256", "value": "a" * 64, "value_norm": "a" * 64}]
    idx = build_pack_index(
        {
            "pack_id": "p1",
            "name": name,
            "version": version,
            "digest_sha256": digest,
            "imported_at": NOW - timedelta(days=age_days),
        },
        entries,
    )
    return idx


def test_missing_pack_yields_missing_code_and_rule_continues():
    idx = _index()
    indexes, codes, stale = resolve_pack_refs(
        [{"pack": "other", "version": "9.9", "digest_sha256": "x" * 64}],
        {("intel", "1.0"): idx},
    )
    assert indexes == []
    assert codes == [IOC_PACK_MISSING]
    assert stale is False  # missing ≠ stale; job continues either way


def test_digest_mismatch_yields_stale():
    idx = _index(digest="d" * 64)
    indexes, codes, stale = resolve_pack_refs(
        [{"pack": "intel", "version": "1.0", "digest_sha256": "e" * 64}],
        {("intel", "1.0"): idx},
    )
    assert len(indexes) == 1  # last-known-good retained
    assert codes == [IOC_PACK_STALE]
    assert stale is True


def test_old_pack_yields_stale():
    idx = _index(age_days=10)
    _, codes, stale = resolve_pack_refs(
        [{"pack": "intel", "version": "1.0", "digest_sha256": idx.entries_digest}],
        {("intel", "1.0"): idx},
    )
    assert codes == [IOC_PACK_STALE]
    assert stale is True


def test_fresh_pack_resolves_clean():
    with patch('sentinel_detect.ioc_engine.datetime') as mock_dt:
        mock_dt.now.return_value = NOW
        mock_dt.side_effect = lambda *args, **kw: datetime(*args, **kw)
        idx = _index()
        indexes, codes, stale = resolve_pack_refs(
            [{"pack": "intel", "version": "1.0", "digest_sha256": idx.entries_digest}],
            {("intel", "1.0"): idx},
        )
        assert len(indexes) == 1
        assert codes == []
        assert stale is False


# ---------------------------------------------------------------------------
# two-stage membership (§6.2/§6.3)
# ---------------------------------------------------------------------------


def _event(doc, when=NOW):
    return ("uid-1", doc, "host-a", "user-a", when)


def _ioc_doc(severity="MEDIUM"):
    return {
        "kind": "ioc",
        "severity": severity,
        "ioc": {
            "packs": [{"pack": "intel", "version": "1.0", "digest_sha256": "d" * 64}],
            "match": {
                "fields": ["process.hashes.sha256"],
                "kinds": ["sha256"],
                "normalize": ["hash_lower", "trim"],
            },
            "confirm_exact": True,
        },
    }


def test_exact_hash_match_emits_finding():
    idx = _index()
    doc = _ioc_doc()
    events = [_event({"process": {"hashes": {"sha256": "A" * 64}}})]
    matches, suppressed = evaluate_ioc_rule(doc, [idx], events)
    assert not suppressed
    assert len(matches) == 1
    assert matches[0].indicator_value == "a" * 64
    assert matches[0].matched_field == "process.hashes.sha256"


def test_non_member_hash_does_not_match():
    idx = _index()
    events = [_event({"process": {"hashes": {"sha256": "b" * 64}}})]
    matches, _ = evaluate_ioc_rule(_ioc_doc(), [idx], events)
    assert matches == []


def test_bloom_false_positive_is_rejected_by_stage_b():
    # Force a Bloom-only hit: an index whose Bloom contains a key that is not
    # in the exact set (simulates the 1% FPP case). Stage B must reject it.
    idx = _index()
    ghost = hashlib.sha256(("c" * 64).encode()).digest()
    idx.blooms["sha256"].add(ghost)
    assert idx.blooms["sha256"].might_contain(ghost)
    assert idx.exact("sha256", "c" * 64) is None
    events = [_event({"process": {"hashes": {"sha256": "c" * 64}}})]
    matches, _ = evaluate_ioc_rule(_ioc_doc(), [idx], events)
    assert matches == [], "Bloom false positive leaked through Stage-B confirm"


def test_stale_pack_suppresses_low_but_not_medium():
    idx = _index()
    events = [_event({"process": {"hashes": {"sha256": "a" * 64}}})]
    low_matches, low_suppressed = evaluate_ioc_rule(
        _ioc_doc(severity="LOW"), [idx], events, stale=True
    )
    assert low_matches == []
    assert low_suppressed is True
    med_matches, med_suppressed = evaluate_ioc_rule(
        _ioc_doc(severity="MEDIUM"), [idx], events, stale=True
    )
    assert len(med_matches) == 1
    assert med_suppressed is False


def test_domain_subdomain_suffix_matches():
    idx = build_pack_index(
        {
            "pack_id": "p1",
            "name": "intel",
            "version": "1.0",
            "digest_sha256": "d" * 64,
            "imported_at": NOW,
        },
        [{"kind": "domain", "value_norm": "bad.example"}],
    )
    doc = {
        "kind": "ioc",
        "severity": "MEDIUM",
        "ioc": {
            "packs": [],
            "match": {"fields": ["dns.query_name"], "kinds": ["domain"]},
        },
    }
    events = [
        _event({"dns": {"query_name": "x.bad.example"}}),
        _event({"dns": {"query_name": "good.example"}}),
    ]
    matches, _ = evaluate_ioc_rule(doc, [idx], events)
    assert len(matches) == 1
    # Evidence names the REGISTERED indicator plus the observed subdomain.
    assert matches[0].indicator_value == "bad.example"
    assert matches[0].observed == "x.bad.example"


def test_state_object_values_never_match():
    # canonical str_or_state: {"$state": "..."} must not be coerced to text.
    idx = _index()
    events = [_event({"process": {"hashes": {"sha256": {"$state": "absent"}}}})]
    matches, _ = evaluate_ioc_rule(_ioc_doc(), [idx], events)
    assert matches == []
