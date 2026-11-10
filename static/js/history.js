/**
 * Penyimpanan riwayat sesi: IndexedDB di browser (tamu) atau server (sudah masuk).
 * Bentuk sesi: { id, title, created_at, updated_at, topics, reviews, results[], insight, counts,
 *                review_count, done_count }
 */
import * as api from './api.js';

const DB_NAME = 'pemilah-ulasan';
const STORE = 'sessions';
const LOCAL_LIMIT = 30;

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

const META_KEYS = ['id', 'title', 'created_at', 'updated_at', 'review_count', 'done_count', 'counts'];
const toMeta = (s) => Object.fromEntries(META_KEYS.map((k) => [k, s[k]]));

async function localList() {
  const all = await tx('readonly', (store) => store.getAll());
  return all.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(toMeta);
}

async function localSave(session) {
  await tx('readwrite', (store) => store.put(session));
  const list = await localList();
  for (const old of list.slice(LOCAL_LIMIT)) await tx('readwrite', (store) => store.delete(old.id));
}

export function buildSession(meta, reviews, results) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  const list = reviews.map((r) => results.get(r.id)).filter(Boolean);
  for (const r of list) counts[r.sentiment]++;
  return {
    ...meta,
    updated_at: new Date().toISOString(),
    reviews,
    results: list,
    counts,
    review_count: reviews.length,
    done_count: list.length,
  };
}

/** Simpan ke akun jika masuk, selain itu ke browser. Mengembalikan lokasi penyimpanan. */
export async function saveSession(session, loggedIn) {
  if (loggedIn) {
    const { id, title, created_at, topics, reviews, results, counts, insight } = session;
    await api.historySave(id, { title, created_at, topics, reviews, results, counts, insight });
    return 'account';
  }
  await localSave(session);
  return 'local';
}

export async function listSessions(loggedIn) {
  const [account, local] = await Promise.all([
    loggedIn ? api.historyList() : Promise.resolve([]),
    localList().catch(() => []),
  ]);
  return { account, local };
}

export async function loadSession(where, id) {
  if (where === 'account') return api.historyGet(id);
  return tx('readonly', (store) => store.get(id));
}

export async function deleteSession(where, id) {
  if (where === 'account') return api.historyDelete(id);
  return tx('readwrite', (store) => store.delete(id));
}
