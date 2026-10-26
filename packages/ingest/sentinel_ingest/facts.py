"""Content-extractor contract and the ``Fact`` type (Stage-3 §3, §12).

An extractor turns artifact bytes into **facts** — typed observations with no
adjective and no verdict (§12.1). It never emits a canonical event, a finding
or a verdict. The ``mapper`` (§12.3) turns facts into canonical events and the
``artifact_rules`` engine (§12.4) turns facts into ``artifact_finding`` events.

This module is stdlib-only and carries no detection logic, so it is safe
inside the ingest package the tripwire scans.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterator, Mapping

__all__ = [
    "Fact",
    "FactSet",
    "ExtractorResult",
    "Extractor",
    "VALUE_TYPES",
]

#: Stage-3 §12.2 value_type vocabulary.
VALUE_TYPES = frozenset(
    {
        "string",
        "int",
        "float",
        "bool",
        "timestamp",
        "enum",
        "list",
        "bytes_hex",
        "state",
    }
)


@dataclass(frozen=True, slots=True)
class Fact:
    """One typed observation about bytes (§12.2).

    ``name`` is ``<namespace>[.<scope>].<name>`` from the closed Stage-3
    namespace registry. ``value_type`` is the §12.2 vocabulary; ``value`` is a
    plain Python scalar/list/None, or a state object (``{"$state": ...}``)
    when ``value_type == "state"``.
    """

    name: str
    value: Any
    value_type: str
    #: Optional locator (member path, byte offset, relationship id, ...).
    locator: str | None = None

    def __post_init__(self) -> None:
        if self.value_type not in VALUE_TYPES:
            raise ValueError(f"unknown value_type {self.value_type!r} for {self.name}")


class FactSet:
    """Accumulates facts for one artifact and enforces the namespace registry."""

    #: Stage-3 §12.2 normative, closed namespace set.
    NAMESPACES = frozenset(
        {
            "archive",
            "ooxml",
            "ole",
            "pdf",
            "rtf",
            "onenote",
            "chm",
            "lnk",
            "hta",
            "pe",
            "elf",
            "macho",
            "dotnet",
            "script",
            "html",
            "mhtml",
            "image",
            "msi",
            "text",
            "json",
            "xml",
            "identification",
            "motw",
            "encryption",
            "signature",
            "scanner",
        }
    )

    def __init__(self) -> None:
        self._facts: list[Fact] = []

    def add(
        self,
        name: str,
        value: Any,
        value_type: str,
        *,
        locator: str | None = None,
    ) -> None:
        namespace = name.split(".", 1)[0]
        if namespace not in self.NAMESPACES:
            # Adding a namespace is a Stage-3 decision (§12.2), never an
            # extractor improvisation — reject rather than silently accept.
            raise ValueError(f"fact namespace {namespace!r} is not in the registry")
        self._facts.append(Fact(name, value, value_type, locator))

    def extend(self, facts: "Iterator[Fact] | list[Fact]") -> None:
        for f in facts:
            namespace = f.name.split(".", 1)[0]
            if namespace not in self.NAMESPACES:
                raise ValueError(f"fact namespace {namespace!r} is not in the registry")
            self._facts.append(f)

    def __iter__(self) -> Iterator[Fact]:
        return iter(self._facts)

    def __len__(self) -> int:
        return len(self._facts)

    def names(self) -> set[str]:
        return {f.name for f in self._facts}

    def values(self, name: str) -> list[Any]:
        return [f.value for f in self._facts if f.name == name]

    def has(self, name: str) -> bool:
        return any(f.name == name for f in self._facts)

    def as_dicts(self) -> list[dict[str, Any]]:
        """JSON-serialisable form for storage in ``artifact_facts.fact_value``."""
        out: list[dict[str, Any]] = []
        for f in self._facts:
            row: dict[str, Any] = {
                "name": f.name,
                "value": f.value,
                "value_type": f.value_type,
            }
            if f.locator is not None:
                row["locator"] = f.locator
            out.append(row)
        return out


@dataclass(slots=True)
class ExtractorResult:
    """What one extractor produced for one artifact (§3 finalize contract,
    content-extractor flavour)."""

    extractor_id: str
    extractor_version: str
    facts: list[Fact] = field(default_factory=list)
    records_seen: int = 0
    records_failed: int = 0
    bytes_read: int = 0
    #: ``completed`` | ``completed_with_warnings`` | ``failed``.
    status: str = "completed"
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class Extractor:
    """Base class for content extractors.

    Subclasses implement ``extract(head, data, ctx)`` and are registered in
    ``extractors.EXTRACTORS``. They must be pure functions of their bytes: no
    network, no execution, no interpretation beyond the format's own structure
    (Stage-3 §9).
    """

    extractor_id: str = "extractor"
    extractor_version: str = "0.0.0"
    #: Magic-byte prefix this extractor claims, consulted by ``sniff``.
    magic: tuple[bytes, ...] = ()

    @classmethod
    def sniff(cls, head: bytes) -> bool:
        return any(head.startswith(m) for m in cls.magic)

    def extract(
        self, head: bytes, data: bytes, ctx: Mapping[str, Any]
    ) -> ExtractorResult:  # pragma: no cover - abstract
        raise NotImplementedError
