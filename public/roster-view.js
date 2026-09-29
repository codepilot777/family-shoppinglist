// ✈️ 匯入 roster：機師 .ics（出勤）同 Excel 更表（例如姐姐嘅放假日）、設定、日曆顯示。
import { t, langInfo } from './i18n.js';
import { $, esc, clean, toast, fail, openDialog, confirmDialog } from './ui.js';
import { hkToday, formatDay } from './dates.js';
import { parseRoster, mergeRoster, awayAtDinner, rosterDay, homeBy, parseOffDays, mergeOff, isOff, DEFAULT_DINNER, DEFAULT_COMMUTE } from './roster.js';
import { readXlsx, serialToDate } from './xlsx-lite.js';
import { getMembers, myMemberId } from './dinner-view.js';

let ctx; // { state }
export function initRoster(context) {
  ctx = context;
}
const store = () => ctx.state.store;
const fid = () => ctx.state.familyId;
const day = (date) => formatDay(date, langInfo().htmlLang);
const hm = (s) => (s ? s.slice(11, 16) : '');
const dest = (r, t0) => (r?.showDest === false ? '' : t0.d);

// 寫入 Firestore 嘅欄位（subscribe 返嚟嘅 id / updatedAt 唔好寫返去）
const ROSTER_KEYS = ['trips', 'reserves', 'from', 'to', 'dinner', 'commute', 'showDest', 'off'];
function rosterDoc(current, patch) {
  const doc = { trips: [], reserves: [] };
  for (const k of ROSTER_KEYS) if (current?.[k] !== undefined) doc[k] = current[k];
  Object.assign(doc, patch);
  if (current?.from && doc.from > current.from) doc.from = current.from;
  if (current?.to && doc.to < current.to) doc.to = current.to;
  return { ...doc, by: clean(ctx.state.me, 20) };
}

// ---------- 📅 日曆每日嘅行 ----------

export function rosterRows(date) {
  const rows = [];
  for (const m of getMembers()) {
    const r = m.roster;
    if (!r) continue;
    for (const x of rosterDay(r, date)) {
      const tr = x.trip;
      let time = '';
      let text = '';
      let meta = '';
      if (x.kind === 'leave') {
        time = hm(tr.s);
        text = t('rosterLeave', { name: m.name, dest: dest(r, tr) });
        meta = tr.e ? t('rosterBackOn', { day: day(tr.e.slice(0, 10)), time: hm(tr.e) }) : t('rosterBackUnknown');
      } else if (x.kind === 'away') {
        time = '';
        text = t('rosterAway', { name: m.name, dest: dest(r, tr) });
        meta = tr.e ? t('rosterBackOn', { day: day(tr.e.slice(0, 10)), time: hm(tr.e) }) : t('rosterBackUnknown');
      } else if (x.kind === 'back') {
        time = hm(tr.e);
        text = t('rosterBack', { name: m.name });
        meta = t('rosterHomeBy', { time: hm(homeBy(r, tr)) });
      } else if (x.kind === 'turn') {
        time = hm(tr.s);
        text = t('rosterTurn', { name: m.name, dest: dest(r, tr) });
        meta = `${hm(tr.s)}–${hm(tr.e)} · ${t('rosterHomeBy', { time: hm(homeBy(r, tr)) })}`;
      } else if (x.kind === 'sim') {
        time = hm(tr.s);
        text = t('rosterSim', { name: m.name });
        meta = `${hm(tr.s)}–${hm(tr.e)} · ${t('rosterHomeBy', { time: hm(homeBy(r, tr)) })}`;
      } else if (x.kind === 'reserve') {
        time = hm(x.reserve.s);
        text = t('rosterReserve', { name: m.name });
        meta = `${hm(x.reserve.s)}–${hm(x.reserve.e)}`;
      } else if (x.kind === 'off') {
        text = t('rosterOffDay', { name: m.name });
      }
      const icon = { back: '🏠', reserve: '⏳', sim: '🛩️', off: '🌴' }[x.kind] || '✈️';
      rows.push(`<li class="item cal-row roster-row"><button class="toggle" data-roster="${esc(m.id)}">
        <span class="cal-time">${esc(time)}</span>
        <span class="body"><span class="name">${icon} ${esc(text.replace(/\s+·\s*$/, ''))}</span><div class="meta">${esc(meta)}</div></span>
        <span class="more" aria-hidden="true">›</span></button></li>`);
    }
  }
  return rows;
}

// 綠點：出勤 / 返港…（放假另外用紅點）
export const rosterCount = (date) =>
  getMembers().reduce((n, m) => n + (m.roster ? rosterDay(m.roster, date).filter((x) => x.kind !== 'off').length : 0), 0);
