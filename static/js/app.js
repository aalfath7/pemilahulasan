import * as api from './api.js';
import { account, initAuth, openAuth } from './auth.js';
import { buildSession, deleteSession, listSessions, loadSession, saveSession } from './history.js';
import { generateInsight, renderInsight } from './insight.js';
import { initResults, resetResults, addResults, getResults, getItems, setRunning } from './results.js';
import { getTopics, hasTopics, initTopics } from './topics.js';
import { $, h, fmt, pct, toast, debounce, parseRating } from './util.js';

const BATCH_SIZE = 25;
const CONCURRENCY = 3;
const VIEWS = ['input', 'preview', 'results', 'history'];

const state = {
  view: 'input',
  backTo: 'input',
  tab: 'paste',
  source: 'paste',
  upload: null, // { filename, columns, rows, total_rows, truncated, ... }
  allReviews: [], // semua ulasan dari input (sebelum dipotong batas)
  reviews: [], // ulasan yang diproses
  limits: { max_upload_mb: 10 },
  session: null, // { id, title, created_at, topics, insight }
  run: null, // { status, controller, error }
};

const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

/* ================= Tema ================= */
function initTheme() {
  const btn = $('#theme-toggle');
  const root = document.documentElement;
  const isDark = () => root.dataset.theme === 'dark'
    || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const label = () => btn.setAttribute('aria-label', isDark() ? 'Ganti ke tema terang' : 'Ganti ke tema gelap');
  label();
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* abaikan */ }
    label();
  });
}

/* ================= Banner & server ================= */
function banner(message, type = 'info') {
  const node = $('#banner');
  node.textContent = message;
  node.className = `banner ${type}`;
  node.hidden = !message;
}

async function checkHealth() {
  const slow = setTimeout(() => banner('Menyiapkan server… Di hosting gratis ini bisa memakan waktu hingga 1 menit.'), 1500);
  try {
    const info = await api.health();
    state.limits = { ...state.limits, ...info.limits };
    $('#dropzone-hint').textContent = `atau seret ke sini · maks. ${state.limits.max_upload_mb} MB`;
    banner(info.gemini_ready ? '' : 'API key Gemini belum diatur. Isi GEMINI_API_KEY di file .env, lalu jalankan ulang server.', 'warn');
  } catch {
    banner('Server belum bisa dihubungi. Coba muat ulang halaman.', 'error');
  } finally {
    clearTimeout(slow);
  }
}

/* ================= Navigasi ================= */
function show(view, push = true) {
  if (view === 'history' && state.view !== 'history') state.backTo = state.view;
  state.view = view;
  for (const name of VIEWS) $(`#view-${name}`).hidden = name !== view;
  if (push) history.pushState({ view }, '', view === 'input' ? location.pathname : `#${view}`);
  if (view === 'history') renderHistory();
  scrollTo({ top: 0 });
  $(`#view-${view} h1`).focus({ preventScroll: true });
}

addEventListener('popstate', (e) => {
  const view = e.state?.view || 'input';
  const needsData = view === 'preview' || view === 'results';
  show(needsData && !state.reviews.length ? 'input' : view, false);
});

/* ================= 1. Input ================= */
function setTab(tab) {
  state.tab = tab;
  for (const name of ['paste', 'upload']) {
    const active = name === tab;
    const btn = $(`#tab-${name}`);
    btn.setAttribute('aria-selected', active);
    btn.tabIndex = active ? 0 : -1;
    $(`#panel-${name}`).hidden = !active;
  }
  updateInputState();
}

function collectReviews() {
  if (state.tab === 'paste') {
    return $('#paste-input').value.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text, i) => ({ id: `r${i + 1}`, text }));
  }
  if (!state.upload) return [];
  const textCol = Number($('#col-text').value);
  const ratingCol = $('#col-rating').value === '' ? null : Number($('#col-rating').value);
  const out = [];
  for (const row of state.upload.rows) {
    const text = (row[textCol] || '').trim();
    if (!text) continue;
    out.push({ id: `r${out.length + 1}`, text, rating: ratingCol == null ? null : parseRating(row[ratingCol]) });
  }
  return out;
}

function updateInputState() {
  const count = collectReviews().length;
  if (state.tab === 'paste') {
    $('#paste-count').textContent = count ? `${fmt(count)} ulasan terdeteksi` : 'Belum ada ulasan. Tempel satu ulasan per baris.';
  }
  $('#btn-to-preview').disabled = count === 0;
}

function uploadStatus(message, type = '') {
  const node = $('#upload-status');
  node.textContent = message;
  node.className = `hint ${type}`;
}

