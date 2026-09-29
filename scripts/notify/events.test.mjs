import assert from 'node:assert/strict';
import { occursOn, onDate, eventsOnDate, repeatLabel, pruneExc, isRepeating } from '../../public/events.js';

// 一次性
const once = { id: 'a', title: '家長日', date: '2026-10-08', time: '19:00' };
assert.ok(occursOn(once, '2026-10-08') && !occursOn(once, '2026-10-15') && !isRepeating(once));

// 逢一至五 15:30 接放學，由 2026-10-05（一）開始，到 10-30；10-07 取消，10-08 改咗媽媽 15:00 接
const pickup = {
  id: 'p', title: '接阿仔', date: '2026-10-05', time: '15:30', who: 'siti', repeat: [1, 2, 3, 4, 5], until: '2026-10-30',
  exc: { '2026-10-07': { skip: true }, '2026-10-08': { time: '15:00', who: 'mum', note: '早放' } },
};
assert.ok(!occursOn(pickup, '2026-10-02')); // 開始之前
assert.ok(occursOn(pickup, '2026-10-05'));
assert.ok(occursOn(pickup, '2026-10-06'));
assert.ok(!occursOn(pickup, '2026-10-07')); // 取消咗
assert.ok(!occursOn(pickup, '2026-10-10')); // 星期六
assert.ok(occursOn(pickup, '2026-10-30'));
assert.ok(!occursOn(pickup, '2026-11-02')); // 過咗 until
const d8 = onDate(pickup, '2026-10-08');
assert.deepEqual([d8.time, d8.who, d8.note, d8.changed], ['15:00', 'mum', '早放', true]);
const d9 = onDate(pickup, '2026-10-09');
assert.deepEqual([d9.time, d9.who, d9.changed], ['15:30', 'siti', false]);

// 冇 until = 一直重複
assert.ok(occursOn({ ...pickup, until: '' }, '2027-06-07'));

// 排時間；同一日有一次性同重複
assert.deepEqual(
  eventsOnDate([once, pickup, { id: 'swim', title: '游水', date: '2026-10-07', time: '17:00', repeat: [3] }], '2026-10-08').map((e) => `${e.time} ${e.title}`),
  ['15:00 接阿仔', '19:00 家長日'],
);
assert.deepEqual(eventsOnDate([{ id: 'swim', title: '游水', date: '2026-10-07', time: '17:00', repeat: [3] }], '2026-10-14').length, 1);

// 顯示
const zh = ['日', '一', '二', '三', '四', '五', '六'];
assert.equal(repeatLabel([1, 3, 5], zh), '一三五');
assert.equal(repeatLabel([0, 6], zh), '六日');
assert.equal(repeatLabel([5, 1, 2, 3, 4], zh, { weekdays: '一至五' }), '一至五');
assert.equal(repeatLabel([0, 1, 2, 3, 4, 5, 6], zh, { everyDay: '每日' }), '每日');
assert.deepEqual(pruneExc({ '2026-01-01': { skip: true }, '2026-10-08': { time: '15:00' } }, '2026-08-01'), { '2026-10-08': { time: '15:00' } });

console.log('events.test.mjs: all passed');
