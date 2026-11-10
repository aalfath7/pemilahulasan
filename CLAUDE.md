# CLAUDE.md

Panduan untuk Claude saat bekerja di repo ini. [README.md](README.md) adalah dokumentasi publik (fitur, konfigurasi, API, deploy); baca bagian yang relevan sebelum mengerjakan fitur.

## Ringkasan proyek

Pemilah Ulasan: aplikasi web untuk memilah ulasan pelanggan (sentimen, topik, urgensi, ringkasan, spam) dengan Gemini.
Stack: **FastAPI + Pydantic v2 + SQLAlchemy 2 async**, frontend **HTML/CSS/JS biasa** di `static/`, database SQLite (lokal) / Postgres Neon (produksi), deploy ke Render.

## Cara kerja

- **Satu fitur per giliran.** Kerjakan hanya yang diminta, lalu berhenti dan minta user mereview. Jangan mulai fitur berikutnya sebelum user setuju.
- README ditujukan untuk publik: jangan menulis status pengerjaan, roadmap, atau catatan internal di sana. Jika fitur, konfigurasi, atau API berubah, perbarui README agar tetap akurat.
- Komunikasi dengan user dalam **bahasa Indonesia**.

## Perintah

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload     # http://localhost:8000, docs di /docs
pytest                            # jalankan tes (Gemini di-mock, tidak butuh API key)
ruff check . && ruff format .     # lint & format
```

## Aturan teknis

**Backend**
- Semua panggilan Gemini lewat `app/services/gemini.py` memakai SDK `google-genai` (`client.aio`), dengan `response_mime_type="application/json"` dan `response_schema` berupa model Pydantic dari `app/schemas.py`. Jangan parse JSON manual dari teks bebas.
- Nama model dibaca dari env `GEMINI_MODEL`, jangan di-hardcode.
- Ulasan dikirim per batch (25–50), dibatasi `asyncio.Semaphore`, retry dengan exponential backoff.
- Cek cache (SHA-256 dari teks yang dinormalisasi) sebelum memanggil Gemini.
- Konfigurasi hanya lewat `app/config.py` (membaca `.env`). Kode harus jalan dengan SQLite maupun Postgres; jangan pakai fitur khusus salah satu database.
- Jangan tambah dependensi berat (pandas, numpy, dll.). Pakai `csv` bawaan dan `openpyxl`.

**Frontend**
- Tanpa framework dan tanpa build step: ES modules biasa di `static/js/`.
- Target JS awal < 30 KB gzip. Library pihak ketiga hanya jika benar-benar perlu, dan dimuat dengan `import()` saat dibutuhkan.
- Warna dan ukuran hanya dari CSS variables di `static/css/tokens.css`; mode gelap lewat variables tersebut.
- Warna sentimen tetap: positif `#16a34a`, netral `#64748b`, negatif `#dc2626`, urgensi tinggi `#ea580c`.
- Semua teks UI dan pesan error dalam bahasa Indonesia yang ramah dan jelas.
- Aksesibilitas wajib: kontras AA, bisa dipakai dengan keyboard, label ARIA, hormati `prefers-reduced-motion`.
- Daftar ulasan yang panjang memakai virtual list.
- Alur utama ada di `static/js/app.js`; fitur terpisah per modul (`results.js`, `topics.js`, `insight.js`, `history.js`, `auth.js`). Modul yang jarang dipakai dimuat dengan `import()`.
- Setelah mengubah UI, cek ulang Lighthouse (target 100 di semua kategori) dan tampilan HP (lebar 390px).

**Keamanan**
- `GEMINI_API_KEY` dan `SECRET_KEY` tidak boleh sampai ke browser atau ter-commit. `.env` masuk `.gitignore`; contoh nilai ditaruh di `.env.example`.
- Teks asli ulasan hanya disimpan di server untuk user yang masuk (riwayat). Tamu: hanya IndexedDB di browser.
- Endpoint yang menyentuh data user memakai `Depends(require_user)` dan selalu cek `user_id` pemilik; sesi milik orang lain dijawab 404.
- Auth hanya memakai pustaka standar (`hashlib.scrypt`, HMAC). Jangan menambah pustaka auth tanpa alasan kuat.
- CSP `script-src 'self'`: jangan menulis `<script>` inline atau handler `onclick="..."` di HTML.
- Teks dari user/Gemini selalu dirender lewat `textContent` (helper `h()`), tidak pernah `innerHTML`.
- Validasi semua input dengan Pydantic; batasi ukuran unggahan (10 MB) dan jumlah ulasan (200 tamu / 2.000 user).

## Konvensi kode

- Python: type hints di semua fungsi, format dengan `ruff format`, lint dengan `ruff check`.
- Route tipis di `app/routers/`, logika di `app/services/`.
- Setiap service baru disertai tes di `tests/`; panggilan Gemini di-mock dalam tes.
- Nama variabel/fungsi dalam bahasa Inggris; teks yang dilihat user dalam bahasa Indonesia.