async function handleFile(file) {
  if (!file) return;
  if (file.size > state.limits.max_upload_mb * 1024 * 1024) {
    uploadStatus(`Ukuran file melebihi ${state.limits.max_upload_mb} MB.`, 'error');
    return;
  }
  state.upload = null;
  $('#column-picker').hidden = true;
  uploadStatus(`Membaca ${file.name}…`);
  updateInputState();
  try {
    const data = await api.upload(file);
    state.upload = data;
    const options = data.columns.map((name, i) => h('option', { value: i }, name));
    $('#col-text').replaceChildren(...options);
    $('#col-text').value = data.suggested_text;
    $('#col-rating').replaceChildren(h('option', { value: '' }, 'Tidak ada'), ...options.map((o) => o.cloneNode(true)));
    $('#col-rating').value = data.suggested_rating ?? '';
    $('#column-picker').hidden = false;
    const extra = data.truncated ? ` (hanya ${fmt(data.rows.length)} baris pertama yang dibaca)` : '';
    uploadStatus(`✓ ${data.filename} · ${fmt(data.total_rows)} baris${extra}`, 'ok');
  } catch (err) {
    uploadStatus(err.message, 'error');
  }
  updateInputState();
}

function initInput() {
  $('#tab-paste').addEventListener('click', () => setTab('paste'));
  $('#tab-upload').addEventListener('click', () => setTab('upload'));
  $('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = state.tab === 'paste' ? 'upload' : 'paste';
    setTab(next);
    $(`#tab-${next}`).focus();
  });

  $('#paste-input').addEventListener('input', debounce(updateInputState, 120));
  $('#file-input').addEventListener('change', (e) => handleFile(e.target.files[0]));
  $('#col-text').addEventListener('change', updateInputState);

  const zone = $('#dropzone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  });

  $('#btn-sample').addEventListener('click', async () => {
    const { default: samples } = await import('./samples.js');
    $('#paste-input').value = samples.join('\n');
    setTab('paste');
    state.source = 'sample';
    goPreview();
  });
  $('#btn-to-preview').addEventListener('click', () => {
    state.source = state.tab;
    goPreview();
  });
}

/* ================= 2. Pratinjau ================= */
function estimate(n) {
  const waves = Math.ceil(Math.ceil(n / BATCH_SIZE) / CONCURRENCY);
  const secs = waves * 8;
  return secs < 60 ? `± ${Math.max(5, Math.round(secs / 5) * 5)} detik` : `± ${Math.ceil(secs / 60)} menit`;
}

function sourceTitle() {
  if (state.source === 'upload') return state.upload.filename;
  if (state.source === 'sample') return 'Contoh data';
  return `Teks ditempel (${fmt(state.reviews.length)} ulasan)`;
}

function renderPreview() {
  const all = state.allReviews;
  const max = account.maxReviews;
  state.reviews = all.slice(0, max);

  $('#pv-total').textContent = fmt(state.reviews.length);
  $('#pv-time').textContent = estimate(state.reviews.length);
  $('#pv-source').textContent = state.source === 'upload' ? state.upload.filename
    : state.source === 'sample' ? 'Contoh data' : 'Teks ditempel';

  const over = all.length > max;
  $('#pv-notice').hidden = !over;
  $('#pv-notice-text').textContent = account.email
    ? `Batas per sesi adalah ${fmt(max)} ulasan. Hanya ${fmt(max)} ulasan pertama dari ${fmt(all.length)} yang akan dipilah.`
    : `Mode demo memproses ${fmt(max)} ulasan pertama dari ${fmt(all.length)} ulasan.`;
  $('#pv-login').hidden = !over || Boolean(account.email);

  const first = state.reviews.slice(0, 5);
  $('#pv-list-title').textContent = state.reviews.length > 5 ? '5 ulasan pertama' : 'Ulasan';
  $('#pv-list').replaceChildren(...first.map((r) => h('li', {},
    h('span', { class: 'pv-text' }, r.text),
    r.rating != null && h('span', { class: 'rating' }, `★ ${r.rating}`))));
}

function goPreview() {
  state.allReviews = collectReviews();
  if (!state.allReviews.length) return;
  renderPreview();
  show('preview');
}

/* ================= 3. Pemilahan ================= */
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function persist() {
  const s = state.session;
  if (!s || !getResults().size) return;
  const data = buildSession(s, state.reviews, getResults());
  try {
    await saveSession(data, Boolean(account.email));
  } catch (err) {
    if (!account.email) return; // IndexedDB tidak tersedia (mis. mode privat): abaikan
    await saveSession(data, false).catch(() => {});
    if (!s.warned) {
      s.warned = true;
      toast(`Gagal menyimpan ke akun: ${err.message} Sesi disimpan di browser ini.`, 'error', 7000);
    }
  }
}
const schedulePersist = debounce(persist, 800);

