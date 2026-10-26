"""IOC pack engine (Stage-5 §6): Ed25519 verify, two-stage membership, freshness.

Indicator **values never live in rule documents** (D5-007). They live in
signed ``ioc_pack/v1`` documents; rules reference packs by (name, version,
digest). This module owns:

* ``verify_pack_signature`` — Stage-4 D4-003 Ed25519 detached verification
  over the canonical pack bytes, against a workspace trust store of keys.
* ``normalize_indicator`` / ``pack_entries_digest`` — load-path normalization
  (lowercase domains, canonical IPs, hash-lower) and the digest the rule's
  ``digest_sha256`` pins.
* ``PackIndex`` — Stage-A Bloom prefilter (stdlib blake2b, k=6, ~10 bits per
  entry) + Stage-B exact confirm, per (pack, kind). Only Stage B may emit a
  finding; the Bloom layer can never produce a false positive on its own.
* ``evaluate_ioc_rule`` — the detector-time pass: map each event's canonical
  field paths to indicator kinds, run two-stage membership, emit findings.
* ``PackLoadError`` — a pack that fails verification or digest check is
  *rejected*, never silently dropped (§6.4); the caller records it as a
  reason code and keeps the last-known-good pack.

Cold-start reason codes emitted here (registered in the tripwire allowlist,
M3-A7): ``IOC_PACK_MISSING`` (rule names a pack that is absent or not
``active``), ``IOC_PACK_STALE`` (pack older than the §6.4 freshness gate, or
a digest mismatch against the rule's pinned ``digest_sha256``).
"""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

__all__ = [
    "IOC_PACK_MISSING",
    "IOC_PACK_STALE",
    "FRESHNESS_DAYS",
    "BloomFilter",
    "PackEntry",
    "PackIndex",
    "PackLoadError",
    "TrustedKey",
    "IocMatch",
    "normalize_indicator",
    "pack_entries_digest",
    "load_trusted_keys",
    "trusted_keys_path",
    "verify_pack_signature",
    "build_pack_index",
    "load_active_pack_indexes",
    "resolve_pack_refs",
    "evaluate_ioc_rule",
]

# §6.4 freshness gate. "PROPOSED: 7 days" in the spec — a governance knob,
# not a detection constant (it decides when a *pack* is stale, never whether
# an *event* matches).
FRESHNESS_DAYS = 7

IOC_PACK_MISSING = "IOC_PACK_MISSING"
IOC_PACK_STALE = "IOC_PACK_STALE"

# §6.2 Stage-A sizing: k=6, ~10 bits/entry → FPP ≈ 1%. The spec marks the
# sizing PROPOSED-TO-BENCHMARK; these are the shipped defaults.
_BLOOM_K = 6
_BITS_PER_ENTRY = 10

_HASH_KIND_LENGTHS = {"sha256": 64, "sha1": 40, "md5": 32}
_HEX_RE = re.compile(r"^[0-9a-f]+$")
# Conservative domain charset (LDH + optional trailing dot we strip); the
# pack loader rejects anything else rather than deferring to match time.
_DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$"
)


class PackLoadError(ValueError):
    """A pack document failed verification, digest, or entry validation."""


# ---------------------------------------------------------------------------
# normalization + digest (load path, §6.1)
# ---------------------------------------------------------------------------


def normalize_indicator(kind: str, value: str) -> str:
    """Canonical form for one indicator value (§6.1 load path).

    Raises ``ValueError`` for anything a pack should have rejected at load,
    not at match time (wrong-length hash, malformed IP/domain/URL).
    """
    if not isinstance(value, str):
        raise ValueError(f"{kind}: value must be a string")
    v = value.strip()
    if not v:
        raise ValueError(f"{kind}: value is empty")
    if kind in _HASH_KIND_LENGTHS:
        v = v.lower()
        want = _HASH_KIND_LENGTHS[kind]
        if len(v) != want or not _HEX_RE.match(v):
            raise ValueError(f"{kind}: expected {want} hex chars, got {len(v)}")
        return v
    if kind == "domain":
        v = v.lower().rstrip(".")
        if not _DOMAIN_RE.match(v):
            raise ValueError(f"domain: not a valid hostname: {value!r}")
        return v
    if kind in ("ipv4", "ipv6"):
        try:
            return str(ipaddress.ip_address(v))
        except ValueError as exc:
            raise ValueError(f"{kind}: not a valid IP: {value!r}") from exc
    if kind == "url":
        if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", v):
            raise ValueError(f"url: missing scheme: {value!r}")
        return v
    raise ValueError(f"unknown indicator kind: {kind!r}")


