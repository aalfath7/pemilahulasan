import * as api from './api.js';
import { $, h, toast } from './util.js';

export const account = { email: null, maxReviews: 200 };

let mode = 'login';
let onChange = () => {};

function apply(me) {
  account.email = me.email;
  account.maxReviews = me.max_reviews;
  renderButton();
  onChange();
}

function renderButton() {
  const slot = $('#account-slot');
  if (!account.email) {
    slot.replaceChildren(h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => openAuth('login') }, 'Masuk'));
    return;
  }
  const menu = h('details', { class: 'menu' },
    h('summary', { class: 'btn btn-ghost btn-small account-btn', 'aria-label': `Akun ${account.email}` },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, account.email[0].toUpperCase()),
      h('span', { class: 'account-email' }, account.email)),
    h('div', { class: 'menu-list' },
      h('p', { class: 'menu-note' }, `Masuk sebagai ${account.email}`),
      h('button', { type: 'button', onclick: doLogout }, 'Keluar')));
  slot.replaceChildren(menu);
}

async function doLogout() {
  try {
    apply(await api.logout());
    toast('Anda sudah keluar.');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function setMode(next) {
  mode = next;
  const login = mode === 'login';
  $('#auth-title').textContent = login ? 'Masuk' : 'Buat akun';
  $('#auth-submit').textContent = login ? 'Masuk' : 'Daftar';
  $('#auth-switch-text').textContent = login ? 'Belum punya akun?' : 'Sudah punya akun?';
  $('#auth-switch').textContent = login ? 'Daftar gratis' : 'Masuk';
  $('#auth-password').autocomplete = login ? 'current-password' : 'new-password';
  $('#auth-error').hidden = true;
}

export function openAuth(next = 'login') {
  setMode(next);
  $('#auth').showModal();
  $('#auth-email').focus();
}

export async function initAuth(changed) {
  onChange = changed;
  const dialog = $('#auth');
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
  $('#auth-switch').addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));
  document.addEventListener('click', (e) => {
    const menu = $('#account-slot details');
    if (menu?.open && !menu.contains(e.target)) menu.open = false;
  });

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const error = $('#auth-error');
    const submit = $('#auth-submit');
    if (password.length < 8) {
      error.textContent = 'Password minimal 8 karakter.';
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    try {
      const me = mode === 'login' ? await api.login(email, password) : await api.register(email, password);
      dialog.close();
      $('#auth-form').reset();
      apply(me);
      toast(mode === 'login' ? `Selamat datang kembali, ${me.email}.` : 'Akun dibuat. Riwayat kini tersimpan di akun Anda.');
    } catch (err) {
      error.textContent = err.status === 422 ? 'Periksa kembali format email dan password.' : err.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  renderButton();
  try {
    apply(await api.me());
  } catch { /* server belum siap; tetap mode tamu */ }
}
