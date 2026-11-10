"""Membuat file Excel (.xlsx) dari hasil pemilahan."""

import io
from collections.abc import Sequence

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

Value = str | int | float | bool | None

HEADER_FONT = Font(bold=True, color="FFFFFF")
HEADER_FILL = PatternFill("solid", fgColor="4F46E5")
WRAP = Alignment(wrap_text=True, vertical="top")
TOP = Alignment(vertical="top")


def _width(columns: Sequence[str], rows: Sequence[Sequence[Value]], i: int) -> float:
    longest = max([len(columns[i])] + [len(str(r[i])) for r in rows[:200] if i < len(r)])
    return min(max(longest + 2, 8), 60)


def _cell(sheet, value: Value, wrap: bool) -> WriteOnlyCell:
    if isinstance(value, str):
        value = ILLEGAL_CHARACTERS_RE.sub("", value)
    cell = WriteOnlyCell(sheet, value=value)
    if isinstance(value, str) and value.startswith("="):
        cell.data_type = "s"  # simpan sebagai teks, jangan dieksekusi sebagai rumus
    cell.alignment = WRAP if wrap else TOP
    return cell


def build_xlsx(columns: Sequence[str], rows: Sequence[Sequence[Value]]) -> bytes:
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet("Hasil")
    widths = [_width(columns, rows, i) for i in range(len(columns))]
    for i, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(i)].width = width
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{len(rows) + 1}"

    header = []
    for name in columns:
        cell = WriteOnlyCell(sheet, value=name)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        header.append(cell)
    sheet.append(header)

    wrap = [w >= 60 for w in widths]
    for row in rows:
        padded = list(row[: len(columns)]) + [None] * (len(columns) - len(row))
        sheet.append([_cell(sheet, v, wrap[i]) for i, v in enumerate(padded)])

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
