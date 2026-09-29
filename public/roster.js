// ✈️ 機師 roster（國泰 Realtime Roster 匯出嘅 .ics）→「幾時唔喺屋企」。
// 冇用 DOM，app 同 GitHub Actions 通知 script 共用。
// 只存出門 / 返港時間同目的地機場；航班編號、機型、飛行時數一律唔存。
//
// 規則：
// - 有航線（HKG-LAX）嘅項目 = 飛行；HKG 出發同返 HKG 配對成一段（長途中間過夜冇項目）
// - S 開頭（例如 S1514）= SIM，同飛行一樣當出勤
// - 其他有時間冇航線（AR8、RxT…）= reserve：預設照返屋企食飯，只係顯示
// - 全日項目（O、A、G、NB、JK、L…）= 休息
// - 出勤前後各預 commute 分鐘（預設 90）來回機場

export const DEFAULT_DINNER = '19:30';
export const DEFAULT_COMMUTE = 90;
const MAX_ITEMS = 200;
const KEEP_DAYS = 120; // 舊過呢個數嘅紀錄唔再保留

// 'YYYY-MM-DDTHH:MM'（香港時間）⇄ 毫秒
const HK_OFFSET = 8 * 3600e3;
export const toMs = (s) => Date.parse(`${s}:00+08:00`);
export const fromMs = (ms) => new Date(ms + HK_OFFSET).toISOString().slice(0, 16);

function icsTime(v) {
  // 20260901T033000Z（UTC）或者 20260901T113000（當香港時間）
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return v.endsWith('Z') ? fromMs(Date.UTC(+y, +mo - 1, +d, +h, +mi)) : `${y}-${mo}-${d}T${h}:${mi}`;
}
const icsDate = (v) => (/^(\d{4})(\d{2})(\d{2})/.exec(v) || []).slice(1).join('-') || null;

// 讀 .ics → { from, to, trips: [{ s, e|null, d, k: 'flight'|'sim' }], reserves: [{ s, e, c }], returns: [{ e }] }
// returns = 檔案開頭冇出發嘅回程（上個月出發）；e = null = 月尾出發、回程喺下個月
export function parseRoster(text) {
  const src = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '');
  if (!/BEGIN:VCALENDAR/.test(src)) throw new Error('not an ics file');
  const events = src
    .split('BEGIN:VEVENT')
    .slice(1)
    .map((b) => {
      const get = (k) => (new RegExp(`^${k}(?:;[^:\\n]*)?:(.*)$`, 'm').exec(b) || [])[1]?.trim() || '';
      return { sum: get('SUMMARY'), start: get('DTSTART'), end: get('DTEND') };
    })
    .filter((e) => e.start);

  let from = null;
  let to = null;
  const span = (a, b) => {
    if (a && (!from || a < from)) from = a;
    if (b && (!to || b > to)) to = b;
  };
  const trips = [];
  const reserves = [];
  const returns = [];
  let out = null;

  const timed = events
    .filter((e) => e.start.includes('T'))
    .map((e) => ({ ...e, s: icsTime(e.start), e: icsTime(e.end) || icsTime(e.start) }))
    .filter((e) => e.s)
    .sort((a, b) => a.s.localeCompare(b.s));
  // 範圍 = 檔案涵蓋嘅日子（全日項目計到最後一日；有時間嘅計開始嗰日，回程落地喺下個月唔會食咗下個月）
  for (const e of events.filter((x) => !x.start.includes('T'))) {
    const endMs = Date.parse(`${icsDate(e.end || e.start)}T00:00:00Z`) - 86400e3;
    const last = new Date(endMs).toISOString().slice(0, 10);
    span(icsDate(e.start), last > icsDate(e.start) ? last : icsDate(e.start));
  }

  for (const ev of timed) {
    span(ev.s.slice(0, 10), ev.s.slice(0, 10));
    const legs = [...ev.sum.matchAll(/\b([A-Z]{3})-([A-Z]{3})\b/g)].map((m) => [m[1], m[2]]);
    const code = (ev.sum.replace(/^\d{2}-[A-Za-z]{3}\s+/, '').split(/\s+/)[0] || '').toUpperCase();
    if (!legs.length) {
      if (/^S\d/.test(code)) trips.push({ s: ev.s, e: ev.e, d: '', k: 'sim' });
      else reserves.push({ s: ev.s, e: ev.e, c: code.slice(0, 10) });
      continue;
    }
    const origin = legs[0][0];
    const dest = legs.at(-1)[1];
    if (origin === 'HKG' && dest === 'HKG') {
      trips.push({ s: ev.s, e: ev.e, d: legs[0][1], k: 'flight' });
    } else if (origin === 'HKG') {
      if (out) trips.push({ ...out, e: null }); // 冇回程（唔應該發生）：當未知
      out = { s: ev.s, d: dest, k: 'flight' };
    } else if (dest === 'HKG') {
      if (out) {
        trips.push({ ...out, e: ev.e });
        out = null;
      } else returns.push({ e: ev.e, d: origin });
    }
    // 外站之間嘅航段（例如 LAX-JFK）：仲喺外面，唔使理
  }
  if (out) trips.push({ ...out, e: null });
  return { from, to, trips, reserves, returns };
}

