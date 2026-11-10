import io
import zipfile

from openpyxl import Workbook, load_workbook

from app.db import normalize_db_url
from app.services.parser import parse_file, suggest_columns


def test_csv_semicolon_with_bom():
    data = "﻿tanggal;rating;ulasan\n2026-01-01;5;Bagus, cepat\n\n2026-01-02;1;Rusak\n".encode()
    table = parse_file("data.csv", data)
    assert table.columns == ["tanggal", "rating", "ulasan"]
    assert table.rows == [["2026-01-01", "5", "Bagus, cepat"], ["2026-01-02", "1", "Rusak"]]
    assert suggest_columns(table) == (2, 1)


def test_csv_without_header_hints_picks_longest_column():
    data = b"a,b\n1,Ini ulasan yang panjang sekali\n2,Ulasan lain yang juga panjang\n"
    table = parse_file("x.csv", data)
    assert suggest_columns(table) == (1, None)


def test_xlsx_roundtrip_and_upload(client):
    wb = Workbook()
    ws = wb.active
    ws.append(["Review", "Stars"])
    ws.append(["Mantap", 5])
    ws.append([None, None])
    ws.append(["Jelek", 1.0])
    buf = io.BytesIO()
    wb.save(buf)

    res = client.post("/api/upload", files={"file": ("u.xlsx", buf.getvalue())})
    assert res.status_code == 200
    data = res.json()
    assert data["columns"] == ["Review", "Stars"]
    assert data["rows"] == [["Mantap", "5"], ["Jelek", "1"]]
    assert data["suggested_text"] == 0
    assert data["suggested_rating"] == 1


def test_upload_rejects_unknown_format(client):
    res = client.post("/api/upload", files={"file": ("a.pdf", b"%PDF")})
    assert res.status_code == 400
    assert ".csv" in res.json()["detail"]


def test_upload_header_only(client):
    res = client.post("/api/upload", files={"file": ("a.csv", b"ulasan\n")})
    assert res.status_code == 400


def test_export_xlsx_keeps_formulas_as_text(client):
    body = {"columns": ["No", "Ulasan"], "rows": [[1, '=HYPERLINK("x")'], [2, "Bagus\x07"]]}
    res = client.post("/api/export/xlsx", json=body)
    assert res.status_code == 200
    with zipfile.ZipFile(io.BytesIO(res.content)) as z:
        sheet_xml = z.read("xl/worksheets/sheet1.xml").decode()
    assert "<f>" not in sheet_xml
    ws = load_workbook(io.BytesIO(res.content)).active
    assert ws["B3"].value == "Bagus"
    assert ws.freeze_panes == "A2"


def test_normalize_neon_url():
    url = "postgresql://u:p@host/db?sslmode=require&channel_binding=require"
    assert normalize_db_url(url) == "postgresql+asyncpg://u:p@host/db?ssl=require"
    assert normalize_db_url("sqlite+aiosqlite:///./x.db") == "sqlite+aiosqlite:///./x.db"


def test_health_and_static(client):
    assert client.get("/api/health").json()["gemini_ready"] is True
    assert "Pemilah Ulasan" in client.get("/").text
