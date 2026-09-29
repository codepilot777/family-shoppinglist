// 🧹 家務頁：過咗期 / 今日 / 未來 7 日 / 之後，撳 ○ 就「做咗」並自動排下一次。
import { t, getLang, langInfo } from './i18n.js';
import { $, esc, ls, clean, toast, fail, openDialog, confirmDialog } from './ui.js';
import { hkToday, formatDay, addDays } from './dates.js';
import { nextDue, nextAfter, status, validRule, CHORE_PRESETS, UNITS } from './chores.js';
import { prepareItem, lookup, translateTo } from './translate.js';
import { getMembers, myMemberId } from './dinner-view.js';

let ctx;
let chores = [];
let filter = ls.get('fsl-chores-filter') || 'all';

export function initChores(context) {
  ctx = context;
  document.addEventListener('fsl-members', () => renderChores());
}

const state = () => ctx.state;
const store = () => state().store;
const fid = () => state().familyId;
const day = (date) => formatDay(date, langInfo().htmlLang);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const memberName = (id) => getMembers().find((m) => m.id === id)?.name || '';

// 名跟語言顯示（姐姐見到印尼文），冇翻譯就用原文
function choreName(c) {
  const lang = getLang();
  const text = c.tr?.[lang] || lookup(c.name)?.[lang] || c.name;
  return { text, original: text !== c.name ? c.name : '' };
}
const presetName = (zh) => lookup(zh)?.[getLang()] || zh;

export function everyText(every, unit) {
  const key = { day: 'everyDay', week: 'everyWeek', month: 'everyMonth' }[unit] || 'everyDay';
  return every === 1 ? t(`${key}1`) : t(`${key}N`, { n: every });
}

const translating = new Set();
function ensureChoreTranslations() {
  const lang = getLang();
  for (const c of chores) {
    if (c.tr?.[lang] || (c.lang || 'zh') === lang || lookup(c.name)?.[lang]) continue;
    const key = `${c.id}|${lang}`;
    if (translating.has(key)) continue;
    translating.add(key);
    translateTo(c, lang).then((res) => {
      if (res && fid()) store().setChoreTranslation(fid(), c.id, lang, res.text, res.auto).catch(() => {});
    });
  }
}

export function choresOnEnterFamily(familyId) {
  chores = [];
  return [
    store().subscribeChores(
      familyId,
      (list) => {
        chores = list;
        renderChores();
        document.dispatchEvent(new Event('fsl-data')); // 📅 日曆
      },
      fail,
    ),
  ];
}

// 📅 日曆用：某日到期嘅家務（今日連埋過咗期嘅；將來就計排期）
export function choresOn(date, today = hkToday()) {
  return chores
    .filter((c) => {
      if (!c.due) return false;
      if (date === today) return c.due <= today;
      if (date < today) return c.lastDone === date;
      if (date === c.due) return true;
      return date > c.due && nextAfter(c.start || c.due, c.every, c.unit, addDays(date, -1)) === date;
    })
    .map((c) => ({ ...c, label: choreName(c).text, whoName: memberName(c.who) }));
}

// ---------- 畫面 ----------

export function renderChores() {
  const root = $('#chores');
  if (!root || root.classList.contains('hidden')) return;
  ensureChoreTranslations();
  const today = hkToday();
  const me = myMemberId();
  if (filter === 'mine' && !me) filter = 'all';
  const shown = chores.filter((c) => filter === 'all' || c.who === me);
  const groups = { overdue: [], today: [], soon: [], later: [] };
  for (const c of [...shown].sort((a, b) => a.due.localeCompare(b.due) || choreName(a).text.localeCompare(choreName(b).text))) {
    groups[status(c, today)].push(c);
  }
  const dueNow = groups.overdue.length + groups.today.length;

  let html = `<section class="card chores-head">
    <div class="big-count">${esc(dueNow ? t('choresTodayCount', { n: dueNow }) : t('choresAllDone'))}</div>
    ${
      me
        ? `<div class="segmented chores-filter">
      ${['all', 'mine'].map((f) => `<label><input type="radio" name="cf" value="${f}" ${filter === f ? 'checked' : ''}><span>${esc(t(f === 'all' ? 'choresAll' : 'choresMine'))}</span></label>`).join('')}
    </div>`
        : ''
    }
  </section>`;

  const titles = { overdue: 'choresOverdue', today: 'choresToday', soon: 'choresSoon', later: 'choresLater' };
  for (const [g, list] of Object.entries(groups)) {
    if (!list.length) continue;
    html += `<h2 class="group-title">${esc(t(titles[g]))}</h2><ul class="items chore-list">${list.map((c) => choreRow(c, g, today)).join('')}</ul>`;
  }
  if (!chores.length) html += `<div class="empty"><div class="big">🧹</div><p>${esc(t('choresEmpty'))}</p></div>`;

  const have = new Set(chores.map((c) => lookup(c.name)?.zh || c.name));
  const presets = CHORE_PRESETS.filter(([zh]) => !have.has(zh));
  if (chores.length < 4 && presets.length) html += presetsHtml(presets);

  html += `<div class="dinner-actions"><button class="btn primary" id="chore-add">➕ ${esc(t('choreAdd'))}</button></div>`;
  root.innerHTML = html;

  $('#chore-add', root).onclick = () => openChore();
  root.querySelectorAll('input[name="cf"]').forEach(
    (r) =>
      (r.onchange = () => {
        filter = r.value;
        ls.set('fsl-chores-filter', filter);
        renderChores();
      }),
  );
  root.querySelectorAll('[data-done]').forEach((b) => (b.onclick = () => markDone(chores.find((c) => c.id === b.dataset.done))));
  root.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openChore(chores.find((c) => c.id === b.dataset.edit))));
  bindPresets(root);
}

