"""Tripwire: no detection constants may be invented in code.

Stage-6 §8 tripwire: rule logic lives in rule documents, never hard-coded in
the engine.  This test fails if someone sneaks a threshold / IOC / severity
constant into sentinel_detect.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETECT_PKG = ROOT / "packages" / "detect" / "sentinel_detect"

# Constants that would indicate invented detections.
_FORBIDDEN = re.compile(
    r"""(?xi)
    (?:^|\W)sigma_rule_id
    | (?:^|\W)threshold\s*[:=]\s*\d+
    | (?:^|\W)ALERT_SEVERITY_[A-Z_]+
    | sha256\s*[:=]\s*["'][0-9a-f]{64}["']
    | \bCVE-\d{4}-\d{4,}
    """
)

# IOC_ codes are checked separately against an explicit spec allowlist
# (M3-A7); an unlisted IOC_[A-Z_]+ token is still a forbidden constant.
_IOC_CODE = re.compile(r"(?:^|\W)(IOC_[A-Z_]+)")

# Spec-defined reason codes (Stage-5 §4.8 / §6.4), not invented detections.
_IOC_REASON_CODE_ALLOWLIST = frozenset(
    {
        "IOC_PACK_MISSING",
        "IOC_PACK_STALE",
    }
)


def _unlisted_ioc_codes(line: str) -> list[str]:
    return [
        m.group(1) for m in _IOC_CODE.finditer(line)
        if m.group(1) not in _IOC_REASON_CODE_ALLOWLIST
    ]


def test_no_detection_constants_in_detect_package():
    offenders: list[str] = []
    for py in DETECT_PKG.rglob("*.py"):
        text = py.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), 1):
            if _FORBIDDEN.search(line):
                offenders.append(f"{py.relative_to(ROOT)}:{lineno}: {line.strip()}")
            unlisted = _unlisted_ioc_codes(line)
            if unlisted:
                offenders.append(
                    f"{py.relative_to(ROOT)}:{lineno}: unlisted IOC code(s) "
                    f"{unlisted} (only spec §4.8 codes are allowlisted, M3-A7): "
                    f"{line.strip()}"
                )
    assert not offenders, "detection constants found in code:\n" + "\n".join(offenders)


def test_detect_package_has_no_rule_documents():
    for pattern in ("*.yml", "*.yaml", "*.sigma", "*.rule"):
        found = list(DETECT_PKG.rglob(pattern))
        assert found == [], f"rule documents inside engine package: {found}"


def test_empty_rule_store_is_empty():
    from sentinel_detect.store import EmptyRuleStore

    store = EmptyRuleStore()
    assert store.load("default", "default") == []