function updateProgress() {
  const run = state.run;
  if (!run) return;
  const total = state.reviews.length;
  const done = getResults().size;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const remaining = total - done;

  const card = $('#progress-card');
  const btn = $('#btn-progress');
  card.classList.toggle('running', run.status === 'running');
  card.classList.toggle('done', run.status === 'done' && !remaining);
  card.classList.toggle('warn', run.status !== 'running' && remaining > 0);
  $('#progress-bar').style.width = `${percent}%`;
  $('#progress').setAttribute('aria-valuenow', percent);
  $('#btn-insight').disabled = run.status === 'running' || !done;

  let label;
  btn.hidden = false;
  if (run.status === 'running') {
    label = `Memproses ${fmt(done)} dari ${fmt(total)} ulasan…`;
    btn.textContent = 'Batalkan';
  } else if (run.status === 'cancelled') {
    label = `Dihentikan · ${fmt(done)} dari ${fmt(total)} ulasan dipilah`;
    btn.textContent = `Lanjutkan (${fmt(remaining)} tersisa)`;
  } else if (run.status === 'error') {
    label = run.error;
    btn.textContent = 'Coba lagi';
  } else if (remaining) {
    label = `Selesai · ${fmt(done)} dipilah, ${fmt(remaining)} gagal`;
    btn.textContent = 'Coba lagi yang gagal';
  } else {
    label = `Selesai · ${fmt(done)} ulasan dipilah`;
    btn.hidden = true;
  }
  $('#progress-label').textContent = label;
}

async function runClassification() {
  const pending = state.reviews.filter((r) => !getResults().has(r.id));
  const controller = new AbortController();
  const run = { status: 'running', controller, error: '' };
  state.run = run;
  setRunning(true);
  updateProgress();

  const categories = state.session.topics;
  const batches = chunk(pending, BATCH_SIZE);
  let next = 0;
  let lastError = null;

  const worker = async () => {
    while (next < batches.length && !controller.signal.aborted) {
      const batch = batches[next++];
      try {
        const res = await api.classify(batch, controller.signal, categories);
        if (state.run !== run) return;
        addResults(res.results);
        schedulePersist();
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (api.isFatal(err)) {
          run.error = err.message;
          controller.abort();
          return;
        }
        lastError = err;
      }
      updateProgress();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (state.run !== run) return; // sudah diganti oleh proses baru
  run.status = run.error ? 'error' : controller.signal.aborted ? 'cancelled' : 'done';
  setRunning(false);
  updateProgress();
  persist();

  const failed = state.reviews.length - getResults().size;
  if (run.status === 'error') toast(run.error, 'error', 7000);
  else if (run.status === 'done' && failed && lastError) toast(`${fmt(failed)} ulasan gagal diproses. ${lastError.message}`, 'error', 7000);
  else if (run.status === 'done' && !failed) toast('Semua ulasan selesai dipilah dan tersimpan di riwayat.');
}

function stopRun() {
  state.run?.controller.abort();
  state.run = null;
}

function start() {
  if (!hasTopics()) {
    $('#topics-error').hidden = false;
    $('#topic-input').focus();
    return;
  }
  stopRun();
  state.session = {
    id: uuid(),
    title: sourceTitle(),
    created_at: new Date().toISOString(),
    topics: getTopics(),
    insight: null,
  };
  resetResults(state.reviews);
  renderInsight(null);
  show('results');
  runClassification();
}

async function openSession(where, id) {
  try {
    const data = await loadSession(where, id);
    if (!data) throw new Error('Sesi tidak ditemukan.');
    stopRun();
    state.reviews = data.reviews;
    state.session = {
      id: data.id, title: data.title, created_at: data.created_at, topics: data.topics, insight: data.insight || null,
    };
    resetResults(state.reviews);
    addResults(data.results);
    renderInsight(state.session.insight);
    state.run = {
      status: data.results.length >= data.reviews.length ? 'done' : 'cancelled',
      controller: new AbortController(),
      error: '',
    };
    setRunning(false);
    updateProgress();
    show('results');
  } catch (err) {
    toast(err.message || 'Gagal membuka sesi.', 'error');
  }
}

function initResultsView() {
  initResults();
  $('#btn-start').addEventListener('click', start);
  $('#btn-back').addEventListener('click', () => show('input'));
  $('#pv-login').addEventListener('click', () => openAuth('login'));

  $('#btn-progress').addEventListener('click', () => {
    if (state.run?.status === 'running') state.run.controller.abort();
    else runClassification();
  });

  $('#btn-insight').addEventListener('click', async () => {
    const items = getItems();
    if (!items.length) return;
    const data = await generateInsight(items);
    if (data && state.session) {
      state.session.insight = data;
      persist();
    }
  });

  $('#btn-new').addEventListener('click', () => {
    if (state.run?.status === 'running' && !confirm('Pemilahan sedang berjalan dan akan dihentikan. Mulai baru?')) return;
    stopRun();
    state.reviews = [];
    state.allReviews = [];
    state.session = null;
    state.upload = null;
    $('#paste-input').value = '';
    $('#file-input').value = '';
    $('#column-picker').hidden = true;
    uploadStatus('');
    resetResults([]);
    setTab('paste');
    show('input');
  });

  const menu = $('#export-menu');
  menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-export]');
    if (!btn) return;
    menu.open = false;
    if (!getResults().size) {
      toast('Belum ada hasil untuk diekspor.');
      return;
    }
    try {
      const { exportResults } = await import('./export.js');
      await exportResults(btn.dataset.export, state.reviews, getResults());
      toast('File hasil sedang diunduh.');
    } catch (err) {
      toast(err.message || 'Gagal mengekspor file.', 'error');
    }
  });
  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
}

