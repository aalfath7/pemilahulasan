# Pemilah Ulasan

Aplikasi web untuk **memilah ulasan pelanggan secara otomatis dengan Gemini**. Tempel atau unggah ratusan ulasan, lalu aplikasi mengelompokkannya per sentimen, topik, dan tingkat urgensi. Hasilnya bisa disaring, dibaca ringkasannya, dan diekspor.

Cocok untuk pemilik UMKM, toko online (Shopee/Tokopedia), pengelola aplikasi (Play Store), dan tim CS yang ingin tahu dengan cepat apa yang dikeluhkan pelanggan.

---

## Fitur

- **Input fleksibel**: tempel teks (satu ulasan per baris), unggah **CSV / XLSX** lalu pilih kolom ulasan (dan rating jika ada), atau coba langsung dengan contoh data.
- **Pemilahan otomatis**, setiap ulasan mendapat:
  - **Sentimen**: positif / netral / negatif, dengan skor keyakinan
  - **Topik**: harga, kualitas produk, pengiriman, pelayanan, aplikasi/bug, dan lainnya
  - **Urgensi**: rendah / sedang / tinggi (misalnya ancaman refund, barang rusak, penipuan)
  - **Ringkasan** satu kalimat
  - Penanda **spam / tidak relevan**
- **Dashboard hasil**: kartu ringkasan, grafik topik × sentimen, daftar ulasan dengan filter, pencarian, dan urutan. Tetap mulus untuk ribuan ulasan.
- **Insight AI**: 3 hal yang disukai, 3 keluhan utama, dan saran perbaikan.
- **Draf balasan** untuk ulasan negatif, dengan nada ramah atau formal.
- **Kategori kustom**: 5 preset (toko, restoran, aplikasi, hotel, jasa) atau daftar topik buatan sendiri.
- **Ekspor** hasil ke CSV / XLSX.
- **Riwayat sesi**: tersimpan otomatis dan bisa dilanjutkan. Tamu menyimpan di browser; pengguna yang masuk menyimpan di server.
- **Bahasa campuran**: memahami bahasa Indonesia, Inggris, bahasa gaul, dan singkatan ("brg", "gk", "mantul").
- **Nyaman dipakai**: mode gelap, responsif di HP, bisa dipakai dengan keyboard dan pembaca layar.

## Cara kerja

```
Tempel / unggah ulasan  →  Pratinjau  →  Memproses (hasil muncul bertahap)  →  Hasil
                                                                               └─ Filter · Insight · Ekspor
```

Ulasan dikirim ke server per batch (hingga 50 ulasan), lalu server memanggil Gemini dengan output JSON terstruktur. Ulasan yang sama tidak diproses dua kali karena hasilnya di-cache berdasarkan hash SHA-256 dari teks yang dinormalisasi. Pemrosesan bisa dibatalkan kapan saja; hasil yang sudah selesai tetap disimpan.

## Teknologi

| Bagian | Teknologi |
| --- | --- |
| Backend | FastAPI, Uvicorn, Pydantic v2 |
| AI | Gemini API lewat SDK `google-genai` (output JSON terstruktur) |
| Database | SQLite (lokal), PostgreSQL / Neon (produksi), lewat SQLAlchemy 2 async |
| Baca file | Modul `csv` bawaan + `openpyxl` |
| Rate limit | `slowapi` |
| Frontend | HTML, CSS, dan JavaScript biasa (ES modules, tanpa framework dan tanpa build) |
| Hosting | Render + Neon |

Halaman awal sangat ringan (± 38 KB total) dengan skor Lighthouse 100 di semua kategori.

---

## Menjalankan secara lokal

