// 💰 家用：入錢、記支出（連已買貨品）、入錢前對數、📷 影單 → 未入數嘅單 → 入數
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createFamily, join, grant, text, texts, until } from './lib.mjs';

const IMG = fileURLToPath(new URL('../../public/icons/icon-512.png', import.meta.url));
const balance = (p) => text(p, '.wallet-card .big-count');

export default async function ({ device }) {
  const mum = await device('mum');
  const link = await createFamily(mum, '太太');
  const siti = await device('siti', { locale: 'id-ID', camera: true });
  await join(siti, link, 'Siti');
  await grant(mum, 'Siti', ['shop', 'dinner', 'wallet']);
  await until(async () => (await siti.locator('.views [data-view="wallet"]').count()) === 1, { message: 'siti gets wallet tab' });

  // 姐姐買咗菜心
  await siti.fill('#add-name', '菜心');
  await siti.press('#add-name', 'Enter');
  await siti.click('.item:has-text("choy sum") .toggle');

  // 太太入 $1000
  await mum.click('.views [data-view="wallet"]');
  await mum.click('#w-topup');
  await mum.fill('#topup-form [name="amount"]', '1000');
  await mum.click('#topup-form .btn.primary');
  await until(async () => (await balance(mum)).includes('1,000'), { message: 'balance 1000' });

  // 姐姐記支出：已買嘅菜心自動列出
  await siti.click('.views [data-view="wallet"]');
  await siti.click('#w-expense');
  await siti.waitForSelector('#expense-form');
  assert.deepEqual(await siti.locator('#expense-form [name="items"]').evaluateAll((els) => els.map((e) => e.value)), ['菜心']);
  await siti.fill('#expense-form [name="amount"]', '218.5');
  await siti.click('#expense-form .btn.primary');
  await until(async () => (await balance(mum)).includes('781.5'), { message: 'balance after expense' });

  // 對數：實際得 $780 → 差 −$1.5，之後入 $500
  await mum.click('#w-topup');
  await mum.fill('#topup-form [name="counted"]', '780');
  assert.match(await text(mum, '#diff-line'), /−\$1\.5/);
  assert.ok(await mum.isVisible('#diff-note'));
  await mum.fill('#topup-form [name="amount"]', '500');
  await mum.click('#topup-form .btn.primary');
  await until(async () => (await balance(mum)).includes('1,280'), { message: 'balance after reconcile + top-up' });
  assert.ok((await texts(mum, '.wallet-list .item')).some((r) => r.includes('−$1.50')), 'adjustment entry listed');

  // 📷 影單：由相簿揀一張 → 未入數嘅單 → 填銀碼入數
  await siti.click('#w-snap');
  await siti.waitForSelector('dialog.camera[open]');
  await siti.setInputFiles('#cam-files', IMG);
  await siti.waitForSelector('.cam-strip img');
  await siti.click('#cam-done');
  await siti.waitForSelector('#inbox-form', { timeout: 15000 });
  assert.equal(await siti.locator('.rc-slide').count(), 1);
  await siti.fill('#inbox-form [name="amount"]', '30');
  await siti.click('#inbox-form .btn.primary');
  await until(async () => (await balance(mum)).includes('1,250'), { message: 'balance after inbox expense' });
  await until(async () => (await mum.locator('#w-inbox').count()) === 0, { message: 'inbox emptied' });
  assert.ok((await texts(mum, '.wallet-list .item')).some((r) => r.includes('📷') && r.includes('−$30')), 'expense with receipt photo');
}