// 再匯入：新檔案覆蓋返佢嗰段日子；上個月出發未有回程嘅，用今次檔案開頭嘅回程補返
export function mergeRoster(old, parsed, today) {
  const from = parsed.from;
  const to = parsed.to;
  const inRange = (s) => s.slice(0, 10) >= from && s.slice(0, 10) <= to;
  const cutoff = today ? fromMs(toMs(`${today}T00:00`) - KEEP_DAYS * 86400e3) : '';
  const returns = [...parsed.returns];
  const trips = [];
  for (const t of old?.trips || []) {
    if (inRange(t.s)) continue;
    if (!t.e && t.s.slice(0, 10) < from && returns.length) {
      trips.push({ ...t, e: returns.shift().e });
      continue;
    }
    trips.push(t);
  }
  trips.push(...parsed.trips);
  const reserves = [...(old?.reserves || []).filter((r) => !inRange(r.s)), ...parsed.reserves];
  const keep = (x) => (x.e || '9999') >= cutoff;
  const byStart = (a, b) => a.s.localeCompare(b.s);
  return {
    trips: trips.filter(keep).sort(byStart).slice(-MAX_ITEMS),
    reserves: reserves.filter(keep).sort(byStart).slice(-MAX_ITEMS),
    from: old?.from && old.from < from ? old.from : from,
    to: old?.to && old.to > to ? old.to : to,
  };
}

const settings = (r) => ({
  dinner: /^\d{2}:\d{2}$/.test(r?.dinner || '') ? r.dinner : DEFAULT_DINNER,
  commute: Number.isInteger(r?.commute) ? r.commute : DEFAULT_COMMUTE,
});

// 某晚食飯時間佢喺唔喺外面（出勤前 commute 分鐘出門，收工後 commute 分鐘返到屋企）→ trip 或 null
export function awayAtDinner(roster, date) {
  if (!roster?.trips?.length) return null;
  const { dinner, commute } = settings(roster);
  const at = toMs(`${date}T${dinner}`);
  const pad = commute * 60e3;
  return roster.trips.find((t) => toMs(t.s) - pad <= at && (t.e == null || at <= toMs(t.e) + pad)) || null;
}

// 📅 日曆用：某日同 roster 有關嘅嘢
// [{ kind: 'leave'|'away'|'back'|'turn'|'sim'|'reserve', trip|reserve, s, e }]
export function rosterDay(roster, date) {
  if (!roster) return [];
  const out = [];
  for (const t of roster.trips || []) {
    const sd = t.s.slice(0, 10);
    const ed = t.e ? t.e.slice(0, 10) : null;
    if (t.k === 'sim') {
      if (sd === date) out.push({ kind: 'sim', trip: t });
    } else if (sd === date && ed === date) out.push({ kind: 'turn', trip: t });
    else if (sd === date) out.push({ kind: 'leave', trip: t });
    else if (ed === date) out.push({ kind: 'back', trip: t });
    else if (sd < date && (ed == null || ed > date)) out.push({ kind: 'away', trip: t });
  }
  for (const r of roster.reserves || []) if (r.s.slice(0, 10) === date) out.push({ kind: 'reserve', reserve: r });
  return out;
}

// 預計返到屋企時間（收工 + commute）
export const homeBy = (roster, t) => (t?.e ? fromMs(toMs(t.e) + settings(roster).commute * 60e3) : null);
