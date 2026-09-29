// 🍚 食飯頁：今晚幾多人、未來幾日、每星期問卷、成員、通知同 WhatsApp 分享。
import { t, getLang, langInfo } from './i18n.js';
import { $, esc, ls, clean, toast, fail, openDialog, confirmDialog } from './ui.js';
import { hkNow, hkToday, addDays, weekday, nextWeekStart, weekDates, formatDay } from './dates.js';
import { CUTOFF_HOUR, attendance, summarize, isLateChange, defaultPattern } from './dinner.js';
import { initMenu, subscribeRecipes, dishesLine, marketCardHtml, bindMenu } from './menu-view.js';

let ctx; // { state, onChange }
const d = {
  members: [],
  dinners: {},
  today: hkToday(),
  unsubDinners: null,
};

export function initDinner(context) {
  ctx = context;
  initMenu({ ctx, dinners: () => d.dinners, headcount: (date) => daySummary(date).total, rerender: () => renderDinner() });
  document.addEventListener('visibilitychange', () => {
    // 過咗半夜：重新訂閱新嘅日期範圍
    if (document.visibilityState === 'visible' && ctx.state.familyId && hkToday() !== d.today) subscribeDinners(ctx.state.familyId);
  });
}

const store = () => ctx.state.store;
const fid = () => ctx.state.familyId;
const dayLabel = (date) => formatDay(date, langInfo().htmlLang);
const eaters = () => d.members.filter((m) => m.eats !== false).sort(byCreated);
const byCreated = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
const statusText = (home) => (home ? `✅ ${t('home')}` : `❌ ${t('away')}`);
const appUrl = () => `${location.origin}${location.pathname}`;

export const getMembers = () => d.members;

export function myMemberId() {
  const id = ls.get(`fsl-member-${fid()}`);
  return d.members.some((m) => m.id === id) ? id : null;
}
const myMember = () => d.members.find((m) => m.id === myMemberId());

function subscribeDinners(familyId) {
  d.unsubDinners?.();
  d.today = hkToday();
  d.unsubDinners = store().subscribeDinners(
    familyId,
    addDays(d.today, -1),
    addDays(d.today, 14),
    (docs) => {
      d.dinners = docs;
      renderDinner();
    },
    fail,
  );
}

export function dinnerOnEnterFamily(familyId) {
  d.members = [];
  d.dinners = {};
  subscribeDinners(familyId);
  const unsubMembers = store().subscribeMembers(
    familyId,
    (members) => {
      d.members = members;
      renderDinner();
      refreshPushToken();
      document.dispatchEvent(new Event('fsl-members')); // 🧹 家務要顯示負責人
    },
    fail,
  );
  return [unsubMembers, subscribeRecipes(familyId), () => d.unsubDinners?.()];
}

const daySummary = (date) => summarize(d.members, date, d.dinners[date], weekday(date));

// ---------- 畫面 ----------

