import { exportXlsx } from './api.js';
import { SENTIMENT, URGENCY } from './util.js';

const COLUMNS = ['No', 'Ulasan', 'Rating', 'Sentimen', 'Keyakinan (%)', 'Topik', 'Urgensi', 'Ringkasan', 'Spam'];

function buildRows(reviews, results) {
  return reviews.map((review, i) => {
    const r = results.get(review.id);
    return [
      i + 1,
      review.text,
      review.rating ?? null,
      r ? SENTIMENT[r.sentiment] : 'Belum diproses',
      r ? Math.round(r.confidence * 100) : null,
      r ? r.topics.join(', ') : '',
      r ? URGENCY[r.urgency] : '',
      r ? r.summary : '',
      r ? (r.is_spam ? 'Ya' : 'Tidak') : '',
    ];
  });
}

/** Cegah CSV injection: sel yang diawali karakter rumus diberi tanda kutip. */
function csvCell(value) {
  if (value == null) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const lines = [COLUMNS, ...rows].map((row) => row.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n'); // BOM agar Excel membaca UTF-8
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportResults(format, reviews, results) {
  const rows = buildRows(reviews, results);
  const date = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    download(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `hasil-pemilahan-${date}.csv`);
  } else {
    download(await exportXlsx(COLUMNS, rows), `hasil-pemilahan-${date}.xlsx`);
  }
}
