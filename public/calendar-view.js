// 📅 日曆（頂部 icon）：一個星期 / 一個月睇晒有日期嘅嘢。
// 自動顯示食飯人數、菜式、買餸日、家務；另外可以加一次性「事項」（家長日、覆診、考試…）。
// 只顯示呢部機有開嘅分頁嘅資料（例如淨係睇食飯嘅人唔會見到家務）。
import { t, getLang, langInfo } from './i18n.js';
import { $, esc, clean, toast, fail, openDialog, confirmDialog } from './ui.js';
import { hkToday, addDays, weekday, formatDay } from './dates.js';
import { prepareItem, lookup, translateTo } from './translate.js';
import { compressImage } from './image.js';
import { getMembers, dinnerSummary } from './dinner-view.js';
import { dishesLine } from './menu-view.js';
import { choresOn } from './chores-view.js';
import { duesOn } from './dues-view.js';
import { fmtMoney } from './wallet-view.js';
import { rosterRows, rosterCount, anyOff, pickRosterFile, openRosterSettings } from './roster-view.js';
import { eventsOnDate, isRepeating, onDate, repeatLabel, pruneExc } from './events.js';

const PHOTO_OPTS = { maxSide: 1600, maxChars: 700_000, quality: 0.85 };

let ctx; // { state, visibleViews(), go(view) }
let events = [];
let sheet = null;
const cal = { sel: null, mode: 'week', anchor: null };

export function initCalendar(context) {
  ctx = context;
  const refresh = () => sheet && renderCalendar();
  document.addEventListener('fsl-data', refresh);
  document.addEventListener('fsl-members', refresh);
}

const state = () => ctx.state;
const store = () => state().store;
const fid = () => state().familyId;
const shows = (view) => ctx.visibleViews().includes(view);
const locale = () => langInfo().htmlLang;
const memberName = (id) => getMembers().find((m) => m.id === id)?.name || '';
const monday = (date) => addDays(date, -((weekday(date) + 6) % 7));
const monthOf = (date) => date.slice(0, 7);

function eventTitle(e) {
  const lang = getLang();
  return e.tr?.[lang] || lookup(e.title)?.[lang] || e.title;
}

const translating = new Set();
function ensureEventTranslations() {
  const lang = getLang();
  for (const e of events) {
    if (e.tr?.[lang] || (e.lang || 'zh') === lang || lookup(e.title)?.[lang]) continue;
    const key = `${e.id}|${lang}`;
    if (translating.has(key)) continue;
    translating.add(key);
    translateTo({ name: e.title, lang: e.lang, tr: e.tr }, lang).then((res) => {
      if (res && fid()) store().setEventTranslation(fid(), e.id, lang, res.text, res.auto).catch(() => {});
    });
  }
}

export function calendarOnEnterFamily(familyId) {
  events = [];
  return [
    store().subscribeEvents(
      familyId,
      (list) => {
        events = list;
        if (sheet) renderCalendar();
      },
      fail,
    ),
    () => sheet?.close(),
  ];
}

// ---------- 某日有咩 ----------

const eventsOn = (date) => eventsOnDate(events, date);
// 星期日至六嘅短名（中文用「日一二…」，其他語言用 Sun / Min…）
const dayLabels = () => {
  const style = getLang() === 'zh' ? 'narrow' : 'short';
  return Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale(), { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + i))));
};
const repeatText = (e) =>
  isRepeating(e)
    ? `🔁 ${repeatLabel(e.repeat, dayLabels(), { everyDay: t('repeatEveryDay'), weekdays: t('repeatWeekdays'), sep: getLang() === 'zh' ? '' : ' ' })}${
        e.until ? ` · ${t('repeatUntilShort', { day: formatDay(e.until, locale()) })}` : ''
      }`
    : '';

