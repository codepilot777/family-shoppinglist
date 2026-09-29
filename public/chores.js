// 🧹 家務排期：每 N 日 / 星期 / 月。冇用 DOM，app 同 GitHub Actions 通知 script 共用。
// 以「第一次」日期做錨，做完（或者跳過）就排去下一個錨點日，
// 所以「逢星期一換床單」遲咗一日做，下次都仲係星期一。
import { addDays } from './dates.js';

export const UNITS = ['day', 'week', 'month'];
export const MAX_EVERY = 99;

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m：1–12

// 由 start 起計第 k 次（月份會 clamp 去月尾：31 號 → 2 月 28/29 號）
export function occurrence(start, every, unit, k) {
  if (unit === 'month') {
    const [y, m, d] = start.split('-').map(Number);
    const total = m - 1 + every * k;
    const ny = y + Math.floor(total / 12);
    const nm = (total % 12) + 1;
    const nd = Math.min(d, daysInMonth(ny, nm));
    return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
  }
  return addDays(start, every * k * (unit === 'week' ? 7 : 1));
}

// start 之後第一個遲過 after 嘅日子（after 本身唔算）
export function nextAfter(start, every, unit, after) {
  if (start > after) return start;
  const span = every * (unit === 'month' ? 31 : unit === 'week' ? 7 : 1); // 估低少少，之後再逐次加
  const toUTC = (s) => Date.parse(`${s}T00:00:00Z`);
  let k = Math.max(0, Math.floor((toUTC(after) - toUTC(start)) / 86400000 / span) - 1);
  let d = occurrence(start, every, unit, k);
  while (d <= after) d = occurrence(start, every, unit, ++k);
  return d;
}

// 做完 / 跳過：由「今次到期日」同「今日」較遲嗰個之後排下一次
export const nextDue = (chore, today) =>
  nextAfter(chore.start || chore.due, chore.every, chore.unit, chore.due > today ? chore.due : today);

// 'overdue' | 'today' | 'soon'（7 日內）| 'later'
export function status(chore, today) {
  if (chore.due < today) return 'overdue';
  if (chore.due === today) return 'today';
  return chore.due <= addDays(today, 7) ? 'soon' : 'later';
}

export const validRule = (every, unit) => Number.isInteger(every) && every >= 1 && every <= MAX_EVERY && UNITS.includes(unit);

// 今日（連過咗期）要做嘅，最舊嘅排先
export const dueToday = (chores, today) =>
  chores.filter((c) => c.due && c.due <= today).sort((a, b) => a.due.localeCompare(b.due) || String(a.name).localeCompare(String(b.name)));

// 常見家務建議：[中文名, 每幾多, 單位]（翻譯喺 dictionary.js）
export const CHORE_PRESETS = [
  ['換床單', 1, 'week'],
  ['換毛巾', 1, 'week'],
  ['洗廁所', 1, 'week'],
  ['洗地', 2, 'day'],
  ['淋花', 2, 'day'],
  ['抹窗', 2, 'week'],
  ['抹風扇', 1, 'month'],
  ['清雪櫃', 1, 'month'],
  ['洗冷氣隔塵網', 1, 'month'],
  ['洗抽油煙機', 1, 'month'],
  ['洗窗簾', 3, 'month'],
  ['倒回收', 1, 'week'],
];
