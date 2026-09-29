// 📋 到期頁：帳單、證件合約、保養、自己加嘅類別。過咗期 / 快到期（提醒期內）/ 之後，
// 撳 ✓ 就「做咗 / 交咗」並排下一期（有銀碼就問今次幾錢，留低每期紀錄）；自動轉賬嘅自己排。
import { t, getLang, langInfo } from './i18n.js';
import { $, esc, ls, clean, toast, fail, openDialog, confirmDialog } from './ui.js';
import { hkToday, addDays } from './dates.js';
import { DUE_UNITS, DUE_CATS, DUE_PRESETS, WARN_DAYS, CAT_ICONS, validDue, nextDueDate, effectiveDue, dueStatus, daysLeft, dueOnDate, pushHistory } from './dues.js';
import { toCents } from './wallet.js';
import { fmtMoney } from './wallet-view.js';
import { prepareItem, lookup, translateTo } from './translate.js';
import { getMembers } from './dinner-view.js';
import { everyText as choreEvery } from './chores-view.js';

let ctx;
let dues = [];
let cats = [];
let filter = ls.get('fsl-dues-filter') || 'all';

export function initDues(context) {
  ctx = context;
  document.addEventListener('fsl-members', () => renderDues());
}

const state = () => ctx.state;
const store = () => state().store;
const fid = () => state().familyId;
const memberName = (id) => getMembers().find((m) => m.id === id)?.name || '';
const locale = () => langInfo().htmlLang;

