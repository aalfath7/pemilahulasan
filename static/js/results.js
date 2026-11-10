import { replySection, resetDrafts } from './insight.js';
import { VirtualList } from './list.js';
import { $, h, fmt, pct, capitalize, debounce, SENTIMENT, URGENCY } from './util.js';

const URGENCY_RANK = { high: 0, medium: 1, low: 2 };
const SENTIMENT_RANK = { negative: 0, neutral: 1, positive: 2 };
const OTHER = 'lainnya';

let reviews = [];
let results = new Map();
let running = false;
let list;
let frame = 0;
const filters = { q: '', sentiment: '', topic: '', urgency: '', sort: 'original' };
const FILTER_INPUTS = { q: '#f-q', sentiment: '#f-sentiment', topic: '#f-topic', urgency: '#f-urgency', sort: '#f-sort' };

export function initResults() {
  list = new VirtualList($('#review-list'), renderRow);

  const onSearch = debounce((value) => setFilter('q', value), 150);
  $('#f-q').addEventListener('input', (e) => onSearch(e.target.value));
  for (const key of ['sentiment', 'topic', 'urgency', 'sort']) {
    $(FILTER_INPUTS[key]).addEventListener('change', (e) => setFilter(key, e.target.value));
  }
  $('#btn-reset').addEventListener('click', resetFilters);

  const dialog = $('#detail');
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
}

export function resetResults(newReviews) {
  reviews = newReviews;
  results = new Map();
  resetDrafts();
  resetFilters(false);
  render();
}

/** Ulasan yang sudah dipilah, berurutan sesuai input. */
export const getItems = () => classifiedItems();

export function addResults(items) {
  for (const item of items) results.set(item.id, item);
  scheduleRender();
}

export const getResults = () => results;

export function setRunning(value) {
  running = value;
  scheduleRender();
}

function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

function setFilter(key, value) {
  filters[key] = value;
  const input = $(FILTER_INPUTS[key]);
  if (input.value !== value) input.value = value;
  render();
}

function resetFilters(rerender = true) {
  Object.assign(filters, { q: '', sentiment: '', topic: '', urgency: '' });
  for (const key of ['q', 'sentiment', 'topic', 'urgency']) $(FILTER_INPUTS[key]).value = '';
  if (rerender) render();
}

function classifiedItems() {
  const items = [];
  reviews.forEach((review, index) => {
    const r = results.get(review.id);
    if (r) items.push({ ...review, ...r, index });
  });
  return items;
}

function render() {
  const items = classifiedItems();
  renderStats(items);
  renderChart(items);
  renderTopicOptions(items);
  renderList(items);
}

/* ---------- Ringkasan ---------- */
function stat({ label, value, sub, tone = '', filter }) {
  const active = filter && filters[filter[0]] === filter[1];
  const props = { class: `stat ${tone}${active ? ' active' : ''}` };
  if (filter) {
    Object.assign(props, {
      type: 'button',
      'aria-pressed': active ? 'true' : 'false',
      onclick: () => setFilter(filter[0], active ? '' : filter[1]),
    });
  }
  return h(filter ? 'button' : 'div', props,
    h('span', { class: 'stat-label' }, label),
    h('span', { class: 'stat-value' }, value),
    h('span', { class: 'stat-sub' }, sub));
}

function renderStats(items) {
  const n = items.length;
  const count = { positive: 0, neutral: 0, negative: 0 };
  let high = 0;
  let spam = 0;
  const negByTopic = new Map();
  for (const it of items) {
    count[it.sentiment]++;
    if (it.urgency === 'high') high++;
    if (it.is_spam) spam++;
    if (it.sentiment === 'negative') {
      for (const t of it.topics) negByTopic.set(t, (negByTopic.get(t) || 0) + 1);
    }
  }
  const ranked = [...negByTopic].sort((a, b) => b[1] - a[1]);
  const top = ranked.find(([t]) => t !== OTHER) || ranked[0];

  $('#stats').replaceChildren(
    stat({
      label: 'Ulasan dipilah', value: fmt(n), tone: 'stat-total',
      sub: spam ? `${fmt(spam)} terdeteksi spam` : `dari ${fmt(reviews.length)} ulasan`,
    }),
    stat({ label: 'Positif', value: `${pct(count.positive, n)}%`, sub: `${fmt(count.positive)} ulasan`, tone: 'stat-pos', filter: ['sentiment', 'positive'] }),
    stat({ label: 'Negatif', value: `${pct(count.negative, n)}%`, sub: `${fmt(count.negative)} ulasan`, tone: 'stat-neg', filter: ['sentiment', 'negative'] }),
    stat({ label: 'Urgensi tinggi', value: fmt(high), sub: 'perlu segera ditangani', tone: 'stat-urg', filter: ['urgency', 'high'] }),
    top
      ? stat({ label: 'Keluhan utama', value: capitalize(top[0]), sub: `${fmt(top[1])} ulasan negatif`, tone: 'stat-topic', filter: ['topic', top[0]] })
      : stat({ label: 'Keluhan utama', value: '–', sub: 'Belum ada keluhan', tone: 'stat-topic' }),
  );
}

