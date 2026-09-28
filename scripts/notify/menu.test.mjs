import assert from 'node:assert/strict';
import { marketWindow, collectIngredients } from '../../public/menu.js';

// 買餸日：一(1)、三(3)、六(6)
assert.deepEqual(marketWindow('2026-09-28', [1, 3, 6]), { start: '2026-09-28', dates: ['2026-09-28', '2026-09-29'], isMarketDay: true });
assert.equal(marketWindow('2026-09-29', [1, 3, 6]).start, '2026-09-30'); // 星期二 → 下次星期三
assert.deepEqual(marketWindow('2026-10-03', [1, 3, 6]).dates, ['2026-10-03', '2026-10-04']); // 六、日
assert.deepEqual(marketWindow('2026-09-28', []).dates, ['2026-09-28']); // 冇設定 = 每日
assert.equal(marketWindow('2026-09-28', [5]).dates.length, 7); // 一星期一次

const recipes = [
  { id: 'r1', name: '番茄炒蛋', ingredients: [{ name: '番茄', amount: '3個' }, { name: '雞蛋', amount: '4隻' }, { name: '鹽' }] },
  { id: 'r2', name: '蒸水蛋', ingredients: [{ name: '雞蛋', amount: '3隻' }] },
];
const dinners = { '2026-09-28': { dishes: ['r1'] }, '2026-09-29': { dishes: ['r2', 'missing'] } };
const list = collectIngredients(['2026-09-28', '2026-09-29'], dinners, recipes, (d) => (d === '2026-09-28' ? 4 : 5));
assert.deepEqual(list.map((x) => [x.name, x.staple, x.uses.length]), [['番茄', false, 1], ['雞蛋', false, 2], ['鹽', true, 1]]);
assert.equal(list[1].uses[1].people, 5);
console.log('menu.test.mjs: all passed');