// 🔴 紅點：有人放假（例如姐姐）
export const anyOff = (date) => getMembers().some((m) => isOff(m.roster, date));

// ---------- 匯入 ----------

export function pickRosterFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.ics,.xlsx,text/calendar,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
      // Excel（.xlsx 係 zip，開頭係「PK」）→ 放假日；其他當 .ics
      if (/\.xlsx$/i.test(file.name) || (head[0] === 0x50 && head[1] === 0x4b)) openImportOff(parseOffDays(await readXlsx(buf), serialToDate));
      else openImport(parseRoster(new TextDecoder().decode(buf)));
    } catch (err) {
      console.error(err);
      toast(t('rosterBadFile'));
    }
  };
  input.click();
}

// 預覽：邊幾晚自動當唔返食飯
function awayDates(roster, from, to) {
  const out = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400e3).toISOString().slice(0, 10)) {
    if (awayAtDinner(roster, d)) out.push(d);
  }
  return out;
}

function openImport(parsed) {
  const members = getMembers();
  if (!members.length) return toast(t('rosterNeedMember'));
  const mine = myMemberId();
  let memberId = members.find((m) => m.roster)?.id || mine || members[0].id;
  const summary = (tr) =>
    tr.k === 'sim'
      ? `🛩️ ${day(tr.s.slice(0, 10))} SIM ${hm(tr.s)}–${hm(tr.e)}`
      : `✈️ ${day(tr.s.slice(0, 10))} ${hm(tr.s)} ${tr.d} → ${tr.e ? `${day(tr.e.slice(0, 10))} ${hm(tr.e)}` : t('rosterBackUnknown')}`;
  openDialog(
    `<form id="roster-form">
      <h2>✈️ ${esc(t('rosterImport'))}</h2>
      <p class="small muted">${esc(t('rosterRange', { from: day(parsed.from), to: day(parsed.to) }))}</p>
      <div class="field"><span>${esc(t('rosterWho'))}</span>
        <div class="segmented">${members
          .map((m) => `<label><input type="radio" name="member" value="${esc(m.id)}" ${m.id === memberId ? 'checked' : ''}><span>${esc(m.name)}</span></label>`)
          .join('')}</div></div>
      <ul class="roster-preview small">${parsed.trips.map((tr) => `<li>${esc(summary(tr))}</li>`).join('')}${parsed.reserves
        .map((r) => `<li>⏳ ${esc(`${day(r.s.slice(0, 10))} ${t('rosterReserveShort')} ${hm(r.s)}–${hm(r.e)}`)}</li>`)
        .join('')}${parsed.returns.map((r) => `<li>🏠 ${esc(`${day(r.e.slice(0, 10))} ${hm(r.e)}`)}</li>`).join('')}</ul>
      ${settingsFields()}
      <p class="roster-away"></p>
      <p class="small muted">${esc(t('rosterPrivacy'))}</p>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('rosterConfirm'))}</button>
      </div>
    </form>`,
    (dlg) => {
      const form = $('#roster-form', dlg);
      const current = () => members.find((m) => m.id === memberId)?.roster || null;
      const fill = () => {
        const r = current();
        form.dinner.value = r?.dinner || DEFAULT_DINNER;
        form.commute.value = r?.commute ?? DEFAULT_COMMUTE;
        form.showDest.checked = r?.showDest !== false;
      };
      const preview = () => {
        const merged = { ...mergeRoster(current(), parsed, hkToday()), ...readSettings(form) };
        const dates = awayDates(merged, parsed.from, parsed.to);
        $('.roster-away', dlg).textContent = dates.length
          ? t('rosterAwayDinners', { days: dates.map((d) => Number(d.slice(8))).join('、') })
          : t('rosterNoAwayDinners');
        return merged;
      };
      fill();
      preview();
      form.querySelectorAll('input[name="member"]').forEach(
        (r) =>
          (r.onchange = () => {
            memberId = r.value;
            fill();
            preview();
          }),
      );
      form.dinner.oninput = form.commute.oninput = preview;
      form.onsubmit = (e) => {
        e.preventDefault();
        const merged = preview();
        store().setRoster(fid(), memberId, rosterDoc(current(), merged)).catch(fail);
        dlg.close();
        toast(t('rosterSaved', { n: parsed.trips.length }));
      };
    },
  );
}

function settingsFields(r) {
  return `<div class="row">
      <label class="field grow"><span>${esc(t('rosterDinnerTime'))}</span><input class="input" type="time" name="dinner" required value="${esc(r?.dinner || DEFAULT_DINNER)}"></label>
      <label class="field grow"><span>${esc(t('rosterCommute'))}</span><input class="input" type="number" name="commute" min="0" max="300" inputmode="numeric" required value="${r?.commute ?? DEFAULT_COMMUTE}"></label>
    </div>
    <label class="check-row"><input type="checkbox" name="showDest" ${r?.showDest === false ? '' : 'checked'}> ${esc(t('rosterShowDest'))}</label>`;
}

