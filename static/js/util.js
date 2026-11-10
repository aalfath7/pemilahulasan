export const $ = (sel, root = document) => root.querySelector(sel);

/** Buat elemen DOM: h('div', { class: 'x', onclick }, child1, child2) */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}

export const SENTIMENT = { positive: 'Positif', neutral: 'Netral', negative: 'Negatif' };
export const URGENCY = { low: 'Rendah', medium: 'Sedang', high: 'Tinggi' };

export const fmt = (n) => n.toLocaleString('id-ID');
export const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);
export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Dibatalkan', 'AbortError'));
    }, { once: true });
  });
}

export function toast(message, type = 'info', ms = 4500) {
  const node = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  $('#toasts').append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 200);
  }, ms);
}

export function parseRating(value) {
  if (value == null) return null;
  const match = String(value).replace(',', '.').match(/\d+(\.\d+)?/);
  if (match) return Number(match[0]);
  const stars = (String(value).match(/★/g) || []).length;
  return stars || null;
}
