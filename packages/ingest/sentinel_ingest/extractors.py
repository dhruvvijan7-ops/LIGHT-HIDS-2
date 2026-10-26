"""Content extractors for the M3 artifact-triage branch (Stage-3 §5, §9).

Each extractor is a pure function of bytes: it reads structure (zip members,
PDF dictionaries, PE headers) and emits **facts** (§12.1). None of them
renders, executes, interprets or dereferences anything (§9.1–§9.7): OOXML is
a zip we list and whose XML we parse with ``ElementTree``; PDF is a byte scan
for dictionary keys; PE is a ``struct`` walk of the import table. All are
stdlib-only, so the branch adds no licence surface.

Registry: ``extract_for(head, data, ctx)`` picks extractors by magic bytes and
returns one ``ExtractorResult`` per applicable extractor. The caller (triage
handler) merges the fact streams and stores them.
"""
from __future__ import annotations

import io
import re
import struct
import zipfile
from dataclasses import dataclass
from typing import Any, Iterator, Mapping
from xml.etree import ElementTree

from sentinel_core.logging import get_logger

from .facts import Extractor, ExtractorResult, Fact, FactSet

log = get_logger("ingest.extract")

_ZIP_MAGIC = b"PK\x03\x04"
_PDF_MAGIC = b"%PDF-"
_PE_MAGIC = b"MZ"


def extract_for(head: bytes, data: bytes, ctx: Mapping[str, Any]) -> list[ExtractorResult]:
    """Run every extractor whose magic matches. Unknown formats yield an
    ``identification.selected = unknown`` fact only — never a silent no-op."""
    results: list[ExtractorResult] = []
    if head.startswith(_ZIP_MAGIC):
        ooxml = OoxmlExtractor().extract(head, data, ctx)
        results.append(ooxml)
        archive = ArchiveExtractor().extract(head, data, ctx)
        results.append(archive)
    elif head.startswith(_PDF_MAGIC):
        results.append(PdfExtractor().extract(head, data, ctx))
    elif head.startswith(_PE_MAGIC) and _looks_like_pe(data):
        results.append(PeExtractor().extract(head, data, ctx))
    if not results:
        results.append(
            ExtractorResult(
                extractor_id="identification",
                extractor_version="1.0.0",
                facts=[
                    Fact("identification.selected", "unknown", "enum"),
                    Fact("identification.confidence", 0.0, "float"),
                ],
                status="completed",
            )
        )
    return results


def _looks_like_pe(data: bytes) -> bool:
    if len(data) < 0x40:
        return False
    try:
        pe_off = struct.unpack_from("<I", data, 0x3C)[0]
    except struct.error:
        return False
    return pe_off + 4 <= len(data) and data[pe_off : pe_off + 4] == b"PE\x00\x00"


# ---------------------------------------------------------------------------
# OOXML (.docx/.xlsx/.pptx and siblings) — §5.1
# ---------------------------------------------------------------------------