def pack_entries_digest(entries: Sequence[Mapping[str, Any]]) -> str:
    """sha256 over the canonical (kind, normalized-value) pair list.

    Order-insensitive: entries are sorted so two packs with the same set in a
    different order share a digest. This is the digest a rule's
    ``digest_sha256`` pins.
    """
    pairs = sorted(
        (str(e["kind"]), normalize_indicator(str(e["kind"]), str(e["value"])))
        for e in entries
    )
    canon = json.dumps(pairs, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Stage-A Bloom prefilter (§6.2) — stdlib only, no third-party dependency
# ---------------------------------------------------------------------------


class BloomFilter:
    """k=6 blake2b Bloom filter over 64-bit keys.

    Uses double hashing: h_i = h1 + i*h2 (mod m), a standard optimization of
    deriving k independent hashes from two. ``might_contain`` may be a false
    positive; ``add`` never produces a false negative for keys added.
    """

    def __init__(self, expected_items: int, k: int = _BLOOM_K) -> None:
        bits = max(64, expected_items * _BITS_PER_ENTRY)
        self.m = 1 << (bits - 1).bit_length()  # round up to a power of two
        self.k = k
        self._bits = bytearray(self.m // 8)

    def _positions(self, key: bytes) -> Iterable[int]:
        d = hashlib.blake2b(key, digest_size=16).digest()
        h1 = int.from_bytes(d[:8], "big")
        h2 = int.from_bytes(d[8:], "big") | 1  # force odd → full period mod 2^n
        for i in range(self.k):
            yield (h1 + i * h2) % self.m

    def add(self, key: bytes) -> None:
        for pos in self._positions(key):
            self._bits[pos >> 3] |= 1 << (pos & 7)

    def might_contain(self, key: bytes) -> bool:
        return all(
            self._bits[pos >> 3] & (1 << (pos & 7)) for pos in self._positions(key)
        )


# ---------------------------------------------------------------------------
# pack index (Stage-B exact structures + Stage-A prefilter)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PackEntry:
    kind: str
    value_norm: str
    value_hash: bytes


@dataclass
class PackIndex:
    """One active pack's in-memory membership structures, per kind."""

    pack_id: str
    name: str
    version: str
    digest_sha256: str  # document digest (sha256 of the submitted canon JSON)
    imported_at: datetime | None
    entries_digest: str = ""  # order-insensitive entries digest (rule pin target)
    entries_by_kind: dict[str, dict[str, PackEntry]] = field(default_factory=dict)
    blooms: dict[str, BloomFilter] = field(default_factory=dict)

    @property
    def is_stale(self) -> bool:
        if self.imported_at is None:
            return True
        age = datetime.now(timezone.utc) - self.imported_at
        return age.total_seconds() > FRESHNESS_DAYS * 86400

    def bloom_for(self, kind: str) -> BloomFilter | None:
        return self.blooms.get(kind)

    def exact(self, kind: str, value_norm: str) -> PackEntry | None:
        return self.entries_by_kind.get(kind, {}).get(value_norm)


def build_pack_index(
    pack_row: Mapping[str, Any], entries: Sequence[Mapping[str, Any]]
) -> PackIndex:
    """Build the two-stage structures for one pack from its stored rows.

    ``pack_row`` needs pack_id/name/version/sha256 (hex)/imported_at.
    ``entries`` rows need kind + value_norm (+ value_hash bytea, recomputed
    if absent).
    """
    idx = PackIndex(
        pack_id=str(pack_row["pack_id"]),
        name=str(pack_row["name"]),
        version=str(pack_row["version"]),
        digest_sha256=str(pack_row.get("digest_sha256") or ""),
        imported_at=pack_row.get("imported_at"),
    )
    # Group first so we can size each Bloom to its own kind's cardinality.
    grouped: dict[str, dict[str, PackEntry]] = {}
    for e in entries:
        kind = str(e["kind"])
        norm = str(e["value_norm"])
        vh = e.get("value_hash")
        if vh is None:
            vh = hashlib.sha256(norm.encode("utf-8")).digest()
        grouped.setdefault(kind, {})[norm] = PackEntry(kind, norm, bytes(vh))
    idx.entries_by_kind = grouped
    # The digest a rule's ``digest_sha256`` pins: order-insensitive over the
    # normalized (kind, value) pairs, so re-importing the same indicator set
    # in a different order yields the same pin.
    idx.entries_digest = pack_entries_digest(
        [
            {"kind": e.kind, "value": e.value_norm}
            for by_norm in grouped.values()
            for e in by_norm.values()
        ]
    )
    for kind, by_norm in grouped.items():
        bloom = BloomFilter(expected_items=max(1, len(by_norm)))
        for entry in by_norm.values():
            # Bloom keys on the exact-confirm hash so Stage A and Stage B are
            # keyed identically (one normalize → one key).
            bloom.add(entry.value_hash)
        idx.blooms[kind] = bloom
    return idx


# ---------------------------------------------------------------------------
# signature verification (D4-003) + trust store
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TrustedKey:
    key_id: str
    public_raw: bytes  # 32-byte Ed25519 public key
    not_before: datetime | None = None
    not_after: datetime | None = None

    def active_at(self, when: datetime) -> bool:
        if self.not_before and when < self.not_before:
            return False
        if self.not_after and when > self.not_after:
            return False
        return True


def load_trusted_keys(path: Path | str | None = None) -> dict[str, TrustedKey]:
    """Read the workspace trust store: JSON list of
    ``{key_id, algorithm, public_key, not_before, not_after}``.

    ``public_key`` is base64 (standard, unpadded-ok) of the raw 32-byte key.
    An empty or missing file is a valid *empty* trust store — every pack then
    fails verification, which is the safe default (never trust-by-absence).
    """
    if path is None:
        return {}
    p = Path(path)
    if not p.is_file():
        return {}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if isinstance(doc, Mapping):
        doc = doc.get("keys", [])
    keys: dict[str, TrustedKey] = {}
    for item in doc if isinstance(doc, list) else []:
        if not isinstance(item, Mapping):
            continue
        key_id = str(item.get("key_id") or "")
        if not key_id:
            continue
        algo = str(item.get("algorithm") or "ed25519").lower()
        if algo != "ed25519":
            continue  # unknown algorithm → not trusted
        try:
            raw = base64.b64decode(str(item.get("public_key") or ""), validate=True)
        except Exception:
            continue
        if len(raw) != 32:
            continue
        nb = _parse_ts(item.get("not_before"))
        na = _parse_ts(item.get("not_after"))
        keys[key_id] = TrustedKey(key_id, raw, nb, na)
    return keys


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def verify_pack_signature(
    pack_bytes: bytes,
    signature_b64: str | None,
    signing_key_id: str | None,
    trusted_keys: Mapping[str, TrustedKey],
    *,
    now: datetime | None = None,
) -> None:
    """D4-003 detached Ed25519 verification. Raises ``PackLoadError``.

    A missing signature, an unknown/expired key, a bad key length, or a
    failed verify all raise — the caller turns that into ``rejected`` status
    plus an audit row (exit ②). Never returns a boolean: "unverified" is not
    a state we allow through.
    """
    now = now or datetime.now(timezone.utc)
    if not signature_b64:
        raise PackLoadError("pack has no signature (unsigned)")
    if not signing_key_id:
        raise PackLoadError("pack signature has no signing_key_id")
    key = trusted_keys.get(str(signing_key_id))
    if key is None:
        raise PackLoadError(f"unknown signing key id: {signing_key_id!r}")
    if not key.active_at(now):
        raise PackLoadError(f"signing key {signing_key_id!r} not valid at {now.isoformat()}")
    try:
        sig = base64.b64decode(signature_b64, validate=True)
    except Exception as exc:
        raise PackLoadError("signature is not valid base64") from exc
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PublicKey,
    )

    try:
        pub = Ed25519PublicKey.from_public_bytes(key.public_raw)
        pub.verify(sig, pack_bytes)
    except InvalidSignature as exc:
        raise PackLoadError("Ed25519 signature verification failed") from exc


# ---------------------------------------------------------------------------
# detector-time evaluation (§6.3)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class IocMatch:
    """One (event, matched indicator) pair — feeds _emit_finding."""

    event_uid: Any
    event: Mapping[str, Any]
    finding_time: datetime
    host_hostname: str | None
    user_name: str | None
    pack_name: str
    indicator_kind: str
    indicator_value: str  # the REGISTERED value that matched (pack side)
    observed: str  # the event's normalized field value (may be a subdomain)
    matched_field: str


def _normalize_for_match(kind: str, raw: Any, flags: Sequence[str]) -> str | None:
    """Match-time normalization for one field value.

    Mirrors the load path but is *total* (returns None on anything unusable)
    so a malformed event value never raises mid-run — it just doesn't match.
    """
    if raw is None or isinstance(raw, (dict, list)):
        return None
    text = str(raw)
    if "trim" in flags or kind != "url":
        text = text.strip()
    try:
        if kind in ("sha256", "sha1", "md5") or "hash_lower" in flags:
            text = text.lower()
        if kind in ("domain", "ipv4", "ipv6") or "lowercase" in flags:
            text = text.lower()
        if "strip_trailing_dot" in flags or kind == "domain":
            text = text.rstrip(".")
        return normalize_indicator(kind, text)
    except ValueError:
        return None


def _domain_probes(norm: str) -> list[str]:
    """Suffix probes for domain membership: the full candidate plus every
    parent with >= 2 labels (``x.bad.example`` → itself and ``bad.example``).

    The Bloom is keyed on registered values only, so a subdomain can never
    pass Stage-A on its own hash — the parent probes are what let
    ``match_subdomains`` semantics reach Stage-B (§6.2).
    """
    labels = norm.split(".")
    probes = [".".join(labels[i:]) for i in range(max(1, len(labels) - 1))]
    return probes or [norm]


def evaluate_ioc_rule(
    document: Mapping[str, Any],
    pack_indexes: Sequence[PackIndex],
    events: Sequence[tuple[Any, Mapping[str, Any], str | None, str | None, datetime]],
    *,
    stale: bool = False,
) -> tuple[list[IocMatch], bool]:
    """Run one ``kind: ioc`` rule's membership pass over prepared events.

    Returns ``(matches, suppressed_low)``. ``stale=True`` (the caller decided
    the pack set failed the §6.4 freshness gate) suppresses only LOW-severity
    findings; MEDIUM+ still fire (§6.4). Suppression is counted, never silent.
    """
    block = document.get("ioc") or {}
    match_block = block.get("match") or {}
    fields = [str(f) for f in match_block.get("fields") or []]
    kinds = [str(k) for k in match_block.get("kinds") or []]
    flags = [str(f) for f in match_block.get("normalize") or []]
    confirm_exact = bool(block.get("confirm_exact", True))
    severity = str(document.get("severity") or "MEDIUM").lower()
    suppress_low = stale and severity == "low"

    matches: list[IocMatch] = []
    suppressed = False
    for uid, doc, host, user, when in events:
        for field_path in fields:
            value = _walk(doc, field_path)
            if value is None:
                continue
            for kind in kinds:
                norm = _normalize_for_match(kind, value, flags)
                if norm is None:
                    continue
                # Domain: probe the candidate and each parent so registered
                # domains can match their subdomains through the Bloom (§6.2).
                probes = _domain_probes(norm) if kind == "domain" else [norm]
                for probe in probes:
                    vhash = hashlib.sha256(probe.encode("utf-8")).digest()
                    for idx in pack_indexes:
                        bloom = idx.bloom_for(kind)
                        if bloom is None or not bloom.might_contain(vhash):
                            continue
                        if confirm_exact and idx.exact(kind, probe) is None:
                            continue  # Bloom false positive — Stage B rejects
                        if suppress_low:
                            # §6.4: LOW findings suppressed on a stale pack;
                            # MEDIUM+ still fire. Count, never silent, keep scanning.
                            suppressed = True
                            continue
                        matches.append(
                            IocMatch(
                                event_uid=uid,
                                event=doc,
                                finding_time=when,
                                host_hostname=host,
                                user_name=user,
                                pack_name=idx.name,
                                indicator_kind=kind,
                                indicator_value=probe,
                                observed=norm,
                                matched_field=field_path,
                            )
                        )
    return matches, suppressed


def _walk(doc: Mapping[str, Any], path: str) -> Any:
    cur: Any = doc
    for part in path.split("."):
        if not isinstance(cur, Mapping) or part not in cur:
            return None
        cur = cur[part]
    if isinstance(cur, Mapping):  # state_object / nested doc — not a scalar
        return None
    return cur


# ---------------------------------------------------------------------------
# DB load path (runner + API share this)
# ---------------------------------------------------------------------------


def trusted_keys_path() -> Path:
    """Trust-store location: ``$SENTINEL_IOC_TRUSTED_KEYS`` or the repo
    default ``configs/ioc_trusted_keys.json``."""
    import os

    env = os.environ.get("SENTINEL_IOC_TRUSTED_KEYS")
    if env:
        return Path(env)
    from .sigma_import import _find_repo_root

    return _find_repo_root() / "configs" / "ioc_trusted_keys.json"


def load_active_pack_indexes(conn: Any, tenant_id: str, workspace_id: str) -> dict[tuple[str, str], PackIndex]:
    """Every ``active`` pack in the workspace, keyed by (name, version).

    Rejected/pending/retired packs are intentionally invisible here — only a
    verified ``active`` pack may influence detection (C-11 verify-then-activate).
    """
    rows = conn.execute(
        "SELECT pack_id, name, version, encode(sha256, 'hex'), imported_at "
        "FROM ioc_pack WHERE tenant_id = %s AND workspace_id = %s AND status = 'active'",
        (tenant_id, workspace_id),
    ).fetchall()
    out: dict[tuple[str, str], PackIndex] = {}
    for r in rows:
        pack_row = {
            "pack_id": r[0],
            "name": r[1],
            "version": r[2],
            "digest_sha256": r[3],
            "imported_at": r[4],
        }
        entries = conn.execute(
            "SELECT kind, value_norm, value_hash FROM ioc_entry "
            "WHERE tenant_id = %s AND workspace_id = %s AND pack_id = %s",
            (tenant_id, workspace_id, r[0]),
        ).fetchall()
        idx = build_pack_index(
            pack_row,
            [{"kind": e[0], "value_norm": e[1], "value_hash": e[2]} for e in entries],
        )
        out[(idx.name, idx.version)] = idx
    return out


def resolve_pack_refs(
    refs: Sequence[Mapping[str, Any]], active: Mapping[tuple[str, str], PackIndex]
) -> tuple[list[PackIndex], list[str], bool]:
    """Resolve a rule's ``ioc.packs`` list against the active set.

    Returns ``(indexes, reason_codes, stale)``. A missing or non-active pack
    yields ``IOC_PACK_MISSING`` but the rule still runs against whatever else
    resolved (§6.4: job continues, never a hard fail). A digest mismatch — the
    rule pinned a different build of the pack — yields ``IOC_PACK_STALE``
    (last-known-good posture: keep using the loaded pack, flag the drift).
    """
    indexes: list[PackIndex] = []
    codes: list[str] = []
    stale = False
    for ref in refs:
        key = (str(ref.get("pack") or ""), str(ref.get("version") or ""))
        idx = active.get(key)
        if idx is None:
            if IOC_PACK_MISSING not in codes:
                codes.append(IOC_PACK_MISSING)
            continue
        indexes.append(idx)
        pinned = str(ref.get("digest_sha256") or "")
        if pinned and idx.entries_digest and pinned != idx.entries_digest:
            if IOC_PACK_STALE not in codes:
                codes.append(IOC_PACK_STALE)
            stale = True
        elif idx.is_stale:
            if IOC_PACK_STALE not in codes:
                codes.append(IOC_PACK_STALE)
            stale = True
    return indexes, codes, stale
