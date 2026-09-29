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

// 分頁（權限用）
const TABS = [
  ['shop', 'viewShop'],
  ['dinner', 'viewDinner'],
  ['chores', 'viewChores'],
  ['wallet', 'viewWallet'],
];
const DEFAULT_TABS = ['shop', 'dinner'];
const tabIcon = (key) => t(key).split(' ')[0];

// 👑 管理員：每部機嘅級別同分頁；未有管理員嘅家庭可以撳「我係管理員」
export function openDevices({ state, onRotated }) {
  const store = state.store;
  const fid = state.familyId;
  let unsub = null;
  let devices = [];
  const access = () => state.access || {};
  const manage = () => !access().hasAdmin || access().admin; // 可以移除機 / 換代碼
  const canGrant = () => access().hasAdmin && access().admin; // 可以改權限

  const accessText = (dv) => {
    if (!access().hasAdmin) return '';
    if (dv.role === 'admin') return `👑 ${t('roleAdmin')}`;
    const tabs = Array.isArray(dv.tabs) ? dv.tabs : DEFAULT_TABS;
    const icons = TABS.filter(([v]) => tabs.includes(v)).map(([, key]) => tabIcon(key)).join(' ');
    return `${t('roleMember')} · ${icons || t('noTabsShort')}${Array.isArray(dv.tabs) ? '' : ` · 🆕 ${t('defaultTabs')}`}`;
  };

  const draw = (dlg, error) => {
    // 對話框已經換咗內容（例如開咗「權限」）：唔再更新
    if (!$('.device-body', dlg)) return unsub?.();
    const me = store.uid;
    const legacy = !state.family?.joinCode;
    const list = [...devices].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : (b.lastSeen || 0) - (a.lastSeen || 0)));
    const claim = !legacy && !access().hasAdmin && store.mode !== 'local';
    $('.device-body', dlg).innerHTML = error
      ? `<div class="demo-note">${esc(t('rulesOutdated'))}</div>`
      : `${legacy ? `<div class="demo-note small">${esc(t('legacyNote'))}</div>` : ''}
        ${claim ? `<div class="demo-note small">${esc(t('claimAdminHint'))}<br><button type="button" class="btn primary small-btn claim-admin">👑 ${esc(t('claimAdmin'))}</button></div>` : ''}
        ${access().hasAdmin && !access().admin ? `<p class="small muted">${esc(t('notAdminHint'))}</p>` : ''}
        <ul class="items device-list">${list
          .map(
            (dv) => `<li class="item"><div class="toggle">
              <span class="body"><span class="name">${esc(dv.name || '—')}</span>${dv.id === me ? ` <span class="pill">${esc(t('thisDevice'))}</span>` : ''}
                <div class="meta">${esc(dv.label || t('unknownDevice'))}${dv.lastSeen ? ` · ${esc(t('lastSeen', { time: timeAgo(dv.lastSeen) }))}` : ''}</div>
                ${accessText(dv) ? `<div class="meta access-line">${esc(accessText(dv))}</div>` : ''}</span>
            </div>
            <div class="device-actions">
              ${canGrant() && dv.id !== me ? `<button type="button" class="btn small-btn device-access" data-uid="${esc(dv.id)}">${esc(t('accessBtn'))}</button>` : ''}
              ${manage() && dv.id !== me ? `<button type="button" class="btn danger small-btn device-remove" data-uid="${esc(dv.id)}" data-name="${esc(dv.name || dv.label || '')}">${esc(t('removeDevice'))}</button>` : ''}
            </div>
            </li>`,
          )
          .join('')}</ul>`;
    $('#rotate-code', dlg).classList.toggle('hidden', !manage());
  };

  const reopen = () => openDevices({ state, onRotated });

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
        (list) => {
          devices = list;
          draw(dlg);
        },
        (err) => {
          console.warn(err);
          draw(dlg, err);
        },
      );
      // 由另一個對話框轉過嚟時，上一個嘅 close 事件會遲啲先到：對話框仲開住就唔好停
      const onClose = () => {
        if (dlg.open) return;
        unsub?.();
        dlg.removeEventListener('close', onClose);
      };
      dlg.addEventListener('close', onClose);

      $('.device-body', dlg).onclick = async (e) => {
        if (e.target.closest('.claim-admin')) {
          try {
            await store.claimAdmin(fid);
            toast(t('claimed'));
            setTimeout(reopen, 300);
          } catch (err) {
            if (err?.code === 'permission-denied') toast(t('rulesOutdated'));
            else fail(err);
          }
          return;
        }
        const acc = e.target.closest('.device-access');
        if (acc) return openAccess(devices.find((d) => d.id === acc.dataset.uid));
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

  // 改某部機：屋企人（揀分頁）或者管理員（全部）
  function openAccess(dv) {
    if (!dv) return;
    const tabs = Array.isArray(dv.tabs) ? dv.tabs : DEFAULT_TABS;
    openDialog(
      `<form id="access-form">
        <h2>${esc(t('accessTitle', { name: dv.name || dv.label || '—' }))}</h2>
        <div class="field"><span>${esc(t('roleLabel'))}</span>
          <div class="segmented">${[
            ['member', t('roleMember')],
            ['admin', `👑 ${t('roleAdmin')}`],
          ]
            .map(([v, l]) => `<label><input type="radio" name="role" value="${v}" ${(dv.role === 'admin' ? 'admin' : 'member') === v ? 'checked' : ''}><span>${esc(l)}</span></label>`)
            .join('')}</div>
          <p class="small muted">${esc(t('roleHint'))}</p></div>
        <div class="field tabs-field"><span>${esc(t('accessTabs'))}</span>
          <div class="cats">${TABS.map(([v, key]) => `<label><input type="checkbox" name="tabs" value="${v}" ${tabs.includes(v) ? 'checked' : ''}><span>${esc(t(key))}</span></label>`).join('')}</div>
          <p class="small muted">${esc(t('accessTabsHint'))}</p></div>
        <div class="actions"><span class="spacer"></span>
          <button type="button" class="btn" id="access-back">${esc(t('cancel'))}</button>
          <button class="btn primary">${esc(t('save'))}</button>
        </div>
      </form>`,
      (dlg) => {
        const form = $('#access-form', dlg);
        const sync = () => $('.tabs-field', dlg).classList.toggle('hidden', form.querySelector('input[name="role"]:checked').value === 'admin');
        form.querySelectorAll('input[name="role"]').forEach((r) => (r.onchange = sync));
        sync();
        $('#access-back', dlg).onclick = reopen;
        form.onsubmit = async (e) => {
          e.preventDefault();
          const f = new FormData(form);
          const role = f.get('role') === 'admin' ? 'admin' : 'member';
          const patch = role === 'admin' ? { role } : { role, tabs: TABS.map(([v]) => v).filter((v) => f.getAll('tabs').includes(v)) };
          try {
            await store.setDeviceAccess(fid, dv.id, patch);
            toast(t('accessSaved', { name: dv.name || '' }));
          } catch (err) {
            fail(err);
          }
          reopen();
        };
      },
    );
  }
}