// 日子：同年就「10/3」，唔同年加年份
function dateText(date, today = hkToday()) {
  const opts = { timeZone: 'UTC', month: 'numeric', day: 'numeric' };
  if (date.slice(0, 4) !== today.slice(0, 4)) opts.year = '2-digit';
  return new Intl.DateTimeFormat(locale(), opts).format(new Date(`${date}T00:00:00Z`));
}
const dayText = (date) => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T00:00:00Z`));

// 仲有幾耐：60 日內講日數，之後講月，兩年以上講年
function leftText(n) {
  if (n === 0) return t('dueLeftToday');
  if (n < 0) return t('choreLate', { n: -n });
  if (n < 60) return t('dueLeftDays', { n });
  if (n < 730) return t('dueLeftMonths', { n: Math.round(n / 30.4) });
  return t('dueLeftYears', { n: (n / 365).toFixed(1).replace(/\.0$/, '') });
}

export function dueEveryText(every, unit) {
  if (unit === 'once') return t('dueOnce');
  if (unit === 'year') return every === 1 ? t('everyYear1') : t('everyYearN', { n: every });
  return choreEvery(every, unit);
}

function warnText(n) {
  if (!n) return t('dueWarn0');
  if (n % 30 === 0) return t('dueWarnMonths', { n: n / 30 });
  if (n % 7 === 0) return t('dueWarnWeeks', { n: n / 7 });
  return t('dueWarnDays', { n });
}

// 類別：內置 + 自己加
function allCats() {
  return [
    ...DUE_CATS.map((c) => ({ ...c, name: t(`dueCat_${c.id}`) })),
    ...[...cats].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map((c) => ({ id: c.id, icon: c.icon || '⭐', name: c.name, custom: true })),
  ];
}
const catOf = (id) => allCats().find((c) => c.id === id) || { id, icon: '📋', name: '' };

// 名跟語言顯示，冇翻譯就用原文
function dueName(d) {
  const lang = getLang();
  const text = d.tr?.[lang] || lookup(d.name)?.[lang] || d.name;
  return { text, original: text !== d.name ? d.name : '' };
}
const presetName = (zh) => lookup(zh)?.[getLang()] || zh;

const translating = new Set();
function ensureTranslations() {
  const lang = getLang();
  for (const d of dues) {
    if (d.tr?.[lang] || (d.lang || 'zh') === lang || lookup(d.name)?.[lang]) continue;
    const key = `${d.id}|${lang}`;
    if (translating.has(key)) continue;
    translating.add(key);
    translateTo(d, lang).then((res) => {
      if (res && fid()) store().setDueTranslation(fid(), d.id, lang, res.text, res.auto).catch(() => {});
    });
  }
}

export function duesOnEnterFamily(familyId) {
  dues = [];
  cats = [];
  const changed = () => {
    renderDues();
    document.dispatchEvent(new Event('fsl-data')); // 📅 日曆
  };
  return [
    store().subscribeDues(
      familyId,
      (list) => {
        dues = list;
        changed();
      },
      fail,
    ),
    store().subscribeDueCats(
      familyId,
      (list) => {
        cats = list;
        changed();
      },
      fail,
    ),
  ];
}

// 📅 日曆用：某日到期嘅嘢（今日連埋過咗期嘅）
export function duesOn(date, today = hkToday()) {
  return dues
    .filter((d) => dueOnDate(d, date, today))
    .map((d) => ({ ...d, label: dueName(d).text, icon: catOf(d.cat).icon, whoName: memberName(d.who), late: effectiveDue(d, today) < today }));
}

// ---------- 畫面 ----------

export function renderDues() {
  const root = $('#dues');
  if (!root || root.classList.contains('hidden')) return;
  ensureTranslations();
  const today = hkToday();
  const list = allCats();
  const active = list.some((c) => c.id === filter) ? filter : 'all'; // 類別未載入 / 刪咗 → 全部
  const open = dues.filter((d) => !d.closed);
  const left = (d) => daysLeft(effectiveDue(d, today), today);
  const over = open.filter((d) => left(d) < 0).length;
  const in7 = open.filter((d) => left(d) >= 0 && left(d) <= 7).length;
  const in30 = open.filter((d) => left(d) > 7 && left(d) <= 30).length;

  let html = `<section class="card dues-summary">
    <div class="${over ? 'red' : ''}"><b>${over}</b><span>${esc(t('duesOver'))}</span></div>
    <div class="${in7 ? 'amber' : ''}"><b>${in7}</b><span>${esc(t('duesIn7'))}</span></div>
    <div><b>${in30}</b><span>${esc(t('duesIn30'))}</span></div>
  </section>
  <div class="cats due-cats">${[{ id: 'all', icon: '', name: t('duesAll') }, ...list]
    .map((c) => {
      const n = c.id === 'all' ? dues.length : dues.filter((d) => d.cat === c.id).length;
      return `<button type="button" class="freq-chip" data-filter="${esc(c.id)}" aria-pressed="${active === c.id}">${esc(`${c.icon} ${c.name}`.trim())} <small>${n}</small></button>`;
    })
    .join('')}<button type="button" class="freq-chip manage" id="due-newcat">＋ ${esc(t('dueNewCat'))}</button></div>`;

  const shown = dues.filter((d) => active === 'all' || d.cat === active);
  const groups = { over: [], soon: [], later: [], done: [] };
  const sorted = [...shown].sort((a, b) => effectiveDue(a, today).localeCompare(effectiveDue(b, today)) || dueName(a).text.localeCompare(dueName(b).text));
  for (const d of sorted) groups[dueStatus(d, today)].push(d);
  groups.done.sort((a, b) => (b.lastDone || '').localeCompare(a.lastDone || ''));
  const titles = { over: 'dueGroupOver', soon: 'dueGroupSoon', later: 'dueGroupLater', done: 'dueGroupDone' };
  for (const [g, items] of Object.entries(groups)) {
    if (!items.length) continue;
    html += `<h2 class="group-title">${esc(t(titles[g]))}</h2><ul class="items due-list">${items.map((d) => dueRow(d, g, today)).join('')}</ul>`;
  }
  if (!dues.length) html += `<div class="empty"><div class="big">📋</div><p>${esc(t('duesEmpty'))}</p></div>`;
  else if (!shown.length) html += `<p class="muted cal-empty">${esc(t('duesEmptyCat'))}</p>`;

  const have = new Set(dues.map((d) => lookup(d.name)?.zh || d.name));
  const presets = DUE_PRESETS.filter(([zh, cat]) => !have.has(zh) && (active === 'all' || active === cat));
  if (dues.length < 5 && presets.length) html += presetsHtml(presets.slice(0, 8));

  html += `<div class="dinner-actions"><button class="btn primary" id="due-add">➕ ${esc(t('dueAdd'))}</button></div>`;
  root.innerHTML = html;

  $('#due-add', root).onclick = () => openDue();
  $('#due-newcat', root).onclick = openCats;
  root.querySelectorAll('[data-filter]').forEach(
    (b) =>
      (b.onclick = () => {
        filter = b.dataset.filter;
        ls.set('fsl-dues-filter', filter);
        renderDues();
      }),
  );
  root.querySelectorAll('[data-done]').forEach((b) => (b.onclick = () => tapDone(dues.find((d) => d.id === b.dataset.done))));
  root.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openDue(dues.find((d) => d.id === b.dataset.edit))));
  root.querySelectorAll('[data-preset]').forEach(
    (b) =>
      (b.onclick = () => {
        const p = DUE_PRESETS.find(([zh]) => zh === b.dataset.preset);
        if (p) openDue(null, p);
      }),
  );
}

function dueRow(d, group, today) {
  const { text, original } = dueName(d);
  const cat = catOf(d.cat);
  const due = effectiveDue(d, today);
  const who = memberName(d.who);
  const meta = [
    dueEveryText(d.every, d.unit),
    d.amount ? fmtMoney(d.amount) : '',
    who ? `👤 ${who}` : '',
    d.auto ? t('dueAutoTag') : '',
    group === 'done' && d.lastDone ? `✓ ${dateText(d.lastDone, today)} ${d.lastBy || ''}`.trim() : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const check =
    d.auto || group === 'done'
      ? `<span class="due-auto" aria-hidden="true">${d.auto ? '⟳' : '✓'}</span>`
      : `<button class="chore-check" data-done="${esc(d.id)}" aria-label="${esc(t('dueDone'))}: ${esc(text)}" title="${esc(t('dueDone'))}">✓</button>`;
  return `<li class="item due st-${group}">
    ${check}
    <button class="toggle" data-edit="${esc(d.id)}">
      <span class="body"><span class="name">${esc(cat.icon)} ${esc(text)}</span>
        ${original ? `<div class="original">${esc(original)}</div>` : ''}
        ${d.note ? `<div class="meta">📝 ${esc(d.note)}</div>` : ''}
        <div class="meta">${esc(meta)}</div></span>
      ${group === 'done' ? '' : `<span class="due-left"><b>${esc(leftText(daysLeft(due, today)))}</b><small>${esc(dateText(due, today))}</small></span>`}
    </button>
  </li>`;
}

function presetsHtml(presets) {
  return `<h2 class="group-title">${esc(t('duePresets'))}</h2>
    <div class="cats chore-presets">${presets
      .map(
        ([zh, cat, every, unit]) =>
          `<button type="button" class="freq-chip" data-preset="${esc(zh)}">＋ ${esc(catOf(cat).icon)} ${esc(presetName(zh))} <small>${esc(dueEveryText(every, unit))}</small></button>`,
      )
      .join('')}</div>`;
}

// ---------- 做咗 / 交咗 ----------

function tapDone(d) {
  if (!d) return;
  if (!d.amount) return markDone(d);
  const today = hkToday();
  openDialog(
    `<form id="pay-form">
      <h2>${esc(catOf(d.cat).icon)} ${esc(t('duePaidTitle', { name: dueName(d).text }))}</h2>
      <label class="field"><span>${esc(t('duePayAmount'))}</span>
        <input class="input" name="amount" inputmode="decimal" value="${esc((d.amount / 100).toFixed(d.amount % 100 ? 2 : 0))}"></label>
      ${d.unit === 'once' ? '' : `<p class="small muted">${esc(t('duePayHint', { day: dayText(nextDueDate(d, today)) }))}</p>`}
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">✓ ${esc(t('dueDone'))}</button></div>
    </form>`,
    (dlg) => {
      const form = $('#pay-form', dlg);
      form.onsubmit = (e) => {
        e.preventDefault();
        dlg.close();
        markDone(d, toCents(form.amount.value));
      };
    },
  );
}

function markDone(d, cents = null) {
  const today = hkToday();
  const before = { due: d.due, lastDone: d.lastDone || '', lastBy: d.lastBy || '', closed: !!d.closed, amount: d.amount || 0, history: d.history || [] };
  const patch = { lastDone: today, lastBy: clean(state().me, 20) };
  if (d.unit === 'once') patch.closed = true;
  else patch.due = nextDueDate(d, today);
  if (cents) Object.assign(patch, { amount: cents, history: pushHistory(d.history, today, cents) });
  store().updateDue(fid(), d.id, patch).catch(fail);
  const name = dueName(d).text;
  toast(d.unit === 'once' ? t('dueClosedToast', { name }) : t('dueDoneToast', { name, day: dateText(patch.due) }), {
    label: t('undo'),
    run: () => store().updateDue(fid(), d.id, before).catch(fail),
  });
}

// ---------- 加 / 改 ----------

const seg = (name, opts, cur) =>
  `<div class="segmented wrap">${opts
    .map(([v, l]) => `<label><input type="radio" name="${name}" value="${esc(v)}" ${String(v) === String(cur) ? 'checked' : ''}><span>${esc(l)}</span></label>`)
    .join('')}</div>`;

function historyHtml(d) {
  const h = d?.history || [];
  if (h.length < 2) return '';
  const max = Math.max(...h.map((x) => x.a), 1);
  return `<div class="field"><span>${esc(t('dueHistory'))}</span><div class="due-history">${h
    .map((x) => `<div class="hbar"><span>${esc(dateText(x.d))}</span><i style="width:${Math.max(4, Math.round((x.a / max) * 100))}%"></i><b>${esc(fmtMoney(x.a))}</b></div>`)
    .join('')}</div></div>`;
}

// preset = [中文名, 類別, 每幾多, 單位, 提醒]：開好表格等人填日子同銀碼
function openDue(d, preset) {
  const editing = !!d;
  const members = [...getMembers()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const x = d || {
    name: preset?.[0] || '',
    cat: preset?.[1] || (allCats().some((c) => c.id === filter) ? filter : 'bill'),
    every: preset?.[2] || 1,
    unit: preset?.[3] || 'month',
    warn: preset?.[4] ?? 14,
    due: addDays(hkToday(), 30),
    who: '',
    auto: false,
  };
  const units = { week: 'dueUnitWeek', month: 'dueUnitMonth', year: 'dueUnitYear', once: 'dueUnitOnce' };
  const warns = WARN_DAYS.includes(x.warn || 0) ? WARN_DAYS : [...WARN_DAYS, x.warn].sort((a, b) => a - b);
  openDialog(
    `<form id="due-form">
      <h2>📋 ${esc(t(editing ? 'dueEdit' : 'dueAdd'))}</h2>
      <label class="field"><span>${esc(t('dueName'))}</span>
        <input class="input" name="name" maxlength="60" required placeholder="${esc(t('dueNamePlaceholder'))}" value="${esc(editing ? dueName(d).text : preset ? presetName(x.name) : '')}"></label>
      <div class="field"><span>${esc(t('dueCat'))}</span>${seg('cat', allCats().map((c) => [c.id, `${c.icon} ${c.name}`]), x.cat)}</div>
      <div class="field"><span>${esc(t('dueEvery'))}</span>
        <div class="row every-row">
          <input class="input every-input" name="every" type="number" inputmode="numeric" min="1" max="99" value="${x.every || 1}" ${x.unit === 'once' ? 'disabled' : ''}>
          ${seg('unit', DUE_UNITS.map((u) => [u, t(units[u])]), x.unit)}
        </div></div>
      <div class="row wrap due-when">
        <label class="field grow"><span>${esc(t('dueNext'))}</span><input class="input" type="date" name="due" required value="${esc(x.due)}"></label>
        <label class="field grow"><span>${esc(t('dueWarn'))}</span><select class="input" name="warn">${warns
          .map((n) => `<option value="${n}" ${n === (x.warn || 0) ? 'selected' : ''}>${esc(warnText(n))}</option>`)
          .join('')}</select></label>
      </div>
      <div class="field"><span>${esc(t('dueWho'))}</span>${seg('who', [['', t('choreAnyone')], ...members.map((m) => [m.id, m.name])], x.who || '')}</div>
      <label class="field"><span>${esc(t('dueAmount'))}</span>
        <input class="input" name="amount" inputmode="decimal" placeholder="$" value="${x.amount ? esc((x.amount / 100).toFixed(x.amount % 100 ? 2 : 0)) : ''}"></label>
      <div class="field due-auto-field ${x.unit === 'once' ? 'hidden' : ''}"><span>${esc(t('dueAuto'))}</span>${seg('auto', [['0', t('dueAutoOff')], ['1', t('dueAutoOn')]], x.auto ? '1' : '0')}</div>
      <label class="field"><span>${esc(t('dinnerNote'))}</span><input class="input" name="note" maxlength="200" value="${esc(x.note || '')}"></label>
      ${historyHtml(d)}
      <div class="actions">
        ${editing ? `<button type="button" class="btn danger" id="due-del">${esc(t('delete'))}</button>` : ''}
        ${editing && d.closed ? `<button type="button" class="btn" id="due-reopen">${esc(t('dueReopen'))}</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      const form = $('#due-form', dlg);
      if (preset) form.name.dataset.zh = preset[0];
      form.name.oninput = () => delete form.name.dataset.zh;
      form.querySelectorAll('input[name="unit"]').forEach(
        (r) =>
          (r.onchange = () => {
            const once = form.unit.value === 'once';
            form.every.disabled = once;
            $('.due-auto-field', form).classList.toggle('hidden', once);
          }),
      );
      if (!editing && !preset) setTimeout(() => form.name.focus(), 50);
      $('#due-del', dlg)?.addEventListener('click', () =>
        confirmDialog(t('choreDeleteConfirm', { name: dueName(d).text }), t('delete'), () => store().deleteDue(fid(), d.id).catch(fail)),
      );
      $('#due-reopen', dlg)?.addEventListener('click', () => {
        dlg.close();
        store().updateDue(fid(), d.id, { closed: false }).catch(fail);
      });
      form.onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const unit = f.get('unit');
        const every = unit === 'once' ? 1 : Number(f.get('every'));
        if (!validDue(every, unit)) return toast(t('choreBadEvery'));
        const typed = clean(f.get('name'), 60);
        if (!typed) return;
        const cents = toCents(f.get('amount'));
        const data = {
          cat: clean(f.get('cat'), 40) || 'bill',
          every,
          unit,
          due: f.get('due') || hkToday(),
          warn: Number(f.get('warn')) || 0,
          who: clean(f.get('who'), 40),
          amount: cents || 0,
          auto: unit !== 'once' && f.get('auto') === '1',
          note: clean(f.get('note'), 200),
        };
        if (!editing) {
          const name = form.name.dataset.zh || typed;
          const { lang, tr } = prepareItem(name, getLang());
          store()
            .addDue(fid(), { name, lang, tr, trAuto: {}, ...data, start: data.due, closed: false, history: [], by: clean(state().me, 20) })
            .catch(fail);
        } else {
          const patch = { ...data };
          // 改咗次數或者日期：由新日期重新計
          if (every !== d.every || unit !== d.unit || data.due !== d.due) patch.start = data.due;
          if (typed !== dueName(d).text) Object.assign(patch, { name: typed, ...pick(prepareItem(typed, getLang())), trAuto: {} });
          store().updateDue(fid(), d.id, patch).catch(fail);
        }
        dlg.close();
        toast(t('saved'));
      };
    },
  );
}

const pick = ({ lang, tr }) => ({ lang, tr });

// ---------- 自己加類別 ----------

function openCats() {
  const custom = allCats().filter((c) => c.custom);
  openDialog(
    `<form id="cat-form">
      <h2>＋ ${esc(t('dueNewCat'))}</h2>
      <label class="field"><span>${esc(t('dueCatName'))}</span>
        <input class="input" name="name" maxlength="20" required placeholder="${esc(t('dueCatNamePlaceholder'))}"></label>
      <div class="field"><span>${esc(t('dueCatIcon'))}</span>${seg('icon', CAT_ICONS.map((i) => [i, i]), CAT_ICONS[0])}</div>
      ${
        custom.length
          ? `<div class="field"><span>${esc(t('dueCats'))}</span><ul class="items">${custom
              .map(
                (c) => `<li class="item"><span class="body"><span class="name">${esc(c.icon)} ${esc(c.name)}</span></span>
                  <button type="button" class="icon-btn" data-delcat="${esc(c.id)}" aria-label="${esc(t('delete'))} ${esc(c.name)}">🗑️</button></li>`,
              )
              .join('')}</ul></div>`
          : ''
      }
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('add'))}</button></div>
    </form>`,
    (dlg) => {
      const form = $('#cat-form', dlg);
      setTimeout(() => form.name.focus(), 50);
      dlg.querySelectorAll('[data-delcat]').forEach(
        (b) =>
          (b.onclick = () => {
            const c = catOf(b.dataset.delcat);
            const used = dues.filter((d) => d.cat === c.id).length;
            if (used) return toast(t('dueCatInUse', { n: used }));
            confirmDialog(t('dueCatDeleteConfirm', { name: c.name }), t('delete'), () => store().deleteDueCat(fid(), c.id).catch(fail));
          }),
      );
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = clean(form.name.value, 20);
        if (!name) return;
        dlg.close();
        const { id, saved } = store().addDueCat(fid(), { name, icon: form.icon.value, by: clean(state().me, 20) });
        saved.catch(fail);
        filter = id;
        ls.set('fsl-dues-filter', filter);
        renderDues();
        toast(t('dueCatAdded', { name }));
      };
    },
  );
}