/* ================= 4. Riwayat ================= */
function sentimentBar(counts, done) {
  const seg = (key, cls) => counts[key] ? h('span', { class: `seg ${cls}`, style: `width:${pct(counts[key], done)}%` }) : null;
  return h('span', { class: 'bar-track history-bar', 'aria-hidden': 'true' },
    seg('positive', 'seg-positive'), seg('neutral', 'seg-neutral'), seg('negative', 'seg-negative'));
}

function historyItem(where, m) {
  const date = new Date(m.updated_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  const counts = m.counts || {};
  const done = m.done_count || 0;
  const unfinished = done < m.review_count;
  return h('li', { class: 'history-item' },
    h('button', { class: 'history-open', type: 'button', onclick: () => openSession(where, m.id) },
      h('span', { class: 'history-top' },
        h('span', { class: 'history-title' }, m.title),
        unfinished && h('span', { class: 'badge badge-medium' }, `Belum selesai · ${fmt(done)}/${fmt(m.review_count)}`)),
      h('span', { class: 'history-meta' },
        `${date} · ${fmt(m.review_count)} ulasan · ${pct(counts.positive || 0, done)}% positif · ${pct(counts.negative || 0, done)}% negatif`),
      sentimentBar(counts, done)),
    h('button', {
      class: 'btn btn-ghost btn-small history-delete', type: 'button', 'aria-label': `Hapus sesi ${m.title}`,
      onclick: async () => {
        if (!confirm(`Hapus sesi "${m.title}"?`)) return;
        try {
          await deleteSession(where, m.id);
          toast('Sesi dihapus.');
          renderHistory();
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    }, 'Hapus'));
}

function historyGroup(title, where, items) {
  return h('section', { class: 'history-group' },
    title && h('h2', { class: 'history-group-title' }, title),
    items.length
      ? h('ul', { class: 'history-list' }, items.map((m) => historyItem(where, m)))
      : h('p', { class: 'hint' }, 'Belum ada sesi.'));
}

async function renderHistory() {
  $('#history-note').replaceChildren(...(account.email
    ? [`Sesi tersimpan di akun ${account.email} dan bisa dibuka dari perangkat lain.`]
    : ['Sesi tersimpan di browser ini saja.',
      h('button', { class: 'btn btn-link btn-small', type: 'button', onclick: () => openAuth('login') }, 'Masuk untuk menyimpan di akun')]));

  const content = $('#history-content');
  content.replaceChildren(h('p', { class: 'hint' }, 'Memuat riwayat…'));
  let data;
  try {
    data = await listSessions(Boolean(account.email));
  } catch (err) {
    content.replaceChildren(h('p', { class: 'field-error' }, err.message));
    return;
  }
  if (!data.account.length && !data.local.length) {
    content.replaceChildren(h('div', { class: 'empty' },
      h('p', {}, 'Belum ada riwayat. Sesi pemilahan akan tersimpan otomatis di sini.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => show('input') }, 'Pilah ulasan sekarang')));
    return;
  }
  const groups = [];
  if (account.email) groups.push(historyGroup('Di akun Anda', 'account', data.account));
  if (data.local.length) groups.push(historyGroup(account.email ? 'Di browser ini' : null, 'local', data.local));
  content.replaceChildren(...groups);
}

function initHistoryView() {
  $('#btn-history').addEventListener('click', () => show('history'));
  $('#btn-history-back').addEventListener('click', () => {
    const target = state.backTo;
    show((target === 'preview' || target === 'results') && !state.reviews.length ? 'input' : target);
  });
}

function onAccountChange() {
  if (state.view === 'preview' && state.allReviews.length) renderPreview();
  if (state.view === 'history') renderHistory();
}

addEventListener('beforeunload', (e) => {
  if (state.run?.status === 'running') e.preventDefault();
});

/* ================= Mulai ================= */
initTheme();
initInput();
initTopics();
initResultsView();
initHistoryView();
renderInsight(null);
history.replaceState({ view: 'input' }, '', location.pathname);
updateInputState();
initAuth(onAccountChange);
checkHealth();