/* ---------- Grafik topik ---------- */
function renderChart(items) {
  const agg = new Map();
  for (const it of items) {
    for (const t of it.topics) {
      const a = agg.get(t) || { topic: t, positive: 0, neutral: 0, negative: 0, total: 0 };
      a[it.sentiment]++;
      a.total++;
      agg.set(t, a);
    }
  }
  const rows = [...agg.values()].sort((a, b) => b.total - a.total);
  const max = rows[0]?.total || 1;
  const seg = (row, key) => row[key]
    ? h('span', { class: `seg seg-${key}`, style: `width:${(row[key] / max) * 100}%` })
    : null;

  $('#chart').replaceChildren(...(rows.length
    ? rows.map((row) => {
      const active = filters.topic === row.topic;
      return h('button', {
        class: `bar-row${active ? ' active' : ''}`,
        type: 'button',
        'aria-pressed': active ? 'true' : 'false',
        'aria-label': `${capitalize(row.topic)}: ${row.total} ulasan, ${row.positive} positif, ${row.neutral} netral, ${row.negative} negatif`,
        onclick: () => setFilter('topic', active ? '' : row.topic),
      },
      h('span', { class: 'bar-label' }, capitalize(row.topic)),
      h('span', { class: 'bar-track' }, seg(row, 'positive'), seg(row, 'neutral'), seg(row, 'negative')),
      h('span', { class: 'bar-value' }, fmt(row.total)));
    })
    : [h('p', { class: 'chart-empty' }, 'Grafik muncul setelah ulasan pertama selesai dipilah.')]));
}

function renderTopicOptions(items) {
  const topics = [...new Set(items.flatMap((it) => it.topics))].sort((a, b) => a.localeCompare(b, 'id'));
  const select = $('#f-topic');
  const current = [...select.options].slice(1).map((o) => o.value).join('|');
  if (current === topics.join('|')) return;
  select.replaceChildren(
    h('option', { value: '' }, 'Semua topik'),
    ...topics.map((t) => h('option', { value: t }, capitalize(t))),
  );
  select.value = filters.topic;
}

/* ---------- Daftar ---------- */
function applyFilters(items) {
  const q = filters.q.trim().toLowerCase();
  const out = items.filter((it) =>
    (!filters.sentiment || (filters.sentiment === 'spam' ? it.is_spam : it.sentiment === filters.sentiment))
    && (!filters.topic || it.topics.includes(filters.topic))
    && (!filters.urgency || it.urgency === filters.urgency)
    && (!q || it.text.toLowerCase().includes(q) || it.summary.toLowerCase().includes(q)));

  if (filters.sort === 'urgency') {
    out.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
      || SENTIMENT_RANK[a.sentiment] - SENTIMENT_RANK[b.sentiment] || a.index - b.index);
  } else if (filters.sort === 'confidence') {
    out.sort((a, b) => a.confidence - b.confidence || a.index - b.index);
  }
  return out;
}

function renderList(items) {
  const shown = applyFilters(items);
  const filtered = Boolean(filters.q || filters.sentiment || filters.topic || filters.urgency);

  $('#list-count').textContent = !items.length
    ? (running ? 'Menunggu hasil pertama…' : '')
    : filtered ? `Menampilkan ${fmt(shown.length)} dari ${fmt(items.length)} ulasan` : `${fmt(items.length)} ulasan`;
  $('#btn-reset').hidden = !filtered;
  $('#skeletons').hidden = !(running && !items.length);
  $('#list-empty').hidden = !(items.length && !shown.length);
  list.setItems(shown);
}

function badges(it) {
  return [
    h('span', { class: `badge badge-${it.sentiment}` }, SENTIMENT[it.sentiment]),
    it.urgency !== 'low' && h('span', { class: `badge badge-${it.urgency}` }, `Urgensi ${URGENCY[it.urgency].toLowerCase()}`),
    it.is_spam && h('span', { class: 'badge badge-spam' }, 'Spam'),
    ...it.topics.map((t) => h('span', { class: 'chip' }, capitalize(t))),
  ];
}

function renderRow(it) {
  return h('article', {
    class: `vrow review s-${it.sentiment}`,
    role: 'listitem',
    tabindex: '0',
    'aria-label': `${SENTIMENT[it.sentiment]}, urgensi ${URGENCY[it.urgency].toLowerCase()}: ${it.text}`,
    onclick: () => openDetail(it),
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail(it);
      }
    },
  },
  h('div', { class: 'review-meta' }, badges(it), it.rating != null && h('span', { class: 'rating' }, `★ ${it.rating}`)),
  h('p', { class: 'review-text' }, it.text),
  h('p', { class: 'review-summary' }, `↳ ${it.summary}`));
}

function openDetail(it) {
  const row = (label, ...value) => [h('dt', {}, label), h('dd', {}, ...value)];
  const conf = Math.round(it.confidence * 100);
  $('#detail-body').replaceChildren(
    h('p', { class: 'detail-text' }, it.text),
    h('dl', { class: 'detail-grid' },
      row('Sentimen', h('span', { class: `badge badge-${it.sentiment}` }, SENTIMENT[it.sentiment])),
      row('Keyakinan', h('span', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: `width:${conf}%` })), `${conf}%`),
      row('Topik', ...it.topics.map((t) => h('span', { class: 'chip' }, capitalize(t)))),
      row('Urgensi', h('span', { class: `badge badge-${it.urgency === 'low' ? 'neutral' : it.urgency}` }, URGENCY[it.urgency])),
      row('Ringkasan', it.summary),
      it.rating != null && row('Rating', h('span', { class: 'rating' }, `★ ${it.rating}`)),
      it.is_spam && row('Spam', h('span', { class: 'badge badge-spam' }, 'Terdeteksi spam'))),
    replySection(it),
  );
  $('#detail').showModal();
}
