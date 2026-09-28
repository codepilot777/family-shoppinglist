// 📲 安裝到主畫面：Android / 電腦 Chrome 用瀏覽器內置安裝提示；iPhone 冇呢個功能，就顯示圖文步驟。
import { t } from './i18n.js';
import { $, esc, toast, openDialog } from './ui.js';

let deferredPrompt = null;
let installedHere = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

// 要喺 app 一開始就聽，否則會錯過瀏覽器發出嘅事件
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installedHere = true;
  toast(t('installed'));
  notify();
});

export const onInstallChange = (fn) => listeners.add(fn);

export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);
const isInAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp/i.test(navigator.userAgent);

// 已經喺主畫面 app 入面就唔使顯示個掣
export const canInstall = () => !isStandalone() && !installedHere;

const steps = (key) => `<ol class="steps">${t(key).split('|').map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;

// inviteLink：iPhone 主畫面 app 同 Safari 資料分開，裝完要再加入家庭
export async function openInstall({ inviteLink, familyId } = {}) {
  if (deferredPrompt) {
    const prompt = deferredPrompt;
    deferredPrompt = null;
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    notify();
    return;
  }

  let body;
  if (isInAppBrowser()) body = `<p>${esc(t('installInApp'))}</p>`;
  else if (isIOS()) {
    body = steps('installIOS');
    if (familyId)
      body += `<div class="demo-note small">${esc(t('installIOSRejoin', { code: familyId }))}</div>
        <button type="button" class="btn block" id="copy-invite">🔗 ${esc(t('copyInvite'))}</button>`;
  } else if (isAndroid()) body = steps('installAndroid');
  else body = `<p>${esc(t('installDesktop'))}</p>`;

  openDialog(
    `<h2>📲 ${esc(t('installTitle'))}</h2>
    ${body}
    <div class="actions"><span class="spacer"></span><button class="btn primary" data-close>${esc(t('close'))}</button></div>`,
    (d) => {
      $('#copy-invite', d)?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(inviteLink);
          toast(t('copied'));
        } catch {
          toast(t('copyFailed'));
        }
      });
    },
  );
}