class OoxmlExtractor(Extractor):
    """Lists OOXML parts, relationship targets (flagging external), and the
    core ``docProps`` metadata. Parsing is XML-structure only (§9.1: no
    rendering, no macro execution)."""

    extractor_id = "ooxml.stdlib"
    extractor_version = "1.0.0"
    magic = (_ZIP_MAGIC,)

    def extract(self, head: bytes, data: bytes, ctx: Mapping[str, Any]) -> ExtractorResult:
        fs = FactSet()
        result = ExtractorResult(
            extractor_id=self.extractor_id,
            extractor_version=self.extractor_version,
        )
        fs.add("identification.selected", "ooxml", "enum")
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
        except (zipfile.BadZipFile, OSError) as exc:
            result.status = "failed"
            result.errors.append(f"not a readable zip: {exc}")
            return result
        with zf:
            names = zf.namelist()
            result.records_seen = len(names)
            fs.add("archive.member_count", len(names), "int")
            has_rels = False
            for name in names:
                if name.endswith(".rels") and "_rels/" in name:
                    has_rels = True
                    self._walk_rels(zf, name, fs, result)
            self._core_props(zf, fs, result)
        if not has_rels:
            result.warnings.append("no relationship parts found")
        result.facts = list(fs)
        return result

    def _walk_rels(
        self, zf: zipfile.ZipFile, name: str, fs: FactSet, result: ExtractorResult
    ) -> None:
        try:
            xml = zf.read(name)
        except (KeyError, OSError, zipfile.BadZipFile):
            result.records_failed += 1
            return
        try:
            root = ElementTree.fromstring(xml)
        except ElementTree.ParseError:
            result.records_failed += 1
            return
        for rel in root.iter():
            if not rel.tag.endswith("Relationship"):
                continue
            target_mode = (rel.get("TargetMode") or "").strip()
            target = rel.get("Target") or ""
            rel_type = rel.get("Type") or ""
            rel_id = rel.get("Id") or ""
            locator = f"{name}#{rel_id}"
            if target_mode.lower() == "external":
                fs.add("ooxml.relationship.external_target", target, "string", locator=locator)
                fs.add("ooxml.relationship.type", rel_type, "string", locator=locator)
            fs.add("ooxml.relationship.count", 1, "int", locator=locator)

    def _core_props(
        self, zf: zipfile.ZipFile, fs: FactSet, result: ExtractorResult
    ) -> None:
        for props_name in ("docProps/core.xml", "docProps/app.xml"):
            try:
                xml = zf.read(props_name)
            except KeyError:
                continue
            try:
                root = ElementTree.fromstring(xml)
            except ElementTree.ParseError:
                result.records_failed += 1
                continue
            for el in root.iter():
                tag = el.tag.rsplit("}", 1)[-1]
                text = (el.text or "").strip()
                if not text:
                    continue
                mapping = {
                    "title": "ooxml.metadata.title",
                    "creator": "ooxml.metadata.creator",
                    "lastModifiedBy": "ooxml.metadata.last_modified_by",
                    "revision": "ooxml.metadata.revision",
                    "created": "ooxml.metadata.created",
                    "modified": "ooxml.metadata.modified",
                }
                fact = mapping.get(tag)
                if fact:
                    fs.add(fact, text, "string", locator=props_name)


# ---------------------------------------------------------------------------
# PDF — §5.3
# ---------------------------------------------------------------------------


class PdfExtractor(Extractor):
    """Byte-scan for the trailer ``/OpenAction`` and Info-dictionary fields.

    This is a structural scan, not a PDF interpreter (§9.3): we look for
    dictionary keys in the raw bytes and never render or execute a page
    (§9.1). No third-party PDF library is used, so no rendering stack is
    reachable.
    """

    extractor_id = "pdf.scan"
    extractor_version = "1.0.0"
    magic = (_PDF_MAGIC,)

    _OPENACTION = re.compile(rb"/OpenAction\b")
    _JS = re.compile(rb"/JavaScript\b|/JS\b")
    _AA = re.compile(rb"/AA\b")
    _INFO_FIELDS = {
        b"/Title": "pdf.metadata.title",
        b"/Author": "pdf.metadata.author",
        b"/Subject": "pdf.metadata.subject",
        b"/Producer": "pdf.metadata.producer",
        b"/Creator": "pdf.metadata.creator",
    }

    def extract(self, head: bytes, data: bytes, ctx: Mapping[str, Any]) -> ExtractorResult:
        fs = FactSet()
        fs.add("identification.selected", "pdf", "enum")
        result = ExtractorResult(
            extractor_id=self.extractor_id,
            extractor_version=self.extractor_version,
            records_seen=1,
            bytes_read=len(data),
        )
        if self._OPENACTION.search(data):
            fs.add("pdf.action.open_action", True, "bool")
        if self._JS.search(data):
            fs.add("pdf.action.javascript_present", True, "bool")
        if self._AA.search(data):
            fs.add("pdf.action.additional_actions_present", True, "bool")
        for raw_key, fact_name in self._INFO_FIELDS.items():
            for m in re.finditer(re.escape(raw_key) + rb"\s*\(([^)]{0,512})\)", data):
                try:
                    value = m.group(1).decode("latin-1")
                except UnicodeDecodeError:  # pragma: no cover - latin-1 never fails
                    continue
                fs.add(fact_name, value, "string")
        result.facts = list(fs)
        return result