Butuh Python 3.13 dan API key Gemini dari [Google AI Studio](https://aistudio.google.com/apikey).

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements-dev.txt
copy .env.example .env          # macOS/Linux: cp .env.example .env
# isi GEMINI_API_KEY di file .env
uvicorn app.main:app --reload
```

Buka http://localhost:8000, lalu klik **Coba dengan contoh data**. Untuk mencoba unggah file, pakai `samples/ulasan-contoh.csv`. Dokumentasi API interaktif tersedia di http://localhost:8000/docs.

### Konfigurasi

Semua pengaturan dibaca dari file `.env` (lihat `.env.example`):

| Variabel | Keterangan |
| --- | --- |
| `GEMINI_API_KEY` | **Wajib.** API key Gemini |
| `GEMINI_MODEL` | Nama model Gemini, misalnya `gemini-3.5-flash-lite` |
| `DATABASE_URL` | Default SQLite (`sqlite+aiosqlite:///./data.db`). Untuk Postgres, tempel connection string apa adanya; otomatis diubah ke format asyncpg |
| `SECRET_KEY` | Kunci tanda tangan cookie login. **Wajib di produksi.** Buat dengan `python -c "import secrets; print(secrets.token_hex(32))"` |
| `DEMO_MAX_REVIEWS` | Batas ulasan per sesi untuk tamu (default 200) |
| `MEMBER_MAX_REVIEWS` | Batas ulasan per sesi untuk pengguna yang masuk (default 2.000) |
| `MAX_UPLOAD_MB` | Ukuran maksimal file unggahan (default 10) |
| `RATE_LIMIT` | Rate limit pemilahan per IP (default `30/minute`) |

### Tes dan lint

```bash
pytest                                  # Gemini di-mock, tidak butuh API key
ruff check . && ruff format --check .
```

---

## Deploy ke Render + Neon (gratis)

1. Push repo ini ke GitHub.
2. Buat project di [Neon](https://neon.tech) dan salin connection string-nya (`postgresql://...?sslmode=require`).
3. Di [Render](https://render.com), pilih **New → Blueprint** lalu pilih repo ini. `render.yaml` sudah berisi perintah build/start, health check, dan `SECRET_KEY` acak.
4. Isi `GEMINI_API_KEY` dan `DATABASE_URL` saat diminta. Tabel database dibuat otomatis saat server pertama kali jalan.
5. Buka URL `*.onrender.com`, coba contoh data, daftar akun, lalu cek halaman Riwayat.

Tanpa Blueprint: atur Build `pip install -r requirements.txt`, Start `uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips="*"`, lalu isi env `GEMINI_API_KEY`, `DATABASE_URL`, `SECRET_KEY`, dan `GEMINI_MODEL`.

> **Catatan paket gratis:** server Render gratis tidur setelah 15 menit tidak dipakai, sehingga akses pertama bisa butuh ± 30–60 detik (halaman menampilkan "Menyiapkan server…"). Jangan memakai SQLite di Render karena disknya tidak permanen. Batas paket gratis Render dan Neon bisa berubah sewaktu-waktu.

---

## API

| Method | Path | Fungsi |
| --- | --- | --- |
| `POST` | `/api/upload` | Unggah CSV/XLSX (maks. 10 MB) → `{ columns, rows }` |
| `POST` | `/api/classify` | Body `{ reviews: [{id, text, rating?}], categories? }` → hasil per ulasan |
| `POST` | `/api/export/xlsx` | Body `{ columns, rows }` → file Excel (ekspor CSV dibuat di browser) |
| `POST` | `/api/insight` | Body `{ items: [{sentiment, topics, urgency, summary, is_spam}] }` → `{ overview, liked, complaints, suggestions }` |
| `POST` | `/api/reply` | Body `{ text, sentiment, topics, tone: "ramah"\|"formal" }` → `{ reply }` |
| `GET` | `/api/auth/me` | Email pengguna (atau `null`) + batas ulasan per sesi |
| `POST` | `/api/auth/register` · `/login` · `/logout` | Akun email + password, sesi di cookie `HttpOnly` |
| `GET` | `/api/history` | Daftar sesi milik pengguna (wajib masuk) |
| `GET` · `PUT` · `DELETE` | `/api/history/{id}` | Buka, simpan, atau hapus satu sesi (maks. 50 sesi per pengguna) |
| `GET` | `/api/health` | Cek status server |

Batas penggunaan: tamu 200 ulasan per sesi, pengguna yang masuk 2.000 ulasan per sesi, dan maksimal 50 ulasan per permintaan. Rate limit per IP: pemilahan 30/menit, insight 10/menit, balasan 20/menit, login 10/menit, daftar 5/menit.

## Struktur folder

```
pemilahulasan/
├─ app/
│  ├─ main.py           # Aplikasi FastAPI, header keamanan, mount static/
│  ├─ config.py         # Pengaturan dari .env
│  ├─ db.py             # Tabel cache, users, history_sessions
│  ├─ deps.py           # current_user / require_user
│  ├─ limiter.py        # Rate limit
│  ├─ schemas.py        # Model Pydantic (juga skema jawaban Gemini)
│  ├─ routers/          # classify, upload, export, insight, auth, history
│  └─ services/         # gemini, prompts, cache, parser, exporter, auth
├─ static/
│  ├─ index.html
│  ├─ css/              # tokens.css (warna, mode gelap), base.css
│  └─ js/               # app.js (alur utama) + modul per fitur
├─ samples/             # Contoh file CSV
├─ tests/               # pytest
├─ render.yaml          # Blueprint deploy Render
└─ .env.example
```

## Keamanan & privasi

- **API key Gemini tidak pernah dikirim ke browser.** Key hanya ada di `.env` (lokal) atau environment variable (Render).
- **Teks ulasan tamu hanya disimpan di browser** (IndexedDB). Sesi pengguna yang masuk disimpan di server dan hanya bisa dibuka pemiliknya.
- Cache server hanya berisi hash ulasan + hasil pemilahan, dan kedaluwarsa setelah 30 hari.
- Password di-hash dengan scrypt; cookie login bertanda tangan HMAC dengan atribut `HttpOnly`, `SameSite=Lax`, dan `Secure` (HTTPS).
- CSP `script-src 'self'`, `X-Frame-Options: DENY`, dan semua teks dirender lewat `textContent` untuk mencegah XSS.
- Semua input divalidasi dengan Pydantic, dengan batas ukuran file dan jumlah ulasan.
