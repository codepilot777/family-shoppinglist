// 👑 兩級權限：開家庭嘅係管理員；新加入預設購物 + 食飯；管理員即時加減分頁；冇權限連資料都讀唔到
import assert from 'node:assert/strict';
import { createFamily, join, grant, tabsOf, text, until } from './lib.mjs';

export default async function ({ device }) {
  const dad = await device('dad');
  const link = await createFamily(dad, '爸爸');
  assert.deepEqual(await tabsOf(dad), ['shop', 'dinner', 'chores', 'dues', 'wallet'], 'admin sees every tab');

  const siti = await device('siti', { locale: 'id-ID' });
  await join(siti, link, 'Siti');
  assert.deepEqual(await tabsOf(siti), ['shop', 'dinner'], 'new device: shopping + dinner');

  // 屋企人睇唔到改權限 / 移除 / 換代碼
  await siti.click('#settings-btn');
  await siti.click('#open-devices');
  await siti.waitForSelector('.device-list');
  assert.equal(await siti.locator('.device-access, .device-remove').count(), 0);
  assert.equal(await siti.isVisible('#rotate-code'), false);
  await until(async () => /👑/.test(await text(siti, '.device-list')), { message: 'admin listed for member' });
  await siti.click('#dialog [data-close]');

  // 管理員加家務 + 家用 → 姐姐部機即時多咗
  await grant(dad, 'Siti', ['shop', 'dinner', 'chores', 'wallet']);
  await until(async () => (await tabsOf(siti)).length === 4, { message: 'siti gets 4 tabs' });
  await siti.click('.views [data-view="wallet"]');
  await siti.waitForSelector('#w-expense');

  // 拎走家用 → 即時冇咗，返去其他分頁
  await grant(dad, 'Siti', ['shop', 'dinner', 'chores']);
  await until(async () => !(await tabsOf(siti)).includes('wallet'), { message: 'wallet removed live' });
  assert.equal(await siti.isVisible('#wallet'), false);

  // 全部拎走 → 顯示「請管理員開」
  await grant(dad, 'Siti', []);
  await until(async () => await siti.isVisible('#no-access'), { message: 'no-access message' });

  // 升做管理員 → 睇晒，仲可以改權限
  await grant(dad, 'Siti', 'admin');
  await until(async () => (await tabsOf(siti)).length === 5, { message: 'admin sees all' });
  await siti.click('#settings-btn');
  await siti.click('#open-devices');
  await siti.waitForSelector('.device-list .device-access');
  await siti.click('#dialog [data-close]');
}