function readSettings(form) {
  const dinner = /^\d{2}:\d{2}$/.test(form.dinner.value) ? form.dinner.value : DEFAULT_DINNER;
  const commute = Math.max(0, Math.min(300, Math.round(Number(form.commute.value)))) || 0;
  return { dinner, commute, showDest: form.showDest.checked };
}

// 🌴 Excel 更表：放假日
function openImportOff(parsed) {
  const members = getMembers();
  if (!members.length) return toast(t('rosterNeedMember'));
  const cooks = members.filter((m) => m.eats === false);
  let memberId = members.find((m) => m.roster?.off?.length)?.id || (cooks.length === 1 ? cooks[0].id : myMemberId() || members[0].id);
  const byMonth = {};
  for (const d of parsed.off) (byMonth[d.slice(0, 7)] ||= []).push(Number(d.slice(8)));
  const monthName = (ym) => new Intl.DateTimeFormat(langInfo().htmlLang, { month: 'short', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
  const others = Object.entries(parsed.other);
  openDialog(
    `<form id="off-form">
      <h2>🌴 ${esc(t('rosterImportOff'))}</h2>
      <p class="small muted">${esc(t('rosterRange', { from: day(parsed.from), to: day(parsed.to) }))} · ${esc(t('rosterOffCount', { n: parsed.off.length }))}</p>
      <div class="field"><span>${esc(t('rosterWho'))}</span>
        <div class="segmented">${members
          .map((m) => `<label><input type="radio" name="member" value="${esc(m.id)}" ${m.id === memberId ? 'checked' : ''}><span>${esc(m.name)}</span></label>`)
          .join('')}</div></div>
      <ul class="roster-preview small">${Object.entries(byMonth)
        .map(([ym, days]) => `<li><b>${esc(monthName(ym))}</b> ${esc(days.join('、'))}</li>`)
        .join('')}</ul>
      ${others.length ? `<p class="small late-txt">${esc(t('rosterOffOther', { labels: others.map(([k, n]) => `${k}（${n}）`).join('、') }))}</p>` : ''}
      <p class="small muted">${esc(t('rosterOffHint'))}</p>
      <div class="actions"><span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        <button class="btn primary">${esc(t('rosterConfirm'))}</button>
      </div>
    </form>`,
    (dlg) => {
      const form = $('#off-form', dlg);
      form.querySelectorAll('input[name="member"]').forEach((r) => (r.onchange = () => (memberId = r.value)));
      form.onsubmit = (e) => {
        e.preventDefault();
        const current = getMembers().find((m) => m.id === memberId)?.roster || null;
        const off = mergeOff(current?.off, parsed, hkToday());
        store().setRoster(fid(), memberId, rosterDoc(current, { off, from: parsed.from, to: parsed.to })).catch(fail);
        dlg.close();
        toast(t('rosterOffSaved', { n: parsed.off.length }));
      };
    },
  );
}

// 撳日曆入面 roster 嗰行：改設定、再匯入、清除
export function openRosterSettings(memberId) {
  const m = getMembers().find((x) => x.id === memberId);
  const r = m?.roster;
  if (!r) return;
  const hasDuty = !!(r.trips?.length || r.reserves?.length);
  openDialog(
    `<form id="roster-settings">
      <h2>✈️ ${esc(t('rosterOf', { name: m.name }))}</h2>
      <p class="small muted">${esc(t('rosterRange', { from: day(r.from), to: day(r.to) }))}${r.off?.length ? ` · 🌴 ${esc(t('rosterOffCount', { n: r.off.length }))}` : ''}</p>
      ${hasDuty ? settingsFields(r) : ''}
      <div class="actions">
        <button type="button" class="btn danger" id="roster-clear">${esc(t('rosterClear'))}</button>
        <button type="button" class="btn" id="roster-reimport">📥 ${esc(t('rosterImport'))}</button>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
        ${hasDuty ? `<button class="btn primary">${esc(t('save'))}</button>` : ''}
      </div>
    </form>`,
    (dlg) => {
      const form = $('#roster-settings', dlg);
      $('#roster-clear', dlg).onclick = () =>
        confirmDialog(t('rosterClearConfirm', { name: m.name }), t('rosterClear'), () => store().deleteRoster(fid(), memberId).catch(fail));
      $('#roster-reimport', dlg).onclick = () => {
        dlg.close();
        pickRosterFile();
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        store().updateRoster(fid(), memberId, readSettings(form)).catch(fail);
        dlg.close();
        toast(t('saved'));
      };
    },
  );
}
