import assert from 'node:assert/strict';
import { occurrence, nextAfter, nextDue, status, dueToday, validRule } from '../../public/chores.js';

// 月份：31 號遇到短月 clamp，之後返返 31 號
assert.equal(occurrence('2026-01-31', 1, 'month', 1), '2026-02-28');
assert.equal(occurrence('2026-01-31', 1, 'month', 2), '2026-03-31');
assert.equal(occurrence('2027-11-30', 3, 'month', 1), '2028-02-29');
assert.equal(occurrence('2026-09-28', 2, 'week', 1), '2026-10-12');

// 逢星期一（2026-09-28 係星期一）換床單：星期二先做 → 下次都係星期一
const sheets = { start: '2026-09-28', every: 1, unit: 'week', due: '2026-09-28' };
assert.equal(nextDue(sheets, '2026-09-29'), '2026-10-05');
// 提早做（星期日做）→ 下個星期一，唔係聽日
assert.equal(nextDue(sheets, '2026-09-27'), '2026-10-05');
// 過咗好耐先做 → 今日之後嘅下一個星期一
assert.equal(nextDue(sheets, '2026-10-20'), '2026-10-26');
// 當日做
assert.equal(nextDue(sheets, '2026-09-28'), '2026-10-05');

// 大跳：兩年後嘅月份唔會估過頭
for (const [start, every, unit] of [['2026-01-31', 1, 'month'], ['2026-03-15', 3, 'month'], ['2026-01-01', 2, 'day'], ['2026-01-05', 2, 'week']]) {
  for (const after of ['2026-01-01', '2026-06-30', '2027-12-30', '2028-02-28', '2030-07-15']) {
    const n = nextAfter(start, every, unit, after);
    assert.ok(n > after, `${n} > ${after}`);
    // 前一次一定 <= after（即係冇跳過任何一次）
    let k = 0;
    while (occurrence(start, every, unit, k + 1) <= n && occurrence(start, every, unit, k) !== n) k++;
    assert.equal(occurrence(start, every, unit, k), n, `${start} every ${every} ${unit} after ${after}`);
    assert.ok(k === 0 || occurrence(start, every, unit, k - 1) <= after, `no skipped occurrence before ${n}`);
  }
}

// 狀態
const c = (due) => ({ due });
assert.equal(status(c('2026-09-28'), '2026-09-29'), 'overdue');
assert.equal(status(c('2026-09-29'), '2026-09-29'), 'today');
assert.equal(status(c('2026-10-06'), '2026-09-29'), 'soon');
assert.equal(status(c('2026-10-07'), '2026-09-29'), 'later');

assert.deepEqual(
  dueToday([{ name: 'b', due: '2026-09-29' }, { name: 'a', due: '2026-09-20' }, { name: 'c', due: '2026-09-30' }, { name: 'x' }], '2026-09-29').map((x) => x.name),
  ['a', 'b'],
);
assert.ok(validRule(2, 'week') && !validRule(0, 'week') && !validRule(1.5, 'day') && !validRule(1, 'year') && !validRule(100, 'day'));

console.log('chores.test.mjs: all passed');
