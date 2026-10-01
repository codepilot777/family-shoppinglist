// 💰 家用（買餸錢包）：餘額、記支出（連單據相）、入錢前對數、每月總結、匯出 CSV。
import { t, getLang, langInfo } from './i18n.js';
import { $, esc, clean, toast, fail, openDialog, confirmDialog } from './ui.js';
import { hkToday, formatDay } from './dates.js';
import { toCents, balance, monthSummary, lastTopup, byNewest, toCSV, DEFAULT_LOW } from './wallet.js';
import { lookup } from './translate.js';
import { compressImage, THUMB_OPTS } from './image.js';
import { openCamera } from './camera.js';

const RECEIPT_OPTS = { maxSide: 1600, maxChars: 700_000, quality: 0.85 };
const MAX_RECEIPTS = 3;
const PLACES = ['街市', '超市', '藥房', '麵包舖', '其他'];
const MAX_INBOX = 30;

let ctx;
let entries = [];
let inbox = [];
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
  inbox = [];
  return [
    store().subscribeWallet(
      familyId,
      (list) => {
        entries = list;
        renderWallet();
      },
      fail,
    ),
    store().subscribeInbox(
      familyId,
      (list) => {
        inbox = list.sort((a, b) => a.createdAt - b.createdAt);
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
      <button class="btn primary" id="w-snap">📷 ${esc(t('inboxSnap'))}</button>
      <button class="btn" id="w-expense">➖ ${esc(t('walletAddExpense'))}</button>
      <button class="btn" id="w-topup">➕ ${esc(t('walletTopup'))}</button>
    </div>
  </section>`;

  if (inbox.length) {
    html += `<button class="card inbox-card" id="w-inbox">
      <span class="inbox-thumbs">${inbox
        .slice(0, 4)
        .map((r) => (r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : '<i>🧾</i>'))
        .join('')}</span>
      <span class="body"><b>🧾 ${esc(t('inboxCount', { n: inbox.length }))}</b><span class="small muted">${esc(t('inboxHint'))}</span></span>
      <span class="chev" aria-hidden="true">›</span>
    </button>`;
  }

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
  $('#w-snap', root).onclick = () => snapReceipts();
  $('#w-inbox', root)?.addEventListener('click', () => openInbox());
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

// 某人喺某個時間之前 12 個鐘內剔咗「已買」嘅嘢，方便連埋支出；已經記入另一筆支出嘅唔再列
function recentBought(who = state().me, at = Date.now()) {
  const since = at - 12 * 3600 * 1000;
  const until = at + 2 * 3600 * 1000;
  const recorded = new Set(
    entries.filter((e) => e.type === 'expense' && e.by === who && (e.createdAt || 0) >= since).flatMap((e) => e.items || []),
  );
  const inWindow = (at) => at >= since && at <= until;
  const mine = state().items.filter(
    (i) =>
      !recorded.has(i.name) &&
      ((i.done && inWindow(i.doneAt) && i.doneBy === who) || (!i.done && i.got > 0 && inWindow(i.gotAt) && i.gotBy === who)), // 連買咗一部分嘅
  );
  return [...new Set(mine.map((i) => i.name))];
}

const itemChecks = (names) =>
  names.length
    ? `<div class="field"><span>${esc(t('walletItems'))}</span><div class="cats">${names
        .map((n) => `<label><input type="checkbox" name="items" value="${esc(n)}" checked><span>${esc(tr(n))}</span></label>`)
        .join('')}</div></div>`
    : '';

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
          ? itemChecks(bought)
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

// ---------- 🧾 一次過影晒單，之後逐張入數 ----------

const busy = new Set(); // 啱啱儲存 / 刪除緊，唔好再顯示

export function snapReceipts() {
  const room = MAX_INBOX - inbox.length;
  if (room <= 0) return toast(t('inboxFull', { n: MAX_INBOX }));
  let queue = Promise.resolve();
  let failed = 0;
  openCamera({
    max: room,
    // 逐張壓細（大相 + 細圖）即刻存，就算中途閂咗 app 都唔會唔見
    onShot: (blob) => {
      queue = queue.then(async () => {
        try {
          const [data, thumb] = await Promise.all([compressImage(blob, RECEIPT_OPTS), compressImage(blob, THUMB_OPTS)]);
          store().addInbox(fid(), data, thumb, state().me).done.catch(fail);
        } catch (err) {
          console.error(err);
          failed++;
        }
      });
    },
    onDone: (n) => {
      if (!n) return;
      toast(t('processingPhoto'));
      queue.then(() => {
        if (failed) toast(t('photoFailed'));
        else $('#toast').classList.remove('show');
        openInbox();
      });
    },
  });
}

export function openInbox() {
  const list = inbox.filter((r) => !busy.has(r.id));
  if (!list.length) return;
  const picked = new Set([list[0].id]);
  let dateTouched = false;
  const lang = langInfo().htmlLang;
  const timeFmt = new Intl.DateTimeFormat(lang, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Hong_Kong' });
  openDialog(
    `<form id="inbox-form" class="inbox">
      <h2>🧾 ${esc(t('inboxTitle', { n: list.length }))}</h2>
      <div class="rc-carousel">${list
        .map(
          (r) => `<figure class="rc-slide" data-id="${esc(r.id)}">
            <img src="${esc(r.thumb || '')}" alt="" data-photo="${esc(r.photo)}">
            <button type="button" class="rc-pick" data-pick="${esc(r.id)}"></button>
            <button type="button" class="rc-del" data-del="${esc(r.id)}" aria-label="${esc(t('delete'))}">🗑</button>
            <figcaption class="small muted"><span class="rc-num"></span> · ${esc(r.by || '')} · ${esc(timeFmt.format(new Date(r.createdAt)))}</figcaption>
          </figure>`,
        )
        .join('')}</div>
      <p class="small rc-status"></p>
      <label class="field"><span>${esc(t('walletAmount'))}</span>
        <input class="input money-input" name="amount" inputmode="decimal" autocomplete="off" placeholder="0"></label>
      <div class="field"><span>${esc(t('walletPlace'))}</span><div class="segmented">${placeOptions(PLACES[0])}</div></div>
      <div class="rc-items"></div>
      <div class="row">
        <label class="field"><span>${esc(t('walletDate'))}</span><input class="input" type="date" name="date" max="${hkToday()}"></label>
        <label class="field grow"><span>${esc(t('dinnerNote'))}</span><input class="input" name="note" maxlength="200"></label>
      </div>
      <div class="actions">
        <button type="button" class="btn" id="rc-more">📷 ${esc(t('inboxMore'))}</button>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      const form = $('#inbox-form', dlg);
      const slides = () => [...dlg.querySelectorAll('.rc-slide')];
      const chosen = () => slides().map((f) => list.find((r) => r.id === f.dataset.id)).filter((r) => r && picked.has(r.id));
      let lead = null;

      const refresh = () => {
        const all = slides();
        all.forEach((f, i) => {
          const on = picked.has(f.dataset.id);
          f.classList.toggle('picked', on);
          $('.rc-num', f).textContent = `${i + 1}/${all.length}`;
          const b = $('.rc-pick', f);
          b.textContent = `${on ? '☑' : '☐'} ${t('inboxPick')}`;
          b.setAttribute('aria-pressed', String(on));
        });
        $('.rc-status', dlg).textContent = picked.size ? t('inboxPicked', { n: picked.size }) : t('inboxPickFirst');
        $('.rc-status', dlg).classList.toggle('late-txt', !picked.size);
        // 第一張揀咗嘅單決定邊個買、邊日、買咗咩
        const first = chosen()[0];
        if (first && first.id !== lead) {
          lead = first.id;
          $('.rc-items', dlg).innerHTML = itemChecks(recentBought(first.by, first.createdAt));
          if (!dateTouched) form.date.value = hkToday(new Date(first.createdAt));
        }
      };
      refresh();

      // 大相：捲到先載入
      const io = new IntersectionObserver(
        (seen) => {
          for (const s of seen) {
            if (!s.isIntersecting) continue;
            io.unobserve(s.target);
            const img = s.target;
            store()
              .getPhoto(fid(), img.dataset.photo)
              .then((src) => src && (img.src = src))
              .catch(() => {});
          }
        },
        { root: $('.rc-carousel', dlg), rootMargin: '0px 100% 0px 100%' },
      );
      dlg.querySelectorAll('.rc-slide img').forEach((img) => io.observe(img));
      dlg.addEventListener('close', () => io.disconnect(), { once: true });

      form.date.oninput = () => (dateTouched = true);
      $('.rc-carousel', dlg).onclick = (e) => {
        const pick = e.target.closest('[data-pick]');
        const del = e.target.closest('[data-del]');
        if (pick) {
          const id = pick.dataset.pick;
          if (picked.has(id)) picked.delete(id);
          else if (picked.size >= MAX_RECEIPTS) return toast(t('maxPhotos', { n: MAX_RECEIPTS }));
          else picked.add(id);
          refresh();
        } else if (del) {
          // 撳兩下先刪，唔使彈另一個視窗
          if (!del.classList.contains('armed')) {
            del.classList.add('armed');
            del.textContent = t('inboxDeleteConfirm');
            setTimeout(() => {
              if (!del.isConnected) return;
              del.classList.remove('armed');
              del.textContent = '🗑';
            }, 3000);
            return;
          }
          const r = list.find((x) => x.id === del.dataset.del);
          busy.add(r.id);
          store().deleteInbox(fid(), r.id, r.photo).catch(fail);
          picked.delete(r.id);
          del.closest('.rc-slide').remove();
          if (!slides().length) return dlg.close();
          if (!picked.size) picked.add(slides()[0].dataset.id);
          refresh();
        } else if (e.target.tagName === 'IMG') {
          zoom(e.target.src);
        }
      };
      $('#rc-more', dlg).onclick = () => {
        dlg.close();
        snapReceipts();
      };

      form.onsubmit = (e) => {
        e.preventDefault();
        const rs = chosen();
        if (!rs.length) return toast(t('inboxPickFirst'));
        const f = new FormData(form);
        const amount = toCents(f.get('amount'));
        if (!amount) {
          form.amount.focus();
          return toast(t('walletBadAmount'));
        }
        const entry = {
          type: 'expense',
          amount,
          date: f.get('date') || hkToday(),
          place: clean(f.get('place'), 30),
          note: clean(f.get('note'), 200),
          receipts: rs.map((r) => r.photo),
          by: clean(rs[0].by || state().me, 20),
          items: f.getAll('items').map((n) => clean(n, 60)).slice(0, 60),
        };
        rs.forEach((r) => busy.add(r.id));
        store().saveInboxExpense(fid(), entry, rs.map((r) => r.id)).catch(fail);
        const left = list.filter((r) => !busy.has(r.id)).length;
        toast(left ? t('walletSaved', { amount: fmtMoney(amount) }) : t('inboxAllDone'));
        if (left) openInbox();
        else dlg.close();
      };
    },
  );
}

// 放大睇張單（可以捲嚟睇清楚個總數）
function zoom(src) {
  const z = document.createElement('dialog');
  z.className = 'rc-zoom';
  z.innerHTML = `<img src="${esc(src)}" alt=""><button type="button" class="icon-btn rc-zoom-close" aria-label="${esc(t('close'))}">✕</button>`;
  document.body.appendChild(z);
  z.addEventListener('close', () => z.remove());
  z.onclick = (e) => {
    if (e.target.tagName === 'IMG') e.target.classList.toggle('full');
    else z.close();
  };
  z.showModal();
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
