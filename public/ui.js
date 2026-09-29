// 共用介面小工具（購物清單同食飯頁都用）
import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const ls = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {}
  },
};
export const clean = (s, max) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
let toastTimer;
export function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action)
    el.querySelector('button').onclick = () => {
      el.classList.remove('show');
      action.run();
    };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2500);
}

export function fail(err) {
  console.error(err);
  const msg = err?.code === 'permission-denied' ? t('permissionDenied') : err?.message || String(err);
  toast(t('errorPrefix', { msg }));
}

export function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return t('justNow');
  if (s < 3600) return t('minutesAgo', { n: Math.floor(s / 60) });
  if (s < 86400) return t('hoursAgo', { n: Math.floor(s / 3600) });
  return t('daysAgo', { n: Math.floor(s / 86400) });
}

const dialog = $('#dialog');
export function openDialog(html, setup) {
  if (dialog.open) dialog.close();
  dialog.innerHTML = html;
  setup?.(dialog);
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dialog.close()));
}
export const closeDialog = () => dialog.open && dialog.close();
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});

export function confirmDialog(message, okLabel, onOk) {
  openDialog(
    `<h2>${esc(message)}</h2>
    <div class="actions"><span class="spacer"></span>
      <button class="btn" data-close>${esc(t('cancel'))}</button>
      <button class="btn primary" id="ok">${esc(okLabel)}</button>
    </div>`,
    (d) => {
      $('#ok', d).onclick = () => {
        d.close();
        onOk();
      };
    },
  );
}