function choreRow(c, group, today) {
  const { text, original } = choreName(c);
  const who = memberName(c.who);
  const when =
    group === 'overdue'
      ? `<span class="late-txt">${esc(t('choreLate', { n: daysBetween(c.due, today) }))}</span>`
      : group === 'today'
        ? ''
        : esc(t('choreDueOn', { day: day(c.due) }));
  const meta = [
    esc(everyText(c.every, c.unit)),
    who ? `👤 ${esc(who)}` : '',
    when,
    c.lastDone ? esc(t('choreLast', { day: day(c.lastDone), who: c.lastBy || '' })) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const mine = c.who && c.who === myMemberId();
  return `<li class="item chore st-${group} ${mine ? 'mine' : ''}">
    <button class="chore-check" data-done="${esc(c.id)}" aria-label="${esc(t('choreDone'))}: ${esc(text)}" title="${esc(t('choreDone'))}">✓</button>
    <button class="toggle" data-edit="${esc(c.id)}">
      <span class="body"><span class="name">${esc(text)}</span>
        ${original ? `<div class="original">${esc(original)}</div>` : ''}
        ${c.note ? `<div class="meta">📝 ${esc(c.note)}</div>` : ''}
        <div class="meta">${meta}</div></span>
      <span class="more" aria-hidden="true">›</span>
    </button>
  </li>`;
}

function presetsHtml(presets) {
  return `<h2 class="group-title">${esc(t('chorePresets'))}</h2>
    <div class="cats chore-presets">${presets
      .map(
        ([zh, every, unit]) =>
          `<button type="button" class="freq-chip" data-preset="${esc(zh)}">＋ ${esc(presetName(zh))} <small>${esc(everyText(every, unit))}</small></button>`,
      )
      .join('')}</div>`;
}

// 撳建議：即刻加，由今日開始，負責人用上次揀開嗰個
function bindPresets(root, after) {
  root.querySelectorAll('[data-preset]').forEach(
    (b) =>
      (b.onclick = () => {
        const p = CHORE_PRESETS.find(([zh]) => zh === b.dataset.preset);
        if (!p) return;
        const [zh, every, unit] = p;
        saveNew({ name: zh, every, unit, due: hkToday(), who: defaultWho(), note: '' });
        toast(t('choreAdded', { name: presetName(zh) }));
        b.remove();
        after?.();
      }),
  );
}

// ---------- 做咗 / 跳過 ----------

function markDone(c, { skip = false } = {}) {
  if (!c) return;
  const today = hkToday();
  const before = { due: c.due, lastDone: c.lastDone || '', lastBy: c.lastBy || '' };
  const patch = skip ? { due: nextDue(c, today) } : { due: nextDue(c, today), lastDone: today, lastBy: clean(state().me, 20) };
  store().updateChore(fid(), c.id, patch).catch(fail);
  const name = choreName(c).text;
  toast(skip ? t('choreSkipped', { day: day(patch.due) }) : t('choreDoneToast', { name, day: day(patch.due) }), {
    label: t('undo'),
    run: () => store().updateChore(fid(), c.id, before).catch(fail),
  });
}

// ---------- 加 / 改 ----------

// 上次揀開嘅負責人；第一次就揀唯一一個負責煮飯（唔喺度食）嘅成員，通常係姐姐
function defaultWho() {
  const members = getMembers();
  const last = ls.get(`fsl-chore-who-${fid()}`);
  if (last !== null && (last === '' || members.some((m) => m.id === last))) return last;
  const cooks = members.filter((m) => m.eats === false);
  return cooks.length === 1 ? cooks[0].id : '';
}

function saveNew({ name, every, unit, due, who, note }) {
  const { lang, tr } = prepareItem(name, getLang());
  store()
    .addChores(fid(), [{ name, lang, tr, trAuto: {}, every, unit, start: due, due, who, note, by: clean(state().me, 20) }])
    .catch(fail);
}

function openChore(c) {
  const editing = !!c;
  const members = [...getMembers()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const who = editing ? c.who || '' : defaultWho();
  const unit = c?.unit || 'week';
  const unitLabel = { day: 'choreUnitDay', week: 'choreUnitWeek', month: 'choreUnitMonth' };
  const have = new Set(chores.map((x) => lookup(x.name)?.zh || x.name));
  const presets = editing ? [] : CHORE_PRESETS.filter(([zh]) => !have.has(zh));
  openDialog(
    `<form id="chore-form">
      <h2>🧹 ${esc(t(editing ? 'choreEdit' : 'choreAdd'))}</h2>
      ${presets.length ? `<div class="cats chore-presets dialog-presets">${presets.map(([zh]) => `<button type="button" class="freq-chip" data-fill="${esc(zh)}">${esc(presetName(zh))}</button>`).join('')}</div>` : ''}
      <label class="field"><span>${esc(t('choreName'))}</span>
        <input class="input" name="name" maxlength="60" required placeholder="${esc(t('choreNamePlaceholder'))}" value="${esc(editing ? choreName(c).text : '')}"></label>
      <div class="field"><span>${esc(t('choreEvery'))}</span>
        <div class="row every-row">
          <input class="input every-input" name="every" type="number" inputmode="numeric" min="1" max="99" required value="${c?.every || 1}">
          <div class="segmented">${UNITS.map((u) => `<label><input type="radio" name="unit" value="${u}" ${u === unit ? 'checked' : ''}><span>${esc(t(unitLabel[u]))}</span></label>`).join('')}</div>
        </div></div>
      <label class="field"><span>${esc(t('choreNext'))}</span><input class="input" type="date" name="due" required value="${esc(c?.due || hkToday())}"></label>
      <div class="field"><span>${esc(t('choreWho'))}</span>
        <div class="segmented">${[['', t('choreAnyone')], ...members.map((m) => [m.id, m.name])]
          .map(([id, n]) => `<label><input type="radio" name="who" value="${esc(id)}" ${id === who ? 'checked' : ''}><span>${esc(n)}</span></label>`)
          .join('')}</div>
        <p class="small muted">${esc(t('choreNotifyHint'))}</p></div>
      <label class="field"><span>${esc(t('dinnerNote'))}</span><input class="input" name="note" maxlength="200" value="${esc(c?.note || '')}"></label>
      <div class="actions">
        ${editing ? `<button type="button" class="btn danger" id="chore-del">${esc(t('delete'))}</button><button type="button" class="btn" id="chore-skip">${esc(t('choreSkip'))}</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      const form = $('#chore-form', dlg);
      dlg.querySelectorAll('[data-fill]').forEach(
        (b) =>
          (b.onclick = () => {
            const [zh, every, u] = CHORE_PRESETS.find(([x]) => x === b.dataset.fill);
            form.name.value = presetName(zh);
            form.name.dataset.zh = zh;
            form.every.value = every;
            form.querySelector(`input[name="unit"][value="${u}"]`).checked = true;
          }),
      );
      form.name.oninput = () => delete form.name.dataset.zh;
      if (!editing) setTimeout(() => form.name.focus(), 50);
      $('#chore-del', dlg)?.addEventListener('click', () =>
        confirmDialog(t('choreDeleteConfirm', { name: choreName(c).text }), t('delete'), () => store().deleteChore(fid(), c.id).catch(fail)),
      );
      $('#chore-skip', dlg)?.addEventListener('click', () => {
        dlg.close();
        markDone(c, { skip: true });
      });
      form.onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const every = Number(f.get('every'));
        const unit = f.get('unit');
        if (!validRule(every, unit)) return toast(t('choreBadEvery'));
        const typed = clean(f.get('name'), 60);
        if (!typed) return;
        const due = f.get('due') || hkToday();
        const who = clean(f.get('who'), 40);
        const note = clean(f.get('note'), 200);
        ls.set(`fsl-chore-who-${fid()}`, who);
        if (!editing) {
          saveNew({ name: form.name.dataset.zh || typed, every, unit, due, who, note });
        } else {
          const patch = { every, unit, due, who, note };
          // 改咗次數或者日期：由新日期重新計
          if (every !== c.every || unit !== c.unit || due !== c.due) patch.start = due;
          // 改咗名（唔係淨係睇緊翻譯）：當新名，重新翻譯
          if (typed !== choreName(c).text) Object.assign(patch, { name: typed, ...pick(prepareItem(typed, getLang())), trAuto: {} });
          store().updateChore(fid(), c.id, patch).catch(fail);
        }
        dlg.close();
        toast(t('saved'));
      };
    },
  );
}

const pick = ({ lang, tr }) => ({ lang, tr });