function marks(date, today) {
  let n = eventsOn(date).length + rosterCount(date);
  if (shows('chores')) n += choresOn(date, today).length;
  if (shows('dues')) n += duesOn(date, today).length;
  const market = shows('dinner') && (state().family?.marketDays || []).includes(weekday(date));
  return { n, market, off: anyOff(date) };
}

function agendaHtml(date, today) {
  const rows = rosterRows(date); // ✈️ 邊個出勤 / 返港
  for (const e of eventsOn(date)) {
    const who = memberName(e.who);
    rows.push(`<li class="item cal-row"><button class="toggle" data-ev="${esc(e.id)}" data-occ="${esc(date)}">
      <span class="cal-time">${esc(e.time || t('calAllDay'))}</span>
      <span class="body"><span class="name">📌 ${esc(eventTitle(e))}</span>${e.photo ? ' <span class="small">📷</span>' : ''}
        <div class="meta">${esc([who && `👤 ${who}`, e.note, repeatText(e), e.changed && `✏️ ${t('occChanged')}`].filter(Boolean).join(' · '))}</div></span>
      <span class="more" aria-hidden="true">›</span></button></li>`);
  }
  if (shows('dinner') && date >= addDays(today, -1)) {
    const sum = dinnerSummary(date);
    if (sum) {
      const away = sum.away.map((r) => r.member.name);
      rows.push(`<li class="item cal-row"><button class="toggle" data-go="dinner">
        <span class="cal-time">🍚</span>
        <span class="body"><span class="name">${esc(t('calDinner', { n: sum.total }))}</span>
          <div class="meta">${dishesLine(date)}${away.length ? ` · ${esc(t('calAway', { names: away.join('、') }))}` : ''}</div></span>
        <span class="more" aria-hidden="true">›</span></button></li>`);
    }
    if ((state().family?.marketDays || []).includes(weekday(date))) {
      rows.push(`<li class="item cal-row"><button class="toggle" data-go="dinner"><span class="cal-time">🧺</span>
        <span class="body"><span class="name">${esc(t('calMarket'))}</span></span><span class="more" aria-hidden="true">›</span></button></li>`);
    }
  }
  if (shows('chores')) {
    for (const c of choresOn(date, today)) {
      const late = date === today && c.due < today;
      rows.push(`<li class="item cal-row"><button class="toggle" data-go="chores"><span class="cal-time">🧹</span>
        <span class="body"><span class="name">${esc(c.label)}</span>
          <div class="meta">${esc([c.whoName && `👤 ${c.whoName}`, date < today && c.lastBy && `✓ ${c.lastBy}`].filter(Boolean).join(' · '))}${
            late ? ` <span class="late-txt">${esc(t('calLate'))}</span>` : ''
          }</div></span>
        <span class="more" aria-hidden="true">›</span></button></li>`);
    }
  }
  if (shows('dues')) {
    for (const d of duesOn(date, today)) {
      rows.push(`<li class="item cal-row"><button class="toggle" data-go="dues"><span class="cal-time">${esc(d.icon)}</span>
        <span class="body"><span class="name">${esc(d.label)}</span>
          <div class="meta">${esc([d.amount && fmtMoney(d.amount), d.whoName && `👤 ${d.whoName}`, date < today && d.lastBy && `✓ ${d.lastBy}`].filter(Boolean).join(' · '))}${
            date === today && d.late ? ` <span class="late-txt">${esc(t('calLate'))}</span>` : ''
          }</div></span>
        <span class="more" aria-hidden="true">›</span></button></li>`);
    }
  }
  return rows.length ? `<ul class="items cal-list">${rows.join('')}</ul>` : `<p class="muted cal-empty">${esc(t('calNothing'))}</p>`;
}

// ---------- 畫面 ----------

export function openCalendar(date) {
  const today = hkToday();
  cal.sel = date || cal.sel || today;
  cal.anchor = cal.sel;
  if (!sheet) {
    sheet = document.createElement('dialog');
    sheet.className = 'sheet cal-sheet';
    document.body.appendChild(sheet);
    sheet.addEventListener('close', () => {
      sheet.remove();
      sheet = null;
    });
    sheet.addEventListener('click', onClick);
    sheet.showModal();
  }
  renderCalendar();
}

