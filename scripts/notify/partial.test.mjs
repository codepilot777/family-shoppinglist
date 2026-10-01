import assert from 'node:assert/strict';
import { parseQty, partialPatch, progress, amount } from '../../public/partial.js';

assert.deepEqual(parseQty('8件'), { n: 8, unit: '件' });
assert.deepEqual(parseQty(' 8 '), { n: 8, unit: '' });
assert.deepEqual(parseQty('1.5斤'), { n: 1.5, unit: '斤' });
assert.deepEqual(parseQty('6 packs'), { n: 6, unit: 'packs' });
assert.equal(parseQty('一大包'), null);
assert.equal(parseQty('0'), null);
assert.equal(parseQty(''), null);
assert.equal(amount(3, '件'), '3件');
assert.equal(amount(2, 'packs'), '2 packs');
assert.equal(amount(0.5, '斤'), '0.5斤');

const item = { qty: '8件', done: false };
assert.deepEqual(partialPatch(item, 5, 'Siti'), { got: 5, gotBy: 'Siti' });
assert.deepEqual(partialPatch(item, 8, 'Siti'), { done: true, doneBy: 'Siti', got: 0, gotBy: '' });
assert.deepEqual(partialPatch(item, 10, 'Siti'), { done: true, doneBy: 'Siti', got: 0, gotBy: '' });
assert.deepEqual(partialPatch(item, 0, 'Siti'), { got: 0, gotBy: '' });
assert.deepEqual(partialPatch({ qty: '一大包' }, 3, 'Siti'), { got: 0, gotBy: '' });

assert.deepEqual(progress({ ...item, got: 5 }), { got: 5, left: 3, n: 8, unit: '件' });
assert.equal(progress({ ...item, got: 0 }), null);
assert.equal(progress({ ...item, got: 5, done: true }), null);
assert.equal(progress({ ...item, qty: '3件', got: 5 }), null, 'qty lowered below got');

console.log('partial.test.mjs: all passed');
