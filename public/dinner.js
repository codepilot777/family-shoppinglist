// 食飯人數計算：預設跟每個成員嘅固定規律（pattern），有 ✈️ roster 就跟 roster，有紀錄就用紀錄。
// 冇用 DOM，app 同通知 script 共用。
import { awayAtDinner, isOff } from './roster.js';

export const CUTOFF_HOUR = 16; // 下晝 4 點截數

// 成員：{ id, name, proxy（由人代填，唔收通知）, eats（計唔計入人數，例如姐姐可以唔計）, pattern: [7 × bool]（0 = 星期日）}
export const defaultPattern = () => [true, true, true, true, true, true, true];

// member.roster（可以冇）：機師 roster，出勤嗰晚自動當唔返
export function attendance(member, date, dinnerDoc, dow) {
  const rec = dinnerDoc?.att?.[member.id];
  const trip = rec ? null : awayAtDinner(member.roster, date);
  const off = !rec && !trip && isOff(member.roster, date); // 🌴 放假日（例如姐姐）：出咗街
  const home = rec ? !!rec.home : trip || off ? false : (member.pattern || defaultPattern())[dow] !== false;
  return {
    roster: trip ? (trip.k === 'sim' ? 'SIM' : trip.d || '✈️') : off ? 'OFF' : '',
    home,
    guests: rec && home ? Math.max(0, Number(rec.guests) || 0) : 0,
    note: rec?.note || '',
    late: !!rec?.late,
    by: rec?.by || '',
    at: rec?.at || null,
    explicit: !!rec,
  };
}

// { total, home: [...], away: [...] }：total = 返屋企嘅成員 + 客人
export function summarize(members, date, dinnerDoc, dow) {
  const rows = members
    .filter((m) => m.eats !== false)
    .map((m) => ({ member: m, ...attendance(m, date, dinnerDoc, dow) }));
  const home = rows.filter((r) => r.home);
  const away = rows.filter((r) => !r.home);
  const total = home.length + home.reduce((n, r) => n + r.guests, 0);
  return { total, home, away, rows };
}

// 喺截數之後先改（同一日 16:00 或之後）
export function isLateChange(date, now) {
  return now.date > date || (now.date === date && now.hour >= CUTOFF_HOUR);
}
