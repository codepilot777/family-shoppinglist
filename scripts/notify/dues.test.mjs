import assert from 'node:assert/strict';
import { validDue, nextDueDate, effectiveDue, dueStatus, dueOnDate, daysLeft, pushHistory, DUE_PRESETS } from '../../public/dues.js';
import { DICT_INDEX } from '../../public/dictionary.js';

// 每季差餉：交遲咗都係排返季尾嗰日；提早交 → 下一季
const rates = { start: '2026-01-31', due: '2026-04-30', every: 3, unit: 'month', warn: 14 };
assert.equal(nextDueDate(rates, '2026-05-03'), '2026-07-31');
assert.equal(nextDueDate(rates, '2026-04-20'), '2026-07-31');

// 年 = 12 個月；29/2 → 下年 28/2
const insurance = { start: '2028-02-29', due: '2028-02-29', every: 1, unit: 'year', warn: 30 };
assert.equal(nextDueDate(insurance, '2028-02-20'), '2029-02-28');
assert.equal(nextDueDate({ ...insurance, every: 2 }, '2028-02-29'), '2030-02-28');

// 狀態：過咗期 / 提醒期內（連今日）/ 之後
assert.equal(dueStatus(rates, '2026-05-01'), 'over');
assert.equal(dueStatus(rates, '2026-04-16'), 'soon');
assert.equal(dueStatus(rates, '2026-04-15'), 'later');
assert.equal(dueStatus({ ...rates, warn: 0 }, '2026-04-30'), 'soon');
assert.equal(dueStatus({ ...rates, closed: true }, '2026-05-01'), 'done');

// 自動轉賬：過咗期就自己轉下一期，唔會變紅
const power = { start: '2026-01-10', due: '2026-03-10', every: 2, unit: 'month', warn: 7, auto: true };
assert.equal(effectiveDue(power, '2026-03-10'), '2026-03-10');
assert.equal(effectiveDue(power, '2026-03-11'), '2026-05-10');
assert.equal(effectiveDue(power, '2026-09-29'), '2026-11-10');
assert.equal(dueStatus(power, '2026-09-29'), 'later');
assert.equal(effectiveDue({ ...power, auto: false }, '2026-09-29'), '2026-03-10');

// 只一次：唔會重複；做完就 done
const passport = { start: '2030-05-01', due: '2030-05-01', every: 1, unit: 'once', warn: 180 };
assert.equal(nextDueDate(passport, '2030-05-02'), '2030-05-01');
assert.equal(dueStatus(passport, '2029-11-02'), 'soon');
assert.equal(dueOnDate(passport, '2031-05-01', '2026-01-01'), false);
assert.equal(dueOnDate(passport, '2030-05-01', '2026-01-01'), true);

// 日曆：將來嘅期數、今日連過咗期、過去做咗嗰日、自動嘅過去期數
assert.equal(dueOnDate(rates, '2026-07-31', '2026-04-01'), true);
assert.equal(dueOnDate(rates, '2026-07-30', '2026-04-01'), false);
assert.equal(dueOnDate(rates, '2026-05-05', '2026-05-05'), true, 'overdue shows today');
assert.equal(dueOnDate({ ...rates, lastDone: '2026-02-01' }, '2026-02-01', '2026-04-01'), true);
assert.equal(dueOnDate(power, '2026-07-10', '2026-09-29'), true, 'auto past occurrence');
assert.equal(dueOnDate(power, '2026-01-10', '2026-09-29'), false, 'before current due');

assert.equal(daysLeft('2026-10-01', '2026-09-29'), 2);
assert.equal(daysLeft('2026-09-20', '2026-09-29'), -9);

assert.ok(validDue(3, 'month') && validDue(1, 'once') && validDue(10, 'year'));
assert.ok(!validDue(0, 'month') && !validDue(100, 'week') && !validDue(1, 'day') && !validDue(1.5, 'year'));

// 每期紀錄最多 12 期
let h = [];
for (let i = 1; i <= 14; i++) h = pushHistory(h, `2026-01-${String(i).padStart(2, '0')}`, i * 100);
assert.equal(h.length, 12);
assert.deepEqual(h[0], { d: '2026-01-03', a: 300 });

// 常見項目都有英文同印尼文
for (const [zh] of DUE_PRESETS) assert.ok(DICT_INDEX.get(zh)?.id, `translation for ${zh}`);

console.log('dues ok');
