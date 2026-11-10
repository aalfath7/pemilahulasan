"""Membaca file CSV/XLSX menjadi kolom + baris teks."""

import csv
import io
from collections.abc import Iterable
from dataclasses import dataclass

from openpyxl import load_workbook

MAX_ROWS = 20_000
TEXT_HINTS = (
    "ulasan",
    "review",
    "komentar",
    "comment",
    "teks",
    "text",
    "isi",
    "content",
    "pesan",
    "feedback",
    "masukan",
)
RATING_HINTS = ("rating", "bintang", "star", "skor", "score", "nilai")


class ParseError(ValueError):
    """Pesan error ditujukan langsung ke pengguna."""


@dataclass
class Table:
    columns: list[str]
    rows: list[list[str]]
    total_rows: int
    truncated: bool


def parse_file(filename: str, data: bytes) -> Table:
    name = filename.lower()
    if name.endswith((".csv", ".txt")):
        return _parse_csv(data)
    if name.endswith((".xlsx", ".xlsm")):
        return _parse_xlsx(data)
    if name.endswith(".xls"):
        raise ParseError("Format .xls lama belum didukung. Simpan ulang sebagai .xlsx atau .csv.")
    raise ParseError("Format file tidak didukung. Gunakan file .csv atau .xlsx.")


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _detect_delimiter(text: str) -> str:
    header = text.split("\n", 1)[0]
    counts = {d: header.count(d) for d in (",", ";", "\t", "|")}
    best = max(counts, key=lambda d: counts[d])
    return best if counts[best] else ","


def _parse_csv(data: bytes) -> Table:
    text = _decode(data)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=_detect_delimiter(text))
    try:
        return _build(reader)
    except csv.Error as exc:
        raise ParseError(f"File CSV tidak valid: {exc}") from exc


def _parse_xlsx(data: bytes) -> Table:
    try:
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:
        raise ParseError(
            "File Excel tidak bisa dibaca. Pastikan formatnya .xlsx yang valid."
        ) from exc
    try:
        sheet = workbook.active or workbook.worksheets[0]
        return _build(sheet.iter_rows(values_only=True))
    finally:
        workbook.close()


def _to_str(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _build(raw_rows: Iterable[Iterable[object]]) -> Table:
    header: list[str] | None = None
    rows: list[list[str]] = []
    total = 0
    for raw in raw_rows:
        cells = [_to_str(v) for v in raw]
        if not any(cells):
            continue
        if header is None:
            header = cells
            continue
        total += 1
        if len(rows) < MAX_ROWS:
            rows.append(cells)

    if header is None:
        raise ParseError("File kosong atau tidak berisi data.")
    if not rows:
        raise ParseError("File hanya berisi judul kolom, belum ada ulasan.")

    width = max(len(header), *(len(r) for r in rows))
    columns = _clean_headers(header, width)
    rows = [r[:width] + [""] * (width - len(r)) for r in rows]
    return Table(columns=columns, rows=rows, total_rows=total, truncated=total > len(rows))


def _clean_headers(header: list[str], width: int) -> list[str]:
    columns: list[str] = []
    for i in range(width):
        name = header[i] if i < len(header) and header[i] else f"Kolom {i + 1}"
        base, n = name, 2
        while name in columns:
            name = f"{base} ({n})"
            n += 1
        columns.append(name)
    return columns


def suggest_columns(table: Table) -> tuple[int, int | None]:
    """Tebak kolom ulasan dan kolom rating dari nama kolom / isinya."""
    names = [c.lower() for c in table.columns]
    text_idx = next((i for i, n in enumerate(names) if any(h in n for h in TEXT_HINTS)), None)
    if text_idx is None:
        sample = table.rows[:200]
        averages = [sum(len(r[i]) for r in sample) / len(sample) for i in range(len(names))]
        text_idx = max(range(len(names)), key=lambda i: averages[i])
    rating_idx = next(
        (i for i, n in enumerate(names) if i != text_idx and any(h in n for h in RATING_HINTS)),
        None,
    )
    return text_idx, rating_idx
