// 💰 家用（買餸錢包）：餘額、記支出（連單據相）、入錢前對數、每月總結、匯出 CSV。
import { t, getLang, langInfo } from './i18n.js';
import { $, esc, clean, toast, fail, openDialog, confirmDialog } from './ui.js';
import { hkToday, formatDay } from './dates.js';
import { toCents, balance, monthSummary, lastTopup, byNewest, toCSV, DEFAULT_LOW } from './wallet.js';
import { lookup } from './translate.js';
import { compressImage } from './image.js';

const RECEIPT_OPTS = { maxSide: 1600, maxChars: 700_000, quality: 0.85 };
const MAX_RECEIPTS = 3;
const PLACES = ['街市', '超市', '藥房', '麵包舖', '其他'];

let ctx;
let entries = [];
let month = hkToday().slice(0, 7);

export function initWallet(context) {
  ctx = context;
}

const state = () => ctx.state;
const store = () => state().store;
const fid = () => state().familyId;
const tr = (zh) => lookup(zh)?.[getLang()] || zh; // 地方、貨品跟語言顯示
const lowLimit = () => (Number.isInteger(state().family?.walletLow) ? state().family.walletLow : DEFAULT_LOW);

export function fmtMoney(cents, { sign = false } = {}) {
  const abs = Math.abs(cents) / 100;
  const txt = abs.toLocaleString(langInfo().htmlLang, { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return `${cents < 0 ? '−' : sign && cents > 0 ? '+' : ''}$${txt}`;
}

export function walletOnEnterFamily(familyId) {
  entries = [];
  return [
    store().subscribeWallet(
      familyId,
      (list) => {
        entries = list;
        renderWallet();
      },
      fail,
    ),
  ];
}

const monthLabel = (m) =>
  new Intl.DateTimeFormat(langInfo().htmlLang, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
const shiftMonth = (m, n) => {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

// ---------- 畫面 ----------

export function renderWallet() {
  const root = $('#wallet');
  if (!root || root.classList.contains('hidden')) return;
  const bal = balance(entries);
  const last = lastTopup(entries);
  const low = bal < lowLimit();
  const sum = monthSummary(entries, month);
  const list = entries.filter((e) => (e.date || '').startsWith(month)).sort(byNewest);
  const maxPlace = Math.max(1, ...Object.values(sum.byPlace));

  let html = `<section class="card wallet-card ${low ? 'low' : ''}">
    <div class="muted small">${esc(t('walletBalance'))}</div>
    <div class="big-count">${esc(fmtMoney(bal))}</div>
    ${low ? `<div class="pill late">⚠️ ${esc(t('walletLow', { amount: fmtMoney(lowLimit()) }))}</div>` : ''}
    ${last ? `<p class="small muted">${esc(t('walletLastTopup', { day: formatDay(last.date, langInfo().htmlLang), who: last.by || '', amount: fmtMoney(last.amount) }))}</p>` : ''}
    <div class="row wallet-actions">
      <button class="btn primary" id="w-expense">➖ ${esc(t('walletAddExpense'))}</button>
      <button class="btn" id="w-topup">➕ ${esc(t('walletTopup'))}</button>
    </div>
  </section>`;

  html += `<div class="month-nav">
    <button class="icon-btn" id="w-prev" aria-label="‹">‹</button>
    <b>${esc(monthLabel(month))}</b>
    <button class="icon-btn" id="w-next" aria-label="›" ${month >= hkToday().slice(0, 7) ? 'disabled' : ''}>›</button>
  </div>
  <section class="card small-card">
    <div class="month-total"><span>${esc(t('walletSpent'))}</span><b>${esc(fmtMoney(sum.spent))}</b></div>
    <p class="small muted">${esc(t('walletMonthMeta', { n: sum.count, topup: fmtMoney(sum.toppedUp) }))}${sum.adjusted ? ` · ${esc(t('walletAdjustedTotal', { amount: fmtMoney(sum.adjusted, { sign: true }) }))}` : ''}</p>
    ${Object.entries(sum.byPlace)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([p, c]) => `<div class="place-bar"><span>${esc(tr(p))}</span><i style="width:${Math.round((c / maxPlace) * 100)}%"></i><b>${esc(fmtMoney(c))}</b></div>`,
      )
      .join('')}
  </section>`;

  html += list.length ? `<ul class="items wallet-list">${list.map(entryRow).join('')}</ul>` : `<div class="empty"><div class="big">💰</div><p>${esc(t('walletEmpty'))}</p></div>`;

  html += `<div class="dinner-actions">
    <button class="btn" id="w-export">📤 ${esc(t('walletExport'))}</button>
    <button class="btn" id="w-settings">⚙️ ${esc(t('walletLowSetting', { amount: fmtMoney(lowLimit()) }))}</button>
  </div>`;

  root.innerHTML = html;
  $('#w-expense', root).onclick = () => openExpense();
  $('#w-topup', root).onclick = openTopup;
  $('#w-prev', root).onclick = () => {
    month = shiftMonth(month, -1);
    renderWallet();
  };
  $('#w-next', root).onclick = () => {
    month = shiftMonth(month, 1);
    renderWallet();
  };
  $('#w-export', root).onclick = exportCSV;
  $('#w-settings', root).onclick = openLowSetting;
  root.querySelectorAll('[data-entry]').forEach((b) => (b.onclick = () => openEntry(entries.find((e) => e.id === b.dataset.entry))));
}

function entryRow(e) {
  const icon = e.type === 'expense' ? '➖' : e.type === 'topup' ? '➕' : '⚖️';
  const title = e.type === 'expense' ? tr(e.place || t('walletExpense')) : e.type === 'topup' ? t('walletTopupEntry') : t('walletAdjustEntry');
  const amount = e.type === 'expense' ? -e.amount : e.amount;
  const meta = [
    formatDay(e.date, langInfo().htmlLang),
    e.by,
    (e.items || []).length ? (e.items || []).slice(0, 4).map(tr).join('、') + ((e.items || []).length > 4 ? '…' : '') : '',
    e.note,
  ]
    .filter(Boolean)
    .join(' · ');
  return `<li class="item"><button class="toggle" data-entry="${esc(e.id)}">
    <span class="w-icon" aria-hidden="true">${icon}</span>
    <span class="body"><span class="name">${esc(title)}</span>${(e.receipts || []).length ? ' <span class="small">📷</span>' : ''}
      <div class="meta">${esc(meta)}</div></span>
    <b class="w-amount ${amount < 0 ? 'neg' : 'pos'}">${esc(fmtMoney(amount, { sign: true }))}</b>
  </button></li>`;
}

// ---------- ➖ 記支出 ----------

// 啱啱剔咗「已買」嘅嘢（自己 12 個鐘內），方便連埋支出；已經記入另一筆支出嘅唔再列
function recentBought() {
  const since = Date.now() - 12 * 3600 * 1000;
  const recorded = new Set(
    entries.filter((e) => e.type === 'expense' && e.by === state().me && (e.createdAt || 0) >= since).flatMap((e) => e.items || []),
  );
  const mine = state().items.filter((i) => i.done && i.doneAt >= since && i.doneBy === state().me && !recorded.has(i.name));
  return [...new Set(mine.map((i) => i.name))];
}

function placeOptions(current) {
  const fromLists = state()
    .lists.filter((l) => l.kind !== 'wish')
    .map((l) => l.name);
  const all = [...new Set([...PLACES.slice(0, -1), ...fromLists, PLACES.at(-1)])];
  return all
    .map((p) => `<label><input type="radio" name="place" value="${esc(p)}" ${p === current ? 'checked' : ''}><span>${esc(tr(p))}</span></label>`)
    .join('');
}

async function addReceipt(file, ids) {
  if (ids.length >= MAX_RECEIPTS) return toast(t('maxPhotos', { n: MAX_RECEIPTS }));
  toast(t('processingPhoto'));
  try {
    const data = await compressImage(file, RECEIPT_OPTS);
    const { id, done } = store().addPhoto(fid(), data);
    done.catch(fail);
    ids.push(id);
    $('#toast').classList.remove('show');
    return data;
  } catch (err) {
    console.error(err);
    toast(t('photoFailed'));
  }
}

export function openExpense(entry) {
  const editing = !!entry;
  const bought = editing ? [] : recentBought();
  const receipts = editing ? [...(entry.receipts || [])] : [];
  openDialog(
    `<form id="expense-form">
      <h2>➖ ${esc(editing ? t('edit') : t('walletAddExpense'))}</h2>
      <label class="field"><span>${esc(t('walletAmount'))}</span>
        <input class="input money-input" name="amount" inputmode="decimal" autocomplete="off" required placeholder="0" value="${editing ? (entry.amount / 100).toString() : ''}"></label>
      <div class="field"><span>${esc(t('walletPlace'))}</span><div class="segmented">${placeOptions(entry?.place || PLACES[0])}</div></div>
      ${
        bought.length
          ? `<div class="field"><span>${esc(t('walletItems'))}</span><div class="cats">${bought
              .map((n) => `<label><input type="checkbox" name="items" value="${esc(n)}" checked><span>${esc(tr(n))}</span></label>`)
              .join('')}</div></div>`
          : editing && (entry.items || []).length
            ? `<p class="small muted">${esc((entry.items || []).map(tr).join('、'))}</p>`
            : ''
      }
      <div class="field"><span>🧾 ${esc(t('walletReceipt'))}</span>
        <div class="photo-row receipts"></div>
        <button type="button" class="btn" id="add-receipt">📷 ${esc(t('walletAddReceipt'))}</button>
        <input type="file" id="receipt-input" accept="image/*" hidden>
      </div>
      <div class="row">
        <label class="field"><span>${esc(t('walletDate'))}</span><input class="input" type="date" name="date" max="${hkToday()}" value="${esc(entry?.date || hkToday())}"></label>
        <label class="field grow"><span>${esc(t('dinnerNote'))}</span><input class="input" name="note" maxlength="200" value="${esc(entry?.note || '')}"></label>
      </div>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      const drawReceipts = () => {
        $('.receipts', dlg).innerHTML = receipts.map((id) => `<span class="receipt-chip">🧾 ${receipts.indexOf(id) + 1}</span>`).join('');
      };
      drawReceipts();
      $('#add-receipt', dlg).onclick = () => $('#receipt-input', dlg).click();
      $('#receipt-input', dlg).onchange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file && (await addReceipt(file, receipts))) drawReceipts();
      };
      setTimeout(() => $('[name="amount"]', dlg).focus(), 50);
      $('#expense-form', dlg).onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const amount = toCents(f.get('amount'));
        if (!amount) return toast(t('walletBadAmount'));
        const data = {
          type: 'expense',
          amount,
          date: f.get('date') || hkToday(),
          place: clean(f.get('place'), 30),
          note: clean(f.get('note'), 200),
          receipts,
        };
        if (editing) {
          store().updateWalletEntry(fid(), entry.id, { ...data, editedBy: state().me }).catch(fail);
        } else {
          store()
            .addWalletEntries(fid(), [{ ...data, by: state().me, items: f.getAll('items').map((n) => clean(n, 60)).slice(0, 60) }])
            .catch(fail);
        }
        dlg.close();
        toast(t('walletSaved', { amount: fmtMoney(amount) }));
      };
    },
  );
}

// ---------- ➕ 入錢（先對數） ----------

function openTopup() {
  const expected = balance(entries);
  openDialog(
    `<form id="topup-form">
      <h2>➕ ${esc(t('walletTopup'))}</h2>
      <p class="small muted">${esc(t('walletCountHint'))}</p>
      <label class="field"><span>${esc(t('walletCounted'))}</span>
        <input class="input money-input" name="counted" inputmode="decimal" autocomplete="off" required value="${(expected / 100).toString()}"></label>
      <p class="small" id="diff-line">${esc(t('walletExpected', { amount: fmtMoney(expected) }))}</p>
      <label class="field hidden" id="diff-note"><span>${esc(t('walletDiffReason'))}</span><input class="input" name="diffNote" maxlength="200" placeholder="${esc(t('walletDiffPlaceholder'))}"></label>
      <label class="field"><span>${esc(t('walletTopupAmount'))}</span>
        <input class="input money-input" name="amount" inputmode="decimal" autocomplete="off" required placeholder="0"></label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      const update = () => {
        const counted = toCents($('[name="counted"]', dlg).value);
        const diff = counted == null ? 0 : counted - expected;
        $('#diff-line', dlg).textContent = diff
          ? t('walletDiff', { expected: fmtMoney(expected), diff: fmtMoney(diff, { sign: true }) })
          : t('walletExpected', { amount: fmtMoney(expected) });
        $('#diff-line', dlg).classList.toggle('late-txt', !!diff);
        $('#diff-note', dlg).classList.toggle('hidden', !diff);
      };
      $('[name="counted"]', dlg).oninput = update;
      $('#topup-form', dlg).onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const counted = toCents(f.get('counted'));
        const amount = toCents(f.get('amount'));
        if (counted == null || !amount) return toast(t('walletBadAmount'));
        const date = hkToday();
        const by = state().me;
        const batch = [];
        if (counted !== expected) {
          batch.push({ type: 'adjust', amount: counted - expected, expected, counted, date, by, note: clean(f.get('diffNote'), 200) });
        }
        batch.push({ type: 'topup', amount, date, by });
        store().addWalletEntries(fid(), batch).catch(fail);
        dlg.close();
        toast(t('walletToppedUp', { amount: fmtMoney(counted + amount) }));
      };
    },
  );
}

// ---------- 詳情 ----------

function openEntry(e) {
  if (!e) return;
  const amount = e.type === 'expense' ? -e.amount : e.amount;
  openDialog(
    `<h2>${esc(e.type === 'expense' ? tr(e.place || t('walletExpense')) : e.type === 'topup' ? t('walletTopupEntry') : t('walletAdjustEntry'))}</h2>
    <div class="big-count w-amount ${amount < 0 ? 'neg' : 'pos'}">${esc(fmtMoney(amount, { sign: true }))}</div>
    <p class="small muted">${esc([formatDay(e.date, langInfo().htmlLang), e.by, e.editedBy && t('walletEditedBy', { name: e.editedBy })].filter(Boolean).join(' · '))}</p>
    ${e.type === 'adjust' ? `<p class="small">${esc(t('walletAdjustDetail', { expected: fmtMoney(e.expected || 0), counted: fmtMoney(e.counted || 0) }))}</p>` : ''}
    ${(e.items || []).length ? `<p>${esc((e.items || []).map(tr).join('、'))}</p>` : ''}
    ${e.note ? `<p class="small">📝 ${esc(e.note)}</p>` : ''}
    <div class="photo-list">${(e.receipts || []).map((id) => `<figure class="photo" data-pid="${esc(id)}"><img alt=""></figure>`).join('')}</div>
    <div class="actions">
      <button type="button" class="btn danger" id="w-del">${esc(t('delete'))}</button>
      ${e.type === 'adjust' ? '' : `<button type="button" class="btn" id="w-edit">${esc(t('edit'))}</button>`}
      <span class="spacer"></span>
      <button type="button" class="btn primary" data-close>${esc(t('close'))}</button>
    </div>`,
    (dlg) => {
      for (const fig of dlg.querySelectorAll('.photo')) {
        store()
          .getPhoto(fid(), fig.dataset.pid)
          .then((src) => {
            if (src) fig.querySelector('img').src = src;
            else fig.insertAdjacentHTML('afterbegin', `<p class="small muted">${esc(t('photoUnavailable'))}</p>`);
          })
          .catch(() => {});
      }
      $('#w-edit', dlg)?.addEventListener('click', () => (e.type === 'topup' ? openEditTopup(e) : openExpense(e)));
      $('#w-del', dlg).onclick = () =>
        confirmDialog(t('walletDeleteConfirm', { amount: fmtMoney(Math.abs(e.amount)) }), t('delete'), () => {
          store().deleteWalletEntry(fid(), e.id).catch(fail);
          if ((e.receipts || []).length) store().deletePhotos(fid(), e.receipts).catch(fail);
        });
    },
  );
}

function openEditTopup(e) {
  openDialog(
    `<form id="topup-edit">
      <h2>➕ ${esc(t('edit'))}</h2>
      <label class="field"><span>${esc(t('walletTopupAmount'))}</span>
        <input class="input money-input" name="amount" inputmode="decimal" required value="${(e.amount / 100).toString()}"></label>
      <label class="field"><span>${esc(t('walletDate'))}</span><input class="input" type="date" name="date" max="${hkToday()}" value="${esc(e.date)}"></label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      $('#topup-edit', dlg).onsubmit = (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        const amount = toCents(f.get('amount'));
        if (!amount) return toast(t('walletBadAmount'));
        store().updateWalletEntry(fid(), e.id, { amount, date: f.get('date') || e.date, editedBy: state().me }).catch(fail);
        dlg.close();
        toast(t('saved'));
      };
    },
  );
}

// ---------- 設定 / 匯出 ----------

function openLowSetting() {
  openDialog(
    `<form id="low-form">
      <h2>⚙️ ${esc(t('walletLowTitle'))}</h2>
      <p class="small muted">${esc(t('walletLowHint'))}</p>
      <label class="field"><span>${esc(t('walletAmount'))}</span>
        <input class="input money-input" name="amount" inputmode="decimal" required value="${(lowLimit() / 100).toString()}"></label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      $('#low-form', dlg).onsubmit = (ev) => {
        ev.preventDefault();
        const amount = toCents(new FormData(ev.target).get('amount'));
        if (amount == null) return toast(t('walletBadAmount'));
        store().updateFamily(fid(), { walletLow: amount }).catch(fail);
        dlg.close();
        toast(t('saved'));
      };
    },
  );
}

function exportCSV() {
  const blob = new Blob([toCSV(entries)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wallet-${hkToday()}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
