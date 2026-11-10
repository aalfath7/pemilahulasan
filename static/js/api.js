import { sleep } from './util.js';

export class ApiError extends Error {
  constructor(message, status, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.', 0);
  }
  if (!res.ok) {
    let message = `Terjadi kesalahan di server (${res.status}).`;
    try {
      const data = await res.json();
      if (typeof data.detail === 'string') message = data.detail;
      else if (Array.isArray(data.detail)) message = 'Data yang dikirim tidak valid.';
    } catch { /* bukan JSON */ }
    throw new ApiError(message, res.status, Number(res.headers.get('Retry-After')) || 0);
  }
  return res;
}

const json = (body, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function health(signal) {
  return (await request('/api/health', { signal })).json();
}

/** Status yang tidak akan berubah dengan mencoba ulang. */
export const isFatal = (err) => err instanceof ApiError && (err.status === 502 || err.status === 503);

export async function classify(reviews, signal, categories = null) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await (await request('/api/classify', { ...json({ reviews, categories }), signal })).json();
    } catch (err) {
      const retryable = err instanceof ApiError && !isFatal(err)
        && (err.status === 0 || err.status === 429 || err.status >= 500);
      if (!retryable || attempt >= 2) throw err;
      await sleep((err.retryAfter || 2 ** attempt * 2) * 1000, signal);
    }
  }
}

export async function upload(file) {
  const form = new FormData();
  form.append('file', file);
  return (await request('/api/upload', { method: 'POST', body: form })).json();
}

export async function exportXlsx(columns, rows) {
  return (await request('/api/export/xlsx', json({ columns, rows }))).blob();
}

/* ---------- Insight & balasan ---------- */
export const insight = async (items) => (await request('/api/insight', json({ items }))).json();
export const reply = async (body) => (await request('/api/reply', json(body))).json();

/* ---------- Akun ---------- */
export const me = async () => (await request('/api/auth/me')).json();
export const login = async (email, password) => (await request('/api/auth/login', json({ email, password }))).json();
export const register = async (email, password) => (await request('/api/auth/register', json({ email, password }))).json();
export const logout = async () => (await request('/api/auth/logout', json({}))).json();

/* ---------- Riwayat (akun) ---------- */
export const historyList = async () => (await request('/api/history')).json();
export const historyGet = async (id) => (await request(`/api/history/${id}`)).json();
export const historySave = async (id, body) => (await request(`/api/history/${id}`, json(body, 'PUT'))).json();
export const historyDelete = async (id) => { await request(`/api/history/${id}`, { method: 'DELETE' }); };
