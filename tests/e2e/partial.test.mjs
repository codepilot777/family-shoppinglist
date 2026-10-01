// 🛒 買咗一部分：8件淨係買到 5件 → 兩部機都見到「仲差 3件」；復原；再買夠就自動當買晒；
// 數量唔係數字就冇呢個掣；記支出會列埋買咗一部分嘅嘢
import assert from 'node:assert/strict';
import { createFamily, join, grant, text, until } from './lib.mjs';

const add = async (p, name, qty = '') => {
  await p.fill('#add-name', name);
  if (qty) await p.fill('#add-qty', qty);
  await p.press('#add-name', 'Enter');
  await p.waitForTimeout(150);
};
const row = (p, name) => p.locator('.item', { hasText: name });

export default async function ({ device }) {
  const mum = await device('mum');
  const link = await createFamily(mum, '媽媽');
  const siti = await device('siti', { locale: 'id-ID' });
  await join(siti, link, 'Siti');
  await grant(mum, 'Siti', ['shop', 'dinner', 'wallet']);

  await add(mum, '雞蛋', '8件');
  await add(mum, '米', '一大包');
  await until(async () => (await siti.locator('.item').count()) === 2, { message: 'siti sees items' });
  assert.equal(await row(siti, 'beras').locator('.qty-btn').count(), 0, 'non-numeric qty has no partial button');
  assert.equal(await text(siti, '.item:has-text("telur") .qty-btn'), '8件');

  // 姐姐買到 5件
  await row(siti, 'telur').locator('.qty-btn').click();
  await siti.waitForSelector('#dialog[open] #partial-form');
  await siti.fill('#partial-form [name="got"]', '5');
  await siti.click('#partial-form .btn.primary');
  await until(async () => (await text(mum, '.item:has-text("雞蛋") .qty-btn')) === '仲差 3件', { message: 'mum sees 3 left' });
  assert.match(await text(mum, '.item:has-text("雞蛋") .meta'), /買咗 5件 Siti/);
  assert.equal(await mum.locator('.item.partial:has-text("雞蛋") .got-bar').count(), 1);
  assert.equal(await mum.locator('.item.done:has-text("雞蛋")').count(), 0, 'still on the to-buy list');

  // 復原
  await siti.click('#toast button');
  await until(async () => (await text(mum, '.item:has-text("雞蛋") .qty-btn')) === '8件', { message: 'undo partial' });

  // 再記 5件，用 ＋ 加到 8 → 買晒
  await row(siti, 'telur').locator('.qty-btn').click();
  await siti.fill('#partial-form [name="got"]', '5');
  await siti.click('#partial-form .btn.primary');
  await until(async () => (await text(siti, '.item:has-text("telur") .qty-btn')) === 'kurang 3件', { message: 'siti sees 3 left (id)' });

  // 記支出：買咗一部分嘅雞蛋都列出
  await siti.click('.views [data-view="wallet"]');
  await siti.click('#w-expense');
  await siti.waitForSelector('#expense-form');
  assert.deepEqual(await siti.locator('#expense-form [name="items"]').evaluateAll((els) => els.map((e) => e.value)), ['雞蛋']);
  await siti.click('#dialog [data-close]');
  await siti.click('.views [data-view="shop"]');

  await row(siti, 'telur').locator('.qty-btn').click();
  for (let i = 0; i < 3; i++) await siti.click('#partial-form [data-step="1"]');
  assert.equal(await siti.inputValue('#partial-form [name="got"]'), '8');
  await siti.click('#partial-form .btn.primary');
  await until(async () => (await mum.locator('.item.done:has-text("雞蛋")').count()) === 1, { message: 'all bought → done' });

  // 剔返未買：重新計
  await mum.click('.item.done:has-text("雞蛋") .toggle');
  await until(async () => (await text(mum, '.item:has-text("雞蛋") .qty-btn')) === '8件', { message: 'unticked resets count' });
}
