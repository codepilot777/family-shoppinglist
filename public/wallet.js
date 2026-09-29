// 💰 買餸錢包計數（冇 DOM，app、通知同 NAS 匯出 script 共用）。
// 銀碼一律用「仙」做整數（$12.50 = 1250），避免小數計錯。
//
// 每筆紀錄：{ type: 'topup' | 'expense' | 'adjust', amount: 仙（adjust 可正可負）, date: 'YYYY-MM-DD',
//            by, place, note, items: [貨品名], receipts: [相片ID], expected, counted, createdAt }
//  - topup   入錢
//  - expense 支出
//  - adjust  對數差額（入錢前數錢包：實際 − 應有）

export const DEFAULT_LOW = 20000; // 低過 $200 提醒

export function toCents(input) {
  const s = String(input ?? '').replace(/[^\d.]/g, '');
  if (!s || !/^\d*(\.\d{0,2})?$/.test(s)) return null;
  const [dollars, cents = ''] = s.split('.');
  return Number(dollars || 0) * 100 + Number(cents.padEnd(2, '0') || 0);
}

export const signed = (e) => (e.type === 'expense' ? -Math.abs(e.amount) : e.type === 'topup' ? Math.abs(e.amount) : e.amount);

export function balance(entries) {
  return entries.reduce((sum, e) => sum + (Number.isFinite(e.amount) ? signed(e) : 0), 0);
}

// 由新到舊（同一刻寫入嘅：對數差額 → 入錢 → 支出）
const RANK = { adjust: 0, topup: 1, expense: 2 };
export const byNewest = (a, b) =>
  (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0) || (RANK[b.type] ?? 3) - (RANK[a.type] ?? 3);

// 'YYYY-MM' 嗰個月：支出總數、按地方分、入錢總數、對數差額
export function monthSummary(entries, month) {
  const inMonth = entries.filter((e) => (e.date || '').startsWith(month));
  const spent = inMonth.filter((e) => e.type === 'expense').reduce((s, e) => s + Math.abs(e.amount), 0);
  const toppedUp = inMonth.filter((e) => e.type === 'topup').reduce((s, e) => s + Math.abs(e.amount), 0);
  const adjusted = inMonth.filter((e) => e.type === 'adjust').reduce((s, e) => s + e.amount, 0);
  const byPlace = {};
  for (const e of inMonth.filter((x) => x.type === 'expense')) {
    const p = e.place || '—';
    byPlace[p] = (byPlace[p] || 0) + Math.abs(e.amount);
  }
  return { spent, toppedUp, adjusted, count: inMonth.filter((e) => e.type === 'expense').length, byPlace };
}

export const lastTopup = (entries) => [...entries].filter((e) => e.type === 'topup').sort(byNewest)[0] || null;

// CSV（Excel 開得，UTF-8 BOM 令中文唔會變亂碼）
const HEAD = ['date', 'type', 'amount_hkd', 'balance_after_hkd', 'place', 'by', 'items', 'note', 'receipts', 'expected_hkd', 'counted_hkd'];
const money = (c) => (c == null ? '' : (c / 100).toFixed(2));
const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(entries) {
  const asc = [...entries].sort((a, b) => byNewest(b, a));
  let running = 0;
  const rows = asc.map((e) => {
    running += signed(e);
    return [
      e.date,
      e.type,
      money(signed(e)),
      money(running),
      e.place || '',
      e.by || '',
      (e.items || []).join('、'),
      e.note || '',
      (e.receipts || []).length,
      e.type === 'adjust' ? money(e.expected) : '',
      e.type === 'adjust' ? money(e.counted) : '',
    ]
      .map(cell)
      .join(',');
  });
  return '﻿' + [HEAD.join(','), ...rows].join('\r\n') + '\r\n';
}
