// 📅 事項：一次性或者每星期重複（例如逢一至五 3:30 接放學）。冇用 DOM，app 同 NAS 匯出共用。
// 事項：{ title, date（第一次）, time, who, note, repeat: [星期幾 0–6（0 = 星期日）], until: 'YYYY-MM-DD'|'',
//         exc: { 'YYYY-MM-DD': { skip: true } | { time?, who?, note? } } }（某一日取消或者另外安排）
import { weekday } from './dates.js';

export const isRepeating = (e) => Array.isArray(e?.repeat) && e.repeat.length > 0;

// 嗰日有冇（未計「只改呢日」嘅改動）
export function occursOn(e, date) {
  if (!isRepeating(e)) return e.date === date;
  if (date < e.date || (e.until && date > e.until)) return false;
  if (!e.repeat.includes(weekday(date))) return false;
  return !e.exc?.[date]?.skip;
}

// 嗰日實際嘅安排（套用咗「只改呢日」）
export function onDate(e, date) {
  const x = isRepeating(e) ? e.exc?.[date] : null;
  return { ...e, ...(x && !x.skip ? x : {}), occurrence: date, changed: !!(x && !x.skip) };
}

export const eventsOnDate = (events, date) =>
  events
    .filter((e) => occursOn(e, date))
    .map((e) => onDate(e, date))
    .sort((a, b) => (a.time || '').localeCompare(b.time || '') || String(a.title).localeCompare(String(b.title)));

// 「一三五」/「一至五」/「每日」：labels = 星期日至六嘅短名（0–6）
export function repeatLabel(repeat, labels, { everyDay = '', weekdays = '', sep = '' } = {}) {
  const days = [...new Set(repeat || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // 由星期一排
  if (days.length === 7 && everyDay) return everyDay;
  if (weekdays && days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return weekdays;
  return days.map((d) => labels[d]).join(sep);
}

// 清走太舊嘅「只改呢日」紀錄（慳位）
export function pruneExc(exc, before) {
  return Object.fromEntries(Object.entries(exc || {}).filter(([d]) => d >= before));
}