export function renderDinner() {
  const root = $('#dinner');
  if (!root || root.classList.contains('hidden')) return;
  const me = myMember();

  if (!me) {
    root.innerHTML = whoAreYouCard();
    bindWhoAreYou(root);
    return;
  }

  const now = hkNow();
  const today = d.today;
  const sum = daySummary(today);
  const mine = attendance(me, today, d.dinners[today], weekday(today));
  const cutoff = now.hour >= CUTOFF_HOUR;
  const weekStart = nextWeekStart(today);
  const needWeek = me.eats !== false && !me.proxy && me.lastConfirmedWeek !== weekStart && [5, 6, 0].includes(weekday(today));
  const unfilled = d.members.filter((m) => m.eats !== false && !m.proxy && m.lastConfirmedWeek !== weekStart);

  let html = '';
  if (needWeek) html += `<button class="banner" id="week-banner">📝 ${esc(t('weekBanner'))}</button>`;

  html += `<section class="card today">
    <div class="today-head">
      <div>
        <div class="muted small">${esc(t('tonight'))} · ${esc(dayLabel(today))}</div>
        <div class="big-count">🍚 ${esc(t('peopleCount', { n: sum.total }))}</div>
      </div>
      <span class="pill ${cutoff ? 'late' : ''}">${esc(cutoff ? t('cutoffPassed') : t('cutoffAt', { h: CUTOFF_HOUR }))}</span>
    </div>
    <ul class="people">${sum.rows.map((r) => personChip(r)).join('')}</ul>
    <button class="dishes-line" data-menu="${esc(today)}">${dishesLine(today)} <span class="link-btn">✏️</span></button>
    ${
      me.eats !== false
        ? `<div class="my-tonight">
        <span class="small muted">${esc(t('myTonight'))}</span>
        <div class="seg2" role="group">
          <button class="${mine.home ? 'on' : ''}" data-set-home="1">✅ ${esc(t('home'))}</button>
          <button class="${!mine.home ? 'on away' : ''}" data-set-home="0">❌ ${esc(t('away'))}</button>
        </div>
        ${
          mine.home
            ? `<div class="stepper" aria-label="${esc(t('guests'))}"><span class="small muted">${esc(t('guests'))}</span>
            <button data-guests="-1" aria-label="-">−</button><b>${mine.guests}</b><button data-guests="1" aria-label="+">＋</button></div>`
            : ''
        }
      </div>`
        : ''
    }
    <button class="link-btn" data-day="${esc(today)}">✏️ ${esc(t('edit'))}</button>
  </section>`;

  html += marketCardHtml(today);

  html += `<h2 class="group-title">${esc(t('nextDays'))}</h2><ul class="items days">`;
  for (let i = 1; i <= 7; i++) {
    const date = addDays(today, i);
    const s = daySummary(date);
    const away = s.away.map((r) => r.member.name);
    const late = s.rows.some((r) => r.late);
    html += `<li class="item"><button class="toggle" data-day="${esc(date)}">
      <span class="day-label">${esc(dayLabel(date))}</span>
      <span class="body"><span class="meta">${esc(away.length ? t('awayList', { names: away.join('、') }) : t('everyoneHome'))}${late ? ' ⚠️' : ''}</span>
        <span class="meta dishes-meta">${dishesLine(date)}</span></span>
      <b class="day-count">🍚 ${s.total}</b>
    </button><button class="icon-btn more" data-menu="${esc(date)}" aria-label="${esc(t('pickDishes'))}" title="${esc(t('pickDishes'))}">🍽</button></li>`;
  }
  html += `</ul>`;

  html += `<div class="dinner-actions">
    <button class="btn" id="open-week">${esc(t('weekForm'))}</button>
    <button class="btn" id="open-recipes">${esc(t('recipes'))}</button>
    <button class="btn" id="open-members">${esc(t('members'))}</button>
    <button class="btn" id="open-notify">${esc(pushEnabledHere() ? t('notifyOn') : t('notify'))}</button>
  </div>
  <div class="card small-card">
    <p class="small">${esc(unfilled.length ? t('notFilled', { names: unfilled.map((m) => m.name).join('、') }) : t('allFilled'))}</p>
    <div class="row wrap">
      <button class="btn" id="wa-week">💬 ${esc(unfilled.length ? t('remindWhatsApp') : t('shareWeek'))}</button>
      <button class="btn" id="wa-tonight">💬 ${esc(t('shareTonight'))}</button>
    </div>
  </div>`;

  root.innerHTML = html;
  bindMain(root, me, unfilled);
}

