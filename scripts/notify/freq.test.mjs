import assert from 'node:assert/strict';
import { topFrequent, freqKey, score } from '../../public/freq.js';

const DAY = 86400000;
const now = Date.UTC(2026, 8, 29);
const docs = [
  { name: '牛奶', count: 10, lastAt: now - 2 * DAY },
  { name: '雞蛋', count: 8, lastAt: now - 1 * DAY },
  { name: '廁紙', count: 12, lastAt: now - 120 * DAY }, // 好耐之前買得多
  { name: '菜心', count: 3, lastAt: now },
  { name: '冬菇', count: 1, lastAt: now }, // 得一次，唔算常買
  { name: '豬肉', count: 6, lastAt: now - 3 * DAY },
];

const top = topFrequent(docs, { now });
assert.deepEqual(top.map((d) => d.name), ['牛奶', '雞蛋', '豬肉', '菜心', '廁紙']);
assert.ok(score(docs[2], now) < score(docs[1], now), 'old purchases count less');

// 已經喺清單（未買）嘅唔建議
assert.deepEqual(topFrequent(docs, { now, exclude: new Set(['牛奶']) }).map((d) => d.name)[0], '雞蛋');
assert.equal(topFrequent(docs, { now, limit: 2 }).length, 2);

assert.equal(freqKey(' Milk '), 'milk');
assert.equal(freqKey('菜心'), encodeURIComponent('菜心'));
assert.equal(freqKey('.'), '_.');

console.log('freq.test.mjs: all passed');