function renderCalendar() {
  if (!sheet) return;
  ensureEventTranslations();
  const today = hkToday();
  const lang = locale();
  const wd = (date, style = 'narrow') => new Intl.DateTimeFormat(lang, { weekday: style, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  const dayNum = (date) => Number(date.slice(8));
  const cell = (date, extraCls = '') => {
    const m = marks(date, today);
    return `<button class="cal-day ${extraCls} ${date === today ? 'today' : ''} ${date === cal.sel ? 'sel' : ''}" data-day="${date}">
      <span class="cal-num">${dayNum(date)}</span>
      <span class="cal-dots">${m.off ? '<i class="off"></i>' : ''}${m.market ? '<i class="mk"></i>' : ''}${m.n ? `<i></i>${m.n > 1 ? '<i></i>' : ''}` : ''}</span>
    </button>`;
  };

  let grid;
  let title;
  if (cal.mode === 'week') {
    const start = monday(cal.anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    title = `${formatDay(days[0], lang)} – ${formatDay(days[6], lang)}`;
    grid = `<div class="cal-grid week">${days.map((d) => `<div class="cal-col"><span class="cal-wd">${esc(wd(d, 'short'))}</span>${cell(d)}</div>`).join('')}</div>`;
  } else {
    const first = `${monthOf(cal.anchor)}-01`;
    const start = monday(first);
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const weeks = days[35].slice(0, 7) === monthOf(cal.anchor) ? 6 : 5;
    title = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${first}T00:00:00Z`));
    grid = `<div class="cal-grid month">
      ${days.slice(0, 7).map((d) => `<span class="cal-wd">${esc(wd(d))}</span>`).join('')}
      ${days
        .slice(0, weeks * 7)
        .map((d) => cell(d, monthOf(d) === monthOf(cal.anchor) ? '' : 'out'))
        .join('')}
    </div>`;
  }

  sheet.innerHTML = `
    <header class="sheet-head">
      <h2>📅 ${esc(t('calendar'))}</h2>
      <button type="button" class="icon-btn" data-close-sheet aria-label="${esc(t('close'))}">✕</button>
    </header>
    <div class="sheet-body">
      <div class="cal-nav">
        <button type="button" class="icon-btn" data-shift="-1" aria-label="‹">‹</button>
        <b>${esc(title)}</b>
        <button type="button" class="icon-btn" data-shift="1" aria-label="›">›</button>
      </div>
      <div class="cal-tools">
        <div class="segmented">${['week', 'month']
          .map((m) => `<label><input type="radio" name="calmode" value="${m}" ${cal.mode === m ? 'checked' : ''}><span>${esc(t(m === 'week' ? 'calWeek' : 'calMonth'))}</span></label>`)
          .join('')}</div>
        ${cal.sel !== today ? `<button type="button" class="btn small-btn" data-day="${today}">${esc(t('calToday'))}</button>` : ''}
      </div>
      ${grid}
      <p class="cal-legend small muted"><span><i class="off"></i>${esc(t('calLegendOff'))}</span><span><i class="mk"></i>${esc(t('calMarket'))}</span><span><i></i>${esc(t('calLegendOther'))}</span></p>
      <h3 class="cal-day-title">${esc(formatDay(cal.sel, lang))}${cal.sel === today ? ` · ${esc(t('calToday'))}` : ''}</h3>
      ${agendaHtml(cal.sel, today)}
      <button type="button" class="btn primary block cal-add" data-add-event>➕ ${esc(t('calAddEvent'))}</button>
      <button type="button" class="btn block cal-roster" data-import-roster>📥 ${esc(t('rosterImport'))}</button>
    </div>`;
  sheet.querySelectorAll('input[name="calmode"]').forEach(
    (r) =>
      (r.onchange = () => {
        cal.mode = r.value;
        cal.anchor = cal.sel;
        renderCalendar();
      }),
  );
}

function onClick(e) {
  if (e.target === sheet) return; // 全屏，唔會撳到外面
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-close-sheet')) return sheet.close();
  if (b.dataset.day) {
    cal.sel = b.dataset.day;
    if (cal.mode === 'week' || monthOf(cal.sel) !== monthOf(cal.anchor)) cal.anchor = cal.sel;
    return renderCalendar();
  }
  if (b.dataset.shift) {
    const n = Number(b.dataset.shift);
    if (cal.mode === 'week') cal.anchor = addDays(monday(cal.anchor), 7 * n);
    else {
      const [y, m] = cal.anchor.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + n, 1));
      cal.anchor = d.toISOString().slice(0, 10);
    }
    // 揀返同一個星期 / 月入面嘅第一日（或者今日）
    const today = hkToday();
    const inRange = cal.mode === 'week' ? monday(today) === monday(cal.anchor) : monthOf(today) === monthOf(cal.anchor);
    cal.sel = inRange ? today : cal.mode === 'week' ? monday(cal.anchor) : cal.anchor;
    return renderCalendar();
  }
  if (b.dataset.go) {
    sheet.close();
    return ctx.go(b.dataset.go);
  }
  if (b.dataset.ev) {
    const ev = events.find((x) => x.id === b.dataset.ev);
    return ev && isRepeating(ev) ? openOccurrence(ev, b.dataset.occ) : openEvent(ev);
  }
  if (b.hasAttribute('data-add-event')) return openEvent(null, cal.sel);
  if (b.hasAttribute('data-import-roster')) return pickRosterFile();
  if (b.dataset.roster) return openRosterSettings(b.dataset.roster);
}

// ---------- 加 / 改事項 ----------

function openEvent(ev, date) {
  const editing = !!ev;
  const members = [...getMembers()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let photo = ev?.photo || '';
  let saved = false;
  const added = new Set(); // 今次新影嘅相：冇儲存就刪走
  openDialog(
    `<form id="event-form">
      <h2>📌 ${esc(t(editing ? 'calEditEvent' : 'calAddEvent'))}</h2>
      <label class="field"><span>${esc(t('eventTitle'))}</span>
        <input class="input" name="title" maxlength="60" required placeholder="${esc(t('eventTitlePlaceholder'))}" value="${esc(editing ? eventTitle(ev) : '')}"></label>
      <div class="row">
        <label class="field grow"><span>${esc(t('walletDate'))}</span><input class="input" type="date" name="date" required value="${esc(ev?.date || date || hkToday())}"></label>
        <label class="field grow"><span>${esc(t('eventTime'))}</span><input class="input" type="time" name="time" value="${esc(ev?.time || '')}"></label>
      </div>
      <div class="field"><span>${esc(t('eventWho'))}</span>
        <div class="segmented">${[['', t('choreAnyone')], ...members.map((m) => [m.id, m.name])]
          .map(([id, n]) => `<label><input type="radio" name="who" value="${esc(id)}" ${id === (ev?.who || '') ? 'checked' : ''}><span>${esc(n)}</span></label>`)
          .join('')}</div>
        <p class="small muted">${esc(t('eventWhoHint'))}</p></div>
      <div class="field"><span>🔁 ${esc(t('eventRepeat'))}</span>
        <div class="cats repeat-days">${[1, 2, 3, 4, 5, 6, 0]
          .map((d) => `<label><input type="checkbox" name="repeat" value="${d}" ${ev?.repeat?.includes(d) ? 'checked' : ''}><span>${esc(dayLabels()[d])}</span></label>`)
          .join('')}</div>
        <label class="field until-field ${isRepeating(ev) ? '' : 'hidden'}"><span>${esc(t('eventUntil'))}</span><input class="input" type="date" name="until" value="${esc(ev?.until || '')}"></label>
      </div>
      <label class="field"><span>${esc(t('dinnerNote'))}</span><input class="input" name="note" maxlength="200" value="${esc(ev?.note || '')}"></label>
      <div class="field"><span>🧾 ${esc(t('eventPhoto'))}</span>
        <div class="event-photo"></div>
        <button type="button" class="btn" id="event-add-photo">📷 ${esc(t('eventAddPhoto'))}</button>
        <input type="file" id="event-photo-input" accept="image/*" hidden>
      </div>
      <div class="actions">
        ${editing ? `<button type="button" class="btn danger" id="event-del">${esc(t('delete'))}</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      const form = $('#event-form', dlg);
      const showPhoto = async () => {
        const box = $('.event-photo', dlg);
        box.innerHTML = '';
        $('#event-add-photo', dlg).classList.toggle('hidden', !!photo);
        if (!photo) return;
        const src = await store().getPhoto(fid(), photo).catch(() => null);
        if (!form.isConnected) return; // 視窗已經換咗（例如撳咗刪除）
        box.innerHTML = `<figure class="photo">${src ? `<img src="${esc(src)}" alt="">` : `<p class="small muted">${esc(t('photoUnavailable'))}</p>`}
          <button type="button" class="link-btn danger" id="event-photo-del">🗑 ${esc(t('delete'))}</button></figure>`;
        $('#event-photo-del', dlg).onclick = () => {
          photo = '';
          showPhoto();
        };
      };
      showPhoto();
      dlg.addEventListener(
        'close',
        () => {
          const drop = [...added].filter((id) => !saved || id !== photo);
          if (drop.length) store().deletePhotos(fid(), drop).catch(() => {});
        },
        { once: true },
      );
      $('#event-add-photo', dlg).onclick = () => $('#event-photo-input', dlg).click();
      $('#event-photo-input', dlg).onchange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        toast(t('processingPhoto'));
        try {
          const data = await compressImage(file, PHOTO_OPTS);
          const { id, done } = store().addPhoto(fid(), data);
          done.catch(fail);
          photo = id;
          added.add(id);
          $('#toast').classList.remove('show');
          showPhoto();
        } catch (err) {
          console.error(err);
          toast(t('photoFailed'));
        }
      };
      if (!editing) setTimeout(() => form.title.focus(), 50);
      form.querySelectorAll('input[name="repeat"]').forEach(
        (c) => (c.onchange = () => $('.until-field', dlg).classList.toggle('hidden', !form.querySelector('input[name="repeat"]:checked'))),
      );
      $('#event-del', dlg)?.addEventListener('click', () =>
        confirmDialog(t('choreDeleteConfirm', { name: eventTitle(ev) }), t('delete'), () => {
          store().deleteEvent(fid(), ev.id).catch(fail);
          if (ev.photo) store().deletePhotos(fid(), [ev.photo]).catch(() => {});
        }),
      );
      if (isRepeating(ev)) $('#event-del', dlg).textContent = t('deleteAllRepeats');
      form.onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const typed = clean(f.get('title'), 60);
        if (!typed) return;
        const data = {
          date: f.get('date') || hkToday(),
          time: /^\d{2}:\d{2}$/.test(f.get('time') || '') ? f.get('time') : '',
          who: clean(f.get('who'), 40),
          note: clean(f.get('note'), 200),
          photo,
          repeat: [...new Set(f.getAll('repeat').map(Number))].filter((d) => d >= 0 && d <= 6).sort(),
          until: '',
        };
        if (data.repeat.length && /^\d{4}-\d{2}-\d{2}$/.test(f.get('until') || '') && f.get('until') >= data.date) data.until = f.get('until');
        if (editing && isRepeating(ev)) data.exc = pruneExc(ev.exc, addDays(hkToday(), -60));
        if (!editing) {
          const { lang, tr } = prepareItem(typed, getLang());
          store().addEvent(fid(), { title: typed, lang, tr, trAuto: {}, ...data, by: clean(state().me, 20) }).catch(fail);
        } else {
          const patch = { ...data };
          if (typed !== eventTitle(ev)) {
            const { lang, tr } = prepareItem(typed, getLang());
            Object.assign(patch, { title: typed, lang, tr, trAuto: {} });
          }
          store().updateEvent(fid(), ev.id, patch).catch(fail);
          if (ev.photo && ev.photo !== photo) store().deletePhotos(fid(), [ev.photo]).catch(() => {});
        }
        saved = true;
        cal.sel = data.date;
        cal.anchor = data.date;
        dlg.close();
        toast(t('saved'));
        renderCalendar();
      };
    },
  );
}

// 🔁 重複事項：撳某一日 → 只改呢日 / 改全部 / 取消呢日
function openOccurrence(ev, date) {
  const occ = onDate(ev, date);
  openDialog(
    `<h2>📌 ${esc(eventTitle(ev))}</h2>
    <p class="small muted">${esc(formatDay(date, locale()))} · ${esc(repeatText(ev))}</p>
    <div class="occ-actions">
      <button type="button" class="btn block" id="occ-day">✏️ ${esc(t('occThisDay'))}</button>
      <button type="button" class="btn block" id="occ-all">🔁 ${esc(t('occAll'))}</button>
      <button type="button" class="btn block danger" id="occ-skip">🚫 ${esc(t('occSkip'))}</button>
      ${occ.changed ? `<button type="button" class="btn block" id="occ-reset">↩️ ${esc(t('occReset'))}</button>` : ''}
    </div>
    <div class="actions"><span class="spacer"></span><button type="button" class="btn" data-close>${esc(t('close'))}</button></div>`,
    (dlg) => {
      const setExc = (val) => {
        const exc = { ...pruneExc(ev.exc, addDays(hkToday(), -60)) };
        if (val) exc[date] = val;
        else delete exc[date];
        store().updateEvent(fid(), ev.id, { exc }).catch(fail);
      };
      $('#occ-day', dlg).onclick = () => openEventDay(ev, date, setExc);
      $('#occ-all', dlg).onclick = () => openEvent(ev);
      $('#occ-skip', dlg).onclick = () => {
        setExc({ skip: true });
        dlg.close();
        toast(t('occSkipped', { day: formatDay(date, locale()) }));
      };
      $('#occ-reset', dlg)?.addEventListener('click', () => {
        setExc(null);
        dlg.close();
        toast(t('saved'));
      });
    },
  );
}

// 只改某一日：時間、邊個、備註
function openEventDay(ev, date, setExc) {
  const occ = onDate(ev, date);
  const members = [...getMembers()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  openDialog(
    `<form id="occ-form">
      <h2>✏️ ${esc(eventTitle(ev))}</h2>
      <p class="small muted">${esc(t('occOnly', { day: formatDay(date, locale()) }))}</p>
      <label class="field"><span>${esc(t('eventTime'))}</span><input class="input" type="time" name="time" value="${esc(occ.time || '')}"></label>
      <div class="field"><span>${esc(t('eventWho'))}</span>
        <div class="segmented">${[['', t('choreAnyone')], ...members.map((m) => [m.id, m.name])]
          .map(([id, n]) => `<label><input type="radio" name="who" value="${esc(id)}" ${id === (occ.who || '') ? 'checked' : ''}><span>${esc(n)}</span></label>`)
          .join('')}</div></div>
      <label class="field"><span>${esc(t('dinnerNote'))}</span><input class="input" name="note" maxlength="200" value="${esc(occ.note || '')}"></label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      $('#occ-form', dlg).onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        setExc({
          time: /^\d{2}:\d{2}$/.test(f.get('time') || '') ? f.get('time') : '',
          who: clean(f.get('who'), 40),
          note: clean(f.get('note'), 200),
        });
        dlg.close();
        toast(t('saved'));
      };
    },
  );
}
