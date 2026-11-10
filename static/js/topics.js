import { $, h, capitalize } from './util.js';

const MAX_TOPICS = 12;
const STORAGE_KEY = 'topics';

export const PRESETS = {
  toko: { label: 'Toko online', topics: ['kualitas produk', 'harga', 'pengiriman', 'pelayanan', 'kemasan', 'aplikasi/website'] },
  restoran: { label: 'Restoran & kuliner', topics: ['rasa', 'porsi', 'harga', 'pelayanan', 'kebersihan', 'suasana', 'waktu tunggu'] },
  aplikasi: { label: 'Aplikasi', topics: ['bug/error', 'fitur', 'tampilan', 'performa', 'harga langganan', 'layanan pelanggan'] },
  hotel: { label: 'Hotel & wisata', topics: ['kamar', 'kebersihan', 'pelayanan', 'lokasi', 'fasilitas', 'harga', 'makanan'] },
  jasa: { label: 'Jasa', topics: ['kualitas hasil', 'ketepatan waktu', 'harga', 'komunikasi', 'profesionalisme'] },
};

let topics = [...PRESETS.toko.topics];

const normalize = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
const same = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);

/** Daftar topik terpilih (tanpa "lainnya", ditambahkan otomatis oleh server). */
export const getTopics = () => [...topics];

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(topics)); } catch { /* abaikan */ }
}

function render() {
  const activePreset = Object.entries(PRESETS).find(([, p]) => same(p.topics, topics))?.[0];
  for (const btn of document.querySelectorAll('[data-preset]')) {
    btn.setAttribute('aria-checked', btn.dataset.preset === activePreset ? 'true' : 'false');
  }
  const custom = $('#preset-custom');
  custom.setAttribute('aria-checked', activePreset ? 'false' : 'true');

  const input = $('#topic-input');
  $('#topic-chips').replaceChildren(
    ...topics.map((t) => h('span', { class: 'chip chip-edit' }, capitalize(t),
      h('button', {
        type: 'button',
        'aria-label': `Hapus topik ${t}`,
        onclick: () => remove(t),
      }, '×'))),
    input,
  );
  input.disabled = topics.length >= MAX_TOPICS;
  input.placeholder = input.disabled ? `Maks. ${MAX_TOPICS} topik` : 'Tambah topik, tekan Enter';
  $('#topics-error').hidden = topics.length > 0;
  save();
}

function add(raw) {
  for (const part of raw.split(',')) {
    const t = normalize(part);
    if (t && t !== 'lainnya' && !topics.includes(t) && topics.length < MAX_TOPICS) topics.push(t);
  }
  render();
}

function remove(t) {
  topics = topics.filter((x) => x !== t);
  render();
  $('#topic-input').focus();
}

export function hasTopics() {
  return topics.length > 0;
}

export function initTopics() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) topics = saved.map(normalize).filter(Boolean).slice(0, MAX_TOPICS);
  } catch { /* abaikan */ }

  $('#presets').replaceChildren(
    ...Object.entries(PRESETS).map(([key, p]) => h('button', {
      type: 'button', role: 'radio', class: 'preset', 'data-preset': key, 'aria-checked': 'false',
      onclick: () => { topics = [...p.topics]; render(); },
    }, p.label)),
    h('button', {
      type: 'button', role: 'radio', class: 'preset', id: 'preset-custom', 'aria-checked': 'false',
      onclick: () => $('#topic-input').focus(),
    }, 'Kustom'),
  );

  const input = $('#topic-input');
  input.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
      e.preventDefault();
      add(input.value);
      input.value = '';
      input.focus();
    } else if (e.key === 'Backspace' && !input.value && topics.length) {
      topics.pop();
      render();
      input.focus();
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) {
      add(input.value);
      input.value = '';
    }
  });
  $('#topic-chips').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) input.focus();
  });
  render();
}
