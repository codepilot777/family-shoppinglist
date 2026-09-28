// 📱 已連接嘅機：睇有邊幾部機、移除某部機、換新邀請代碼。
import { t } from './i18n.js';
import { $, esc, toast, fail, timeAgo, openDialog, confirmDialog } from './ui.js';
import { isStandalone } from './install.js';

// 例如「iPhone · Safari · 📲」（📲 = 主畫面 app）
export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : '';
  const browser = /EdgA?\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /FxiOS|Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  return [os, browser].filter(Boolean).join(' · ') + (isStandalone() ? ' · 📲' : '');
}

// 家庭代碼：「家庭ID-邀請碼」；舊式家庭未有邀請碼，就淨係家庭 ID
export const familyCode = (fid, joinCode) => (joinCode ? `${fid}-${joinCode}` : fid);

// 由連結或者代碼攞返 { fid, key }
export function parseFamilyCode(input) {
  const s = String(input || '').trim();
  const f = s.match(/[?&]f=([a-z0-9]+)/i)?.[1];
  if (f) return { fid: f.toLowerCase(), key: s.match(/[?&]k=([a-z0-9]+)/i)?.[1]?.toLowerCase() || '' };
  const [fid, key = ''] = s.toLowerCase().replace(/\s+/g, '').split('-');
  return { fid: fid.replace(/[^a-z0-9]/g, ''), key: key.replace(/[^a-z0-9]/g, '') };
}

export function openDevices({ state, onRotated }) {
  const store = state.store;
  const fid = state.familyId;
  let unsub = null;

  const draw = (dlg, devices, error) => {
    const me = store.uid;
    const legacy = !state.family?.joinCode;
    const list = [...devices].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : (b.lastSeen || 0) - (a.lastSeen || 0)));
    $('.device-body', dlg).innerHTML = error
      ? `<div class="demo-note">${esc(t('rulesOutdated'))}</div>`
      : `${legacy ? `<div class="demo-note small">${esc(t('legacyNote'))}</div>` : ''}
        <ul class="items device-list">${list
          .map(
            (dv) => `<li class="item"><div class="toggle">
              <span class="body"><span class="name">${esc(dv.name || '—')}</span>${dv.id === me ? ` <span class="pill">${esc(t('thisDevice'))}</span>` : ''}
                <div class="meta">${esc(dv.label || t('unknownDevice'))}${dv.lastSeen ? ` · ${esc(t('lastSeen', { time: timeAgo(dv.lastSeen) }))}` : ''}</div></span>
            </div>
            ${dv.id === me ? '' : `<button type="button" class="btn danger small-btn device-remove" data-uid="${esc(dv.id)}" data-name="${esc(dv.name || dv.label || '')}">${esc(t('removeDevice'))}</button>`}
            </li>`,
          )
          .join('')}</ul>`;
  };

  openDialog(
    `<h2>${esc(t('devices'))}</h2>
    <p class="small muted">${esc(t('devicesHint'))}</p>
    <div class="device-body"><p class="muted">…</p></div>
    <div class="actions">
      <button type="button" class="btn" id="rotate-code">${esc(t('rotateCode'))}</button>
      <span class="spacer"></span>
      <button type="button" class="btn primary" data-close>${esc(t('close'))}</button>
    </div>`,
    (dlg) => {
      unsub = store.subscribeDevices(
        fid,
        (devices) => draw(dlg, devices),
        (err) => {
          console.warn(err);
          draw(dlg, [], err);
        },
      );
      // 由另一個對話框轉過嚟時，上一個嘅 close 事件會遲啲先到：對話框仲開住就唔好停
      const onClose = () => {
        if (dlg.open) return;
        unsub?.();
        dlg.removeEventListener('close', onClose);
      };
      dlg.addEventListener('close', onClose);

      $('.device-body', dlg).onclick = (e) => {
        const btn = e.target.closest('.device-remove');
        if (!btn) return;
        const uid = btn.dataset.uid;
        confirmDialog(t('removeDeviceConfirm', { name: btn.dataset.name }), t('removeDevice'), async () => {
          try {
            await store.removeDevice(fid, uid);
            toast(t('deviceRemoved'));
          } catch (err) {
            fail(err);
          }
        });
      };

      $('#rotate-code', dlg).onclick = () =>
        confirmDialog(t('rotateConfirm'), t('rotateCode'), async () => {
          try {
            const joinCode = await store.rotateJoinCode(fid);
            // 自己部機用新代碼記住（重新登記時用）
            onRotated?.(joinCode);
            toast(t('rotated'));
          } catch (err) {
            if (err?.code === 'permission-denied') toast(t('rulesOutdated'));
            else fail(err);
          }
        });
    },
  );
}
