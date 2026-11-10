import * as api from './api.js';
import { $, h, toast } from './util.js';

const drafts = new Map(); // id ulasan -> teks draf

export function resetDrafts() {
  drafts.clear();
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Disalin ke clipboard.');
  } catch {
    toast('Gagal menyalin. Salin manual dari kotak teks.', 'error');
  }
}

/* ---------- Insight keseluruhan ---------- */
function insightText(data) {
  const list = (title, items) => (items.length ? `${title}:\n${items.map((i) => `- ${i}`).join('\n')}` : '');
  return [data.overview, list('Yang disukai', data.liked), list('Keluhan utama', data.complaints), list('Saran perbaikan', data.suggestions)]
    .filter(Boolean).join('\n\n');
}

export function renderInsight(data) {
  const body = $('#insight-body');
  if (!data) {
    body.replaceChildren(h('p', { class: 'hint' }, 'Dapatkan ringkasan keseluruhan: hal yang disukai pelanggan, keluhan utama, dan saran perbaikan.'));
    $('#btn-insight').textContent = 'Buat insight';
    return;
  }
  const column = (title, tone, items) => h('div', { class: `insight-col insight-${tone}` },
    h('h3', {}, title),
    items.length ? h('ul', {}, items.map((i) => h('li', {}, i))) : h('p', { class: 'hint' }, 'Tidak ada data yang cukup.'));
  body.replaceChildren(
    h('p', { class: 'insight-overview' }, data.overview),
    h('div', { class: 'insight-grid' },
      column('Yang disukai', 'pos', data.liked),
      column('Keluhan utama', 'neg', data.complaints),
      column('Saran perbaikan', 'idea', data.suggestions)),
    h('div', { class: 'insight-actions' },
      h('button', { class: 'btn btn-link btn-small', type: 'button', onclick: () => copy(insightText(data)) }, 'Salin insight')),
  );
  $('#btn-insight').textContent = 'Buat ulang';
}

export async function generateInsight(items) {
  const btn = $('#btn-insight');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  $('#insight-body').replaceChildren(
    h('div', { class: 'insight-loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Menganalisis ulasan…'));
  try {
    const payload = items.map(({ sentiment, topics, urgency, summary, is_spam }) => ({ sentiment, topics, urgency, summary, is_spam }));
    const data = await api.insight(payload);
    renderInsight(data);
    return data;
  } catch (err) {
    renderInsight(null);
    toast(err.message, 'error', 6000);
    return null;
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

/* ---------- Draf balasan per ulasan ---------- */
export function replySection(it) {
  const output = h('textarea', { class: 'reply-text', rows: '4', 'aria-label': 'Draf balasan', hidden: !drafts.has(it.id) });
  output.value = drafts.get(it.id) || '';
  output.addEventListener('input', () => drafts.set(it.id, output.value));

  const tone = h('select', { class: 'reply-tone', 'aria-label': 'Nada balasan' },
    h('option', { value: 'ramah' }, 'Nada ramah'),
    h('option', { value: 'formal' }, 'Nada formal'));
  const copyBtn = h('button', { class: 'btn btn-secondary btn-small', type: 'button', hidden: !drafts.has(it.id), onclick: () => copy(output.value) }, 'Salin');
  const genBtn = h('button', { class: 'btn btn-primary btn-small', type: 'button' }, drafts.has(it.id) ? 'Buat ulang' : 'Buat draf balasan');

  genBtn.addEventListener('click', async () => {
    genBtn.disabled = true;
    genBtn.textContent = 'Menulis…';
    try {
      const { reply } = await api.reply({ text: it.text, sentiment: it.sentiment, topics: it.topics, tone: tone.value });
      drafts.set(it.id, reply);
      output.value = reply;
      output.hidden = false;
      copyBtn.hidden = false;
      output.focus();
    } catch (err) {
      toast(err.message, 'error', 6000);
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = drafts.has(it.id) ? 'Buat ulang' : 'Buat draf balasan';
    }
  });

  return h('section', { class: 'reply-box', 'aria-label': 'Draf balasan' },
    h('div', { class: 'reply-head' }, h('h3', {}, 'Balas ulasan'), tone),
    output,
    h('div', { class: 'reply-actions' }, copyBtn, genBtn));
}
