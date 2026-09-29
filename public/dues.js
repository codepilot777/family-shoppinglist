// 📋 到期：定期 / 一次性嘅嘢（帳單、證件合約、保養…），冇用 DOM，方便測試。
// 排期同 🧹 家務一樣：以「第一次」日期做錨，交咗 / 做咗就排去下一個錨點日。
// 「年」當 12 個月計；「只一次」做完就完成（closed）。
import { addDays } from './dates.js';
import { nextAfter } from './chores.js';

export const DUE_UNITS = ['week', 'month', 'year', 'once'];
export const WARN_DAYS = [0, 3, 7, 14, 30, 60, 90, 180];

// 內置類別；自己加嘅類別存喺 duecats（id 係 doc ID）
export const DUE_CATS = [
  { id: 'bill', icon: '🧾' },
  { id: 'doc', icon: '📄' },
  { id: 'fix', icon: '🔧' },
];
export const CAT_ICONS = ['🚗', '🐶', '💊', '🏫', '🌱', '💳', '🏠', '🎁', '📦', '⭐'];

// 常見項目：[中文名, 類別, 每幾多, 單位, 幾耐之前提]（翻譯喺 dictionary.js）
export const DUE_PRESETS = [
  ['差餉', 'bill', 3, 'month', 14],
  ['地租', 'bill', 3, 'month', 14],
  ['電費', 'bill', 2, 'month', 7],
  ['水費', 'bill', 4, 'month', 7],
  ['煤氣費', 'bill', 2, 'month', 7],
  ['管理費', 'bill', 1, 'month', 3],
  ['上網費', 'bill', 1, 'month', 3],
  ['家居保險', 'bill', 1, 'year', 30],
  ['姐姐合約續約', 'doc', 2, 'year', 90],
  ['護照到期', 'doc', 10, 'year', 180],
  ['車牌續期', 'doc', 1, 'year', 30],
  ['冷氣清洗', 'fix', 1, 'year', 30],
  ['濾水器換芯', 'fix', 6, 'month', 14],
  ['滅火筒檢查', 'fix', 1, 'year', 30],
];

// 年 → 月；只一次唔會重複
const rule = (every, unit) => (unit === 'year' ? [every * 12, 'month'] : [every, unit]);

export const validDue = (every, unit) => unit === 'once' || (Number.isInteger(every) && every >= 1 && every <= 99 && DUE_UNITS.includes(unit));

// 由 start 起，遲過 after 嘅第一次
export function dueAfter(item, after) {
  const [every, unit] = rule(item.every, item.unit);
  return nextAfter(item.start || item.due, every, unit, after);
}

// 交咗 / 做咗之後下一次：由「今次到期日」同「今日」較遲嗰個之後
export function nextDueDate(item, today) {
  if (item.unit === 'once') return item.due;
  return dueAfter(item, item.due > today ? item.due : today);
}

// 睇到嘅到期日：自動轉賬 / 自動續嘅過咗期就自己轉去下一期（唔使寫返資料庫）
export function effectiveDue(item, today) {
  if (!item.auto || item.unit === 'once' || item.due >= today) return item.due;
  return dueAfter(item, addDays(today, -1));
}

// 'done'（一次性做完）| 'over' 過咗期 | 'soon' 喺提醒期內（連今日）| 'later'
export function dueStatus(item, today) {
  if (item.closed) return 'done';
  const due = effectiveDue(item, today);
  if (due < today) return 'over';
  return due <= addDays(today, Math.max(0, item.warn || 0)) ? 'soon' : 'later';
}

export const daysLeft = (due, today) => Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

// 某日係咪到期日（日曆用）：將來就計排期；自動嘅過去期數都計
export function dueOnDate(item, date, today) {
  if (item.closed || !item.due) return false;
  const due = effectiveDue(item, today);
  if (date === today) return due <= today;
  if (date < today) return item.lastDone === date || (!!item.auto && date >= item.due && isOccurrence(item, date));
  if (date === due) return true;
  return date > due && item.unit !== 'once' && isOccurrence(item, date);
}
const isOccurrence = (item, date) => item.unit !== 'once' && dueAfter(item, addDays(date, -1)) === date;

// 每期銀碼紀錄：[{ d: 日子, a: 仙 }]，淨係留最近 12 期
export const MAX_HISTORY = 12;
export const pushHistory = (history, date, cents) => [...(history || []), { d: date, a: cents }].slice(-MAX_HISTORY);