# ---------------------------------------------------------------------------
# PE — §5.5
# ---------------------------------------------------------------------------


class PeExtractor(Extractor):
    """Minimal PE header + import-table walk via ``struct``.

    Reads the DOS/COFF/optional headers and the import directory, yielding one
    ``pe.import.name`` / ``pe.import.dll`` pair per imported symbol. No
    library is loaded and no code is mapped (§9.5); this is a byte walk.
    """

    extractor_id = "pe.struct"
    extractor_version = "1.0.0"
    magic = (_PE_MAGIC,)

    _MACHINES = {
        0x014C: "i386",
        0x8664: "amd64",
        0xAA64: "arm64",
        0x01C4: "armnt",
    }

    def extract(self, head: bytes, data: bytes, ctx: Mapping[str, Any]) -> ExtractorResult:
        fs = FactSet()
        fs.add("identification.selected", "pe", "enum")
        result = ExtractorResult(
            extractor_id=self.extractor_id,
            extractor_version=self.extractor_version,
            records_seen=1,
            bytes_read=len(data),
        )
        try:
            self._walk(data, fs, result)
        except (struct.error, IndexError, OverflowError) as exc:
            result.status = "completed_with_warnings"
            result.warnings.append(f"pe walk stopped early: {exc}")
        result.facts = list(fs)
        return result

    def _u16(self, data: bytes, off: int) -> int:
        return struct.unpack_from("<H", data, off)[0]

    def _u32(self, data: bytes, off: int) -> int:
        return struct.unpack_from("<I", data, off)[0]

    def _walk(self, data: bytes, fs: FactSet, result: ExtractorResult) -> None:
        if len(data) < 0x40 or data[:2] != b"MZ":
            result.status = "failed"
            result.errors.append("missing MZ header")
            return
        pe_off = self._u32(data, 0x3C)
        if pe_off + 24 > len(data) or data[pe_off : pe_off + 4] != b"PE\x00\x00":
            result.status = "failed"
            result.errors.append("missing PE signature")
            return
        coff = pe_off + 4
        machine = self._u16(data, coff)
        n_sections = self._u16(data, coff + 2)
        timestamp = self._u32(data, coff + 4)
        opt_size = self._u16(data, coff + 16)
        fs.add("pe.header.machine", self._MACHINES.get(machine, f"0x{machine:04x}"), "enum")
        fs.add("pe.header.compile_time", int(timestamp), "int")
        opt = coff + 20
        magic16 = self._u16(data, opt)
        pe32plus = magic16 == 0x20B
        # Optional header: subsystem at a fixed offset from the magic.
        subsystem_off = opt + (68 if pe32plus else 68)
        if subsystem_off + 2 <= len(data):
            fs.add("pe.header.subsystem", int(self._u16(data, subsystem_off)), "int")
        # Data directory 1 = import table.
        dd_off = opt + (112 if pe32plus else 96)
        if dd_off + 8 <= len(data):
            imp_rva = self._u32(data, dd_off)
            if imp_rva:
                section_table = opt + opt_size
                self._walk_imports(
                    data, fs, result, imp_rva, section_table, n_sections
                )

    def _rva_to_off(self, data: bytes, rva: int, section_table: int, n_sections: int) -> int | None:
        for i in range(n_sections):
            off = section_table + i * 40
            if off + 40 > len(data):
                return None
            virt_size = self._u32(data, off + 8)
            virt_addr = self._u32(data, off + 12)
            raw_size = self._u32(data, off + 16)
            raw_ptr = self._u32(data, off + 20)
            size = max(virt_size, raw_size)
            if virt_addr <= rva < virt_addr + size:
                return raw_ptr + (rva - virt_addr)
        return None

    def _read_cstr(self, data: bytes, off: int, limit: int = 256) -> str | None:
        end = data.find(b"\x00", off, off + limit)
        if end == -1:
            end = min(len(data), off + limit)
        try:
            return data[off:end].decode("ascii", "replace")
        except ValueError:  # pragma: no cover - decode with replace never raises
            return None

    def _walk_imports(
        self,
        data: bytes,
        fs: FactSet,
        result: ExtractorResult,
        imp_rva: int,
        section_table: int,
        n_sections: int,
    ) -> None:
        desc_off = self._rva_to_off(data, imp_rva, section_table, n_sections)
        if desc_off is None:
            result.warnings.append("import directory not mapped")
            return
        idx = 0
        while desc_off + 20 * (idx + 1) <= len(data):
            entry = desc_off + 20 * idx
            name_rva = self._u32(data, entry + 12)
            thunk_rva = self._u32(data, entry + 16)
            if name_rva == 0 and thunk_rva == 0:
                break
            idx += 1
            name_off = self._rva_to_off(data, name_rva, section_table, n_sections)
            dll = self._read_cstr(data, name_off) if name_off is not None else None
            if not thunk_rva:
                continue
            thunk_off = self._rva_to_off(data, thunk_rva, section_table, n_sections)
            if thunk_off is None:
                continue
            entry_size = 8 if len(fs) and False else 4  # resolved below per magic
            # Determine 32/64 from the optional-header magic we already read.
            pe32plus = self._u16(data, self._u32(data, 0x3C) + 4 + 20) == 0x20B
            entry_size = 8 if pe32plus else 4
            t = 0
            while thunk_off + entry_size * (t + 1) <= len(data):
                raw = (
                    struct.unpack_from("<Q", data, thunk_off + entry_size * t)[0]
                    if entry_size == 8
                    else self._u32(data, thunk_off + entry_size * t)
                )
                if raw == 0:
                    break
                t += 1
                if raw & (1 << (63 if entry_size == 8 else 31)):
                    fs.add("pe.import.ordinal", int(raw & 0xFFFF), "int", locator=dll)
                    continue
                hint_off = self._rva_to_off(
                    data, int(raw & 0x7FFFFFFF), section_table, n_sections
                )
                if hint_off is None or hint_off + 2 >= len(data):
                    continue
                sym = self._read_cstr(data, hint_off + 2)
                if sym:
                    fs.add("pe.import.name", sym, "string", locator=dll)
                    if dll:
                        fs.add("pe.import.dll", dll, "string", locator=dll)