function personChip(r) {
  const m = r.member;
  const time = r.at ? new Date(r.at.toMillis ? r.at.toMillis() : r.at) : null;
  const lateTxt = r.late && time ? t('changedLate', { time: time.toLocaleTimeString(langInfo().htmlLang, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Hong_Kong' }) }) : '';
  return `<li class="person ${r.home ? '' : 'away'} ${r.late ? 'late' : ''}">
    <span>${r.home ? '✅' : '❌'} ${esc(m.name)}${r.guests ? ` <b>${esc(t('guestsN', { n: r.guests }))}</b>` : ''}</span>
    ${r.note ? `<span class="small muted">${esc(r.note)}</span>` : ''}
    ${lateTxt ? `<span class="small late-txt">⚠️ ${esc(lateTxt)}</span>` : ''}
  </li>`;
}

function whoAreYouCard() {
  const members = [...d.members].sort(byCreated);
  return `<section class="card">
    <h2>${esc(t('whoAreYou'))}</h2>
    <p class="small muted">${esc(t('whoAreYouHint'))}</p>
    <div class="who-list">
      ${members.map((m) => `<button class="btn" data-pick="${esc(m.id)}">${esc(m.name)}</button>`).join('')}
    </div>
    <hr class="sep">
    <label class="field"><span>${esc(t('memberName'))}</span><input class="input" id="new-me" maxlength="20" value="${esc(ctx.state.me)}"></label>
    <label class="check-row"><input type="checkbox" id="new-me-cook"> ${esc(t('iCook'))}</label>
    <button class="btn primary block" id="create-me">${esc(t('iAmNew', { name: ctx.state.me }))}</button>
  </section>`;
}

function bindWhoAreYou(root) {
  root.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => linkMember(b.dataset.pick)));
  $('#new-me', root).oninput = (e) => ($('#create-me', root).textContent = t('iAmNew', { name: clean(e.target.value, 20) }));
  $('#create-me', root).onclick = () => {
    const name = clean($('#new-me', root).value, 20);
    if (!name) return toast(t('needName'));
    const id = store().addMember(fid(), { name, proxy: false, eats: !$('#new-me-cook', root).checked, pattern: defaultPattern() });
    linkMember(id);
  };
}

function linkMember(id) {
  ls.set(`fsl-member-${fid()}`, id);
  renderDinner();
  refreshPushToken();
}

function bindMain(root, me, unfilled) {
  $('#week-banner', root)?.addEventListener('click', () => openWeekForm());
  $('#open-week', root).onclick = () => openWeekForm();
  $('#open-members', root).onclick = openMembers;
  $('#open-notify', root).onclick = enablePush;
  $('#wa-week', root).onclick = () => shareWeek(unfilled);
  $('#wa-tonight', root).onclick = shareTonight;
  root.querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => openDay(b.dataset.day)));
  bindMenu(root, d.today);
  root.querySelectorAll('[data-set-home]').forEach(
    (b) => (b.onclick = () => setOne(me, d.today, { home: b.dataset.setHome === '1' })),
  );
  root.querySelectorAll('[data-guests]').forEach((b) => {
    b.onclick = () => {
      const cur = attendance(me, d.today, d.dinners[d.today], weekday(d.today));
      setOne(me, d.today, { home: true, guests: Math.max(0, Math.min(20, cur.guests + Number(b.dataset.guests))) });
    };
  });
}

// ---------- 寫入 ----------

function record(member, date, patch) {
  const cur = attendance(member, date, d.dinners[date], weekday(date));
  const home = patch.home ?? cur.home;
  return {
    date,
    memberId: member.id,
    rec: {
      home,
      guests: home ? Math.max(0, Math.min(20, Number(patch.guests ?? cur.guests) || 0)) : 0,
      note: clean(patch.note ?? cur.note, 60),
      by: ctx.state.me || '',
      late: isLateChange(date, hkNow()),
    },
  };
}

function setOne(member, date, patch) {
  const before = attendance(member, date, d.dinners[date], weekday(date));
  const entry = record(member, date, patch);
  store().setAttendance(fid(), [entry]).catch(fail);
  if (entry.rec.late && before.home !== entry.rec.home) offerLateNotice(member, date, entry.rec.home);
}

function offerLateNotice(member, date, home) {
  // 等 snapshot 更新咗先計人數
  setTimeout(() => {
    toast(t('lateToastPrompt'), {
      label: 'WhatsApp',
      run: () =>
        openWhatsApp(
          t('msgLate', { name: member.name, day: dayLabel(date), status: statusText(home), n: daySummary(date).total, url: `${appUrl()}?view=dinner` }),
        ),
    });
  }, 300);
}

// ---------- 對話框 ----------

