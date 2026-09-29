// 🛒 購物清單：兩部機同步、自動翻譯、剔買咗、⭐ 常買、買嘢模式
import assert from 'node:assert/strict';
import { createFamily, join, text, texts, until } from './lib.mjs';

const add = async (p, name, qty = '') => {
  await p.fill('#add-name', name);
  if (qty) await p.fill('#add-qty', qty);
  await p.press('#add-name', 'Enter');
  await p.waitForTimeout(150);
};

export default async function ({ device }) {
  const mum = await device('mum');
  const link = await createFamily(mum, '媽媽');
  const siti = await device('siti', { locale: 'id-ID' });
  await join(siti, link, 'Siti');

  // 媽媽加，姐姐見到印尼文
  await add(mum, '牛奶', '2');
  await add(mum, '菜心');
  await until(async () => (await siti.locator('.item .name').count()) === 2, { message: 'siti sees 2 items' });
  const names = await texts(siti, '.item .name');
  assert.ok(names.includes('susu'), `translated milk: ${names}`);
  assert.ok(names.some((n) => n.includes('sawi hijau')), `translated choy sum: ${names}`);
  assert.match(await text(siti, '.item:has-text("susu") .meta'), /媽媽/);

  // 姐姐剔買咗 → 媽媽見到「已買」
  await siti.click('.item:has-text("susu") .toggle');
  await until(async () => (await mum.locator('.item.done:has-text("牛奶")').count()) === 1, { message: 'mum sees milk done' });

  // ⭐ 常買：加兩次先出
  await mum.click('.item:has-text("菜心") .toggle');
  await add(mum, '牛奶');
  await mum.click('.item:not(.done):has-text("牛奶") .toggle');
  await until(async () => (await mum.locator('#freq [data-freq="牛奶"]').count()) === 1, { message: 'milk becomes a frequent chip' });
  await mum.click('#freq [data-freq="牛奶"]');
  await until(async () => (await mum.locator('.item:not(.done):has-text("牛奶")').count()) === 1, { message: 'chip re-adds milk' });

  // 🛒 買嘢模式：收埋其他嘢、頂部顯示進度、唔顯示「邊個加」
  await mum.click('#shop-start');
  assert.ok(await mum.evaluate(() => document.body.classList.contains('shopping-mode')));
  assert.deepEqual(await mum.evaluate(() => window.__wake), ['screen']);
  for (const sel of ['.topbar', '.views', '#tabs', '.addbar']) assert.equal(await mum.isVisible(sel), false, `${sel} hidden while shopping`);
  assert.match(await text(mum, '#shop-title'), /剔咗 \d+ \/ \d+/);
  assert.equal(await mum.locator('.item:not(.done) .meta:has-text("加")').count(), 0, 'no "added by" while shopping');
  await mum.click('.item:not(.done):has-text("牛奶") .toggle');
  await mum.click('#shop-start');
  await mum.waitForSelector('#record-now');
  assert.match(await text(mum, '#dialog h2'), /[1-9] 樣/);
  assert.equal(await mum.isVisible('.topbar'), true);
}