# ---------------------------------------------------------------------------
# Archives (zip) — §5.8
# ---------------------------------------------------------------------------


class ArchiveExtractor(Extractor):
    """Lists zip members with sizes and compression ratios (§5.8 / §10).

    Listing only: no extraction, no rewriting, no "test and repair" (§9.3,
    §9.7). The expansion ratio is emitted as a fact; whether a ratio is
    noteworthy is AF-003's call, never this extractor's (§12.1).
    """

    extractor_id = "archive.zip"
    extractor_version = "1.0.0"
    magic = (_ZIP_MAGIC,)

    def extract(self, head: bytes, data: bytes, ctx: Mapping[str, Any]) -> ExtractorResult:
        fs = FactSet()
        fs.add("identification.selected", "zip", "enum")
        result = ExtractorResult(
            extractor_id=self.extractor_id,
            extractor_version=self.extractor_version,
        )
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
        except (zipfile.BadZipFile, OSError) as exc:
            result.status = "failed"
            result.errors.append(f"not a readable zip: {exc}")
            return result
        with zf:
            infos = zf.infolist()
            result.records_seen = len(infos)
            fs.add("archive.member_count", len(infos), "int")
            total_uncompressed = 0
            for info in infos:
                total_uncompressed += info.file_size
                ratio = (info.file_size / info.compress_size) if info.compress_size else 0.0
                fs.add(
                    "archive.member.ratio",
                    round(ratio, 4),
                    "float",
                    locator=info.filename,
                )
                fs.add(
                    "archive.member.size", int(info.file_size), "int", locator=info.filename
                )
                fs.add(
                    "archive.member.compressed_size",
                    int(info.compress_size),
                    "int",
                    locator=info.filename,
                )
                encrypted = bool(info.flag_bits & 0x1)
                fs.add(
                    "archive.member.encrypted",
                    encrypted,
                    "bool",
                    locator=info.filename,
                )
            fs.add("archive.total_declared_uncompressed", total_uncompressed, "int")
            if infos:
                worst = max(
                    (i.file_size / i.compress_size) for i in infos if i.compress_size
                )
                fs.add("archive.entry.ratio", round(worst, 4), "float")
        result.facts = list(fs)
        return result
