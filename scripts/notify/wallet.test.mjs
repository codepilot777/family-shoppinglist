import assert from 'node:assert/strict';
import { toCents, balance, monthSummary, lastTopup, toCSV } from '../../public/wallet.js';

assert.equal(toCents('218'), 21800);
assert.equal(toCents('$1,000.5'), 100050);
assert.equal(toCents('12.05'), 1205);
assert.equal(toCents('0.5'), 50);
assert.equal(toCents(''), null);
assert.equal(toCents('1.234'), null);
assert.equal(toCents('abc'), null);

const entries = [
  { type: 'topup', amount: 100000, date: '2026-09-28', by: '太太', createdAt: 1 },
  { type: 'expense', amount: 21800, date: '2026-09-28', place: '街市', by: 'Siti', items: ['菜心', '豬肉'], createdAt: 2 },
  { type: 'expense', amount: 43600, date: '2026-09-29', place: '惠康', by: 'Siti', note: '廁紙, "特價"', receipts: ['p1'], createdAt: 3 },
  // 入錢前對數：應有 $346，實際 $340 → −$6
  { type: 'adjust', amount: -600, expected: 34600, counted: 34000, date: '2026-10-02', by: '爸爸', createdAt: 4 },
  { type: 'topup', amount: 50000, date: '2026-10-02', by: '爸爸', createdAt: 5 },
];

assert.equal(balance(entries), 100000 - 21800 - 43600 - 600 + 50000);
assert.equal(lastTopup(entries).by, '爸爸');

const sep = monthSummary(entries, '2026-09');
assert.deepEqual(sep, { spent: 65400, toppedUp: 100000, adjusted: 0, count: 2, byPlace: { 街市: 21800, 惠康: 43600 } });
assert.equal(monthSummary(entries, '2026-10').adjusted, -600);

const csv = toCSV(entries);
assert.ok(csv.startsWith('﻿date,type,amount_hkd'));
const lines = csv.trim().split('\r\n');
assert.equal(lines.length, 6);
assert.equal(lines[2], '2026-09-28,expense,-218.00,782.00,街市,Siti,菜心、豬肉,,0,,');
assert.ok(lines[3].includes('"廁紙, ""特價"""'), 'quotes and commas are escaped');
assert.ok(lines[4].startsWith('2026-10-02,adjust,-6.00,340.00'));
assert.ok(lines[4].endsWith(',346.00,340.00'));
assert.ok(lines[5].endsWith('840.00,,爸爸,,,0,,'));

console.log('wallet.test.mjs: all passed');
