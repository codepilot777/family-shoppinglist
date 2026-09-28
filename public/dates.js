// 日期工具：一律用香港時間，日期用 'YYYY-MM-DD' 字串（亦係 Firestore 食飯紀錄嘅 doc ID）。
// 冇用 DOM，app 同 GitHub Actions 通知 script 共用。

export const TIME_ZONE = 'Asia/Hong_Kong';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// { date: '2026-09-28', hour: 16, minute: 5 }（香港時間）
export function hkNow(now = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

export const hkToday = (now) => hkNow(now).date;

const toUTC = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUTC = (dt) => dt.toISOString().slice(0, 10);

export const addDays = (date, n) => {
  const dt = toUTC(date);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
};

// 0 = 星期日 … 6 = 星期六
export const weekday = (date) => toUTC(date).getUTCDay();

// 下一個星期一（星期日填問卷就係填呢個星期一開始嘅 7 日）
export function nextWeekStart(today) {
  const dow = weekday(today);
  return addDays(today, dow === 0 ? 1 : 8 - dow);
}

export const weekDates = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export function formatDay(date, locale) {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'numeric', day: 'numeric', weekday: 'short' }).format(toUTC(date));
}