function openDay(date) {
  const list = eaters();
  const doc = d.dinners[date];
  openDialog(
    `<form id="day-form">
      <h2>${esc(t('dayTitle', { day: dayLabel(date) }))}</h2>
      ${list
        .map((m) => {
          const a = attendance(m, date, doc, weekday(date));
          return `<fieldset class="day-row" data-mid="${esc(m.id)}">
            <legend>${esc(m.name)}</legend>
            <div class="seg2">
              <label><input type="radio" name="home-${esc(m.id)}" value="1" ${a.home ? 'checked' : ''}><span>✅ ${esc(t('home'))}</span></label>
              <label><input type="radio" name="home-${esc(m.id)}" value="0" ${a.home ? '' : 'checked'}><span>❌ ${esc(t('away'))}</span></label>
            </div>
            <div class="row">
              <label class="field"><span>${esc(t('guests'))}</span><input class="input" type="number" min="0" max="20" inputmode="numeric" name="guests-${esc(m.id)}" value="${a.guests}"></label>
              <label class="field grow"><span>${esc(t('dinnerNote'))}</span><input class="input" name="note-${esc(m.id)}" maxlength="60" placeholder="${esc(t('notesPlaceholder'))}" value="${esc(a.note)}"></label>
            </div>
          </fieldset>`;
        })
        .join('')}
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      $('#day-form', dlg).onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const entries = [];
        const lateChanges = [];
        for (const m of list) {
          const cur = attendance(m, date, doc, weekday(date));
          const home = f.get(`home-${m.id}`) === '1';
          const guests = Number(f.get(`guests-${m.id}`)) || 0;
          const note = clean(f.get(`note-${m.id}`), 60);
          if (home === cur.home && guests === cur.guests && note === cur.note) continue;
          const entry = record(m, date, { home, guests, note });
          entries.push(entry);
          if (entry.rec.late && home !== cur.home) lateChanges.push([m, home]);
        }
        dlg.close();
        if (!entries.length) return;
        store().setAttendance(fid(), entries).catch(fail);
        if (lateChanges.length) offerLateNotice(lateChanges[0][0], date, lateChanges[0][1]);
        toast(t('saved'));
      };
    },
  );
}

export function openWeekForm(memberId) {
  const me = myMember();
  const start = nextWeekStart(d.today);
  const dates = weekDates(start);
  const fillable = eaters();
  let target = d.members.find((m) => m.id === memberId) || (me?.eats !== false ? me : fillable[0]);
  if (!target) return toast(t('whoAreYou'));
  const range = `${dayLabel(dates[0])} – ${dayLabel(dates[6])}`;

  // 問卷要睇埋下星期嘅紀錄；暫時用已經載入嘅（範圍到 14 日後）
  const draw = (dlg) => {
    const rows = dates
      .map((date) => {
        const a = attendance(target, date, d.dinners[date], weekday(date));
        return `<div class="week-row" data-date="${esc(date)}">
          <span class="day-label">${esc(dayLabel(date))}</span>
          <div class="seg2 compact">
            <label><input type="radio" name="h-${date}" value="1" ${a.home ? 'checked' : ''}><span>✅</span></label>
            <label><input type="radio" name="h-${date}" value="0" ${a.home ? '' : 'checked'}><span>❌</span></label>
          </div>
          <input class="input guests-input" type="number" min="0" max="20" inputmode="numeric" name="g-${date}" value="${a.guests || ''}" placeholder="+0" aria-label="${esc(t('guests'))}">
          <input class="input note-input" name="n-${date}" maxlength="60" value="${esc(a.note)}" placeholder="${esc(t('notesPlaceholder'))}" aria-label="${esc(t('dinnerNote'))}">
        </div>`;
      })
      .join('');
    $('.week-rows', dlg).innerHTML = rows;
  };

  openDialog(
    `<form id="week-form">
      <h2>${esc(t('weekFormTitle', { range }))}</h2>
      <p class="small muted">${esc(t('weekFormHint'))}</p>
      <label class="field"><span>${esc(t('fillFor'))}</span>
        <select class="input" name="member">${fillable
          .map((m) => `<option value="${esc(m.id)}" ${m.id === target.id ? 'selected' : ''}>${esc(m.name)}${m.proxy ? ` (${esc(t('proxyBadge'))})` : ''}</option>`)
          .join('')}</select>
      </label>
      <div class="week-rows"></div>
      <label class="check-row"><input type="checkbox" name="pattern"> ${esc(t('rememberPattern'))}</label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('confirm'))}</button>
      </div>
    </form>`,
    (dlg) => {
      draw(dlg);
      $('select[name="member"]', dlg).onchange = (e) => {
        target = d.members.find((m) => m.id === e.target.value) || target;
        draw(dlg);
      };
      $('#week-form', dlg).onsubmit = (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const entries = dates.map((date) =>
          record(target, date, { home: f.get(`h-${date}`) === '1', guests: Number(f.get(`g-${date}`)) || 0, note: f.get(`n-${date}`) }),
        );
        store().setAttendance(fid(), entries).catch(fail);
        const patch = { lastConfirmedWeek: start };
        if (f.get('pattern')) {
          const pattern = [...(target.pattern || defaultPattern())];
          for (const en of entries) pattern[weekday(en.date)] = en.rec.home;
          patch.pattern = pattern;
        }
        store().updateMember(fid(), target.id, patch).catch(fail);
        dlg.close();
        toast(t('weekConfirmed'));
      };
    },
  );
}

function openMembers() {
  const draw = (dlg) => {
    const me = myMemberId();
    $('.member-rows', dlg).innerHTML = [...d.members]
      .sort(byCreated)
      .map(
        (m) => `<div class="member-row" data-mid="${esc(m.id)}">
          <input class="input" name="name" maxlength="20" value="${esc(m.name)}" aria-label="${esc(t('memberName'))}">
          <label class="check-row small"><input type="checkbox" name="eats" ${m.eats !== false ? 'checked' : ''}> ${esc(t('eats'))}</label>
          <label class="check-row small"><input type="checkbox" name="proxy" ${m.proxy ? 'checked' : ''}> ${esc(t('proxy'))}</label>
          <div class="row wrap">
            ${m.id === me ? `<span class="pill">🙋 ${esc(t('thisIsMe'))}</span>` : `<button type="button" class="btn small-btn" data-me="${esc(m.id)}">${esc(t('thisIsMe'))}</button>`}
            <button type="button" class="btn danger small-btn" data-del="${esc(m.id)}">🗑 ${esc(t('delete'))}</button>
          </div>
        </div>`,
      )
      .join('');
  };
  openDialog(
    `<form id="members-form">
      <h2>${esc(t('membersTitle'))}</h2>
      <div class="member-rows"></div>
      <div class="add-member row">
        <input class="input" id="new-member" maxlength="20" placeholder="${esc(t('memberName'))}">
        <button type="button" class="btn" id="add-member">${esc(t('addMember'))}</button>
      </div>
      <label class="check-row small"><input type="checkbox" id="new-member-proxy"> ${esc(t('proxy'))}</label>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('save'))}</button>
      </div>
    </form>`,
    (dlg) => {
      draw(dlg);
      $('#add-member', dlg).onclick = () => {
        const name = clean($('#new-member', dlg).value, 20);
        if (!name) return;
        store().addMember(fid(), { name, proxy: $('#new-member-proxy', dlg).checked, eats: true, pattern: defaultPattern() });
        $('#new-member', dlg).value = '';
        setTimeout(() => draw(dlg), 100);
      };
      $('.member-rows', dlg).onclick = (e) => {
        const del = e.target.closest('[data-del]');
        const mine = e.target.closest('[data-me]');
        if (mine) {
          ls.set(`fsl-member-${fid()}`, mine.dataset.me);
          refreshPushToken();
          draw(dlg);
        }
        if (del) {
          const m = d.members.find((x) => x.id === del.dataset.del);
          confirmDialog(t('deleteMemberConfirm', { name: m?.name || '' }), t('delete'), () => store().deleteMember(fid(), del.dataset.del).catch(fail));
        }
      };
      $('#members-form', dlg).onsubmit = (e) => {
        e.preventDefault();
        for (const row of dlg.querySelectorAll('.member-row')) {
          const m = d.members.find((x) => x.id === row.dataset.mid);
          if (!m) continue;
          const name = clean($('[name="name"]', row).value, 20) || m.name;
          const eats = $('[name="eats"]', row).checked;
          const proxy = $('[name="proxy"]', row).checked;
          if (name !== m.name || eats !== (m.eats !== false) || proxy !== !!m.proxy) {
            store().updateMember(fid(), m.id, { name, eats, proxy }).catch(fail);
          }
        }
        dlg.close();
        toast(t('saved'));
      };
    },
  );
}

// ---------- WhatsApp（後備） ----------

function openWhatsApp(text) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

function shareWeek(unfilled) {
  const dates = weekDates(nextWeekStart(d.today));
  const range = `${dayLabel(dates[0])} – ${dayLabel(dates[6])}`;
  const who = unfilled.length ? `${unfilled.map((m) => `@${m.name}`).join(' ')}\n` : '';
  openWhatsApp(who + t('msgWeek', { range, url: `${appUrl()}?view=dinner&week=1` }));
}

function shareTonight() {
  const s = daySummary(d.today);
  const away = s.away.map((r) => r.member.name);
  openWhatsApp(
    t('msgTonight', {
      day: dayLabel(d.today),
      n: s.total,
      away: away.length ? t('awayList', { names: away.join('、') }) : t('everyoneHome'),
      url: `${appUrl()}?view=dinner`,
    }),
  );
}

// ---------- 通知 ----------

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const pushEnabledHere = () => !!ls.get(`fsl-push-${fid()}`) && typeof Notification !== 'undefined' && Notification.permission === 'granted';

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

async function saveToken() {
  const me = myMember();
  if (!me) return false;
  const token = await store().getPushToken(store().vapidKey);
  if (!token) return false;
  const key = await sha(token);
  await store().savePushToken(fid(), key, { token, memberId: me.id, lang: getLang(), uid: store().uid });
  ls.set(`fsl-push-${fid()}`, key);
  return true;
}

// 語言、成員有變或者 token 更新咗，都要寫返入去
export function refreshPushToken() {
  if (!pushEnabledHere() || !myMember()) return;
  saveToken().catch((err) => console.warn('push refresh failed', err));
}

async function enablePush() {
  const info = (msg) =>
    openDialog(`<h2>🔔</h2><p>${esc(msg)}</p><p class="small muted">${esc(t('notifyHint'))}</p>
      <div class="actions"><span class="spacer"></span><button class="btn primary" data-close>${esc(t('close'))}</button></div>`);
  if (store().mode === 'local') return info(t('modeLocal'));
  if (!store().pushConfigured) return info(t('notifyNotSetup'));
  if (isIOS() && !isStandalone()) return info(t('notifyNeedsInstall'));
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return info(t('notifyUnsupported'));
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return info(t('notifyDenied'));
  try {
    if (!(await saveToken())) return info(t('notifyUnsupported'));
    toast(t('notifyEnabled'));
    renderDinner();
  } catch (err) {
    fail(err);
  }
}

// ---------- 由通知 / 連結帶入嚟嘅參數 ----------

// ?view=dinner&week=1 → 開問卷；&set=home|away&date=YYYY-MM-DD&m=<member> → 直接改
export function handleDinnerParams(params) {
  const set = params.get('set');
  const date = params.get('date');
  const mid = params.get('m');
  const week = params.get('week');
  if (!set && !week) return;
  // 等成員資料載入先做
  let tries = 0;
  const run = () => {
    if (!d.members.length && tries++ < 40) return setTimeout(run, 150);
    if (week) openWeekForm(mid);
    if (set && /^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      const m = d.members.find((x) => x.id === mid) || myMember();
      if (!m) return;
      const home = set === 'home';
      setOne(m, date, { home });
      toast(t('setApplied', { name: m.name, day: dayLabel(date), status: statusText(home) }));
    }
  };
  run();
}
