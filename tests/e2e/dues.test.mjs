// 📋 到期：常見項目一撳就開表格、交咗記銀碼（每期紀錄）、復原、自動轉賬唔使撳、
// 一次性做完、自己加類別、日曆見到；冇「到期」分頁嘅屋企人睇唔到
import assert from 'node:assert/strict';
import { createFamily, join, becomeMember, grant, openCalendar, calendarDay, hk, text, texts, until } from './lib.mjs';

const rows = (p) => texts(p, '#dues .due');
const row = async (p, name) => (await rows(p)).find((r) => r.includes(name)) || '';

export default async function ({ device }) {
  const dad = await device('dad');
  const link = await createFamily(dad, '爸爸');
  await becomeMember(dad);
  await dad.click('.views [data-view="dues"]');
  await dad.waitForSelector('#dues .dues-summary');
  assert.match(await text(dad, '#dues'), /未有嘢要記/);

  // 差餉（常見）：每 3 個月，5 日後到期，$2,380，爸爸負責 → 快到期（提前 14 日提）
  await dad.click('#dues [data-preset="差餉"]');
  await dad.waitForSelector('#due-form');
  assert.equal(await dad.inputValue('#due-form [name="name"]'), '差餉');
  assert.equal(await dad.inputValue('#due-form [name="every"]'), '3');
  await dad.fill('#due-form [name="due"]', hk(5));
  await dad.fill('#due-form [name="amount"]', '2380');
  await dad.click('#due-form label:has(input[name="who"]:not([value=""]))');
  await dad.click('#due-form .btn.primary');
  await until(async () => (await row(dad, '差餉')).includes('$2,380'), { message: 'rates row' });
  assert.match(await row(dad, '差餉'), /每 3 個月.*👤 爸爸.*5 日/);
  assert.match(await text(dad, '#dues'), /⏰ 快到期/);

  // 交咗：填今次銀碼 $2,410 → 下一期（3 個月後），再撳復原
  await dad.click('#dues .due:has-text("差餉") .chore-check');
  await dad.waitForSelector('#pay-form');
  await dad.fill('#pay-form [name="amount"]', '2410');
  await dad.click('#pay-form .btn.primary');
  await until(async () => (await row(dad, '差餉')).includes('$2,410'), { message: 'paid amount' });
  assert.match(await text(dad, '#dues'), /之後/);
  await dad.click('#toast button');
  await until(async () => (await row(dad, '差餉')).includes('$2,380'), { message: 'undo payment' });

  // 再交一次（原價）兩次 → 表格見到每期銀碼
  for (const amount of ['2380', '2410']) {
    await dad.click('#dues .due:has-text("差餉") .chore-check');
    await dad.fill('#pay-form [name="amount"]', amount);
    await dad.click('#pay-form .btn.primary');
    await dad.waitForSelector('#dialog[open] #pay-form', { state: 'detached' });
    await dad.waitForTimeout(300);
  }
  await dad.click('#dues .due:has-text("差餉") .toggle');
  await dad.waitForSelector('#due-form .due-history');
  assert.equal(await dad.locator('#due-form .hbar').count(), 2);
  await dad.click('#dialog [data-close]');

  // 電費自動轉賬、過咗期：唔會變紅，自己排去下一期（冇 ✓ 掣）
  await dad.click('#due-add');
  await dad.fill('#due-form [name="name"]', '電費');
  await dad.fill('#due-form [name="every"]', '2');
  await dad.fill('#due-form [name="due"]', hk(-3));
  await dad.click('#due-form label:has(input[name="auto"][value="1"])');
  await dad.click('#due-form .btn.primary');
  await until(async () => (await row(dad, '電費')).includes('⟳'), { message: 'auto row' });
  assert.equal(await dad.locator('#dues .due:has-text("電費") .chore-check').count(), 0);
  assert.equal(await dad.locator('#dues .dues-summary .red').count(), 0, 'auto item never overdue');

  // 自己加類別「車」→ 自動揀埋；加一次性嘅「驗車」，過咗期
  await dad.click('#due-newcat');
  await dad.fill('#cat-form [name="name"]', '車');
  await dad.click('#cat-form .btn.primary');
  await until(async () => (await dad.getAttribute('#dues [aria-pressed="true"]', 'data-filter')) !== 'all', { message: 'new category selected' });
  await dad.click('#due-add');
  await dad.fill('#due-form [name="name"]', '驗車');
  await dad.click('#due-form label:has(input[name="unit"][value="once"])');
  assert.equal(await dad.isDisabled('#due-form [name="every"]'), true);
  await dad.fill('#due-form [name="due"]', hk(-2));
  await dad.click('#due-form .btn.primary');
  await until(async () => (await rows(dad)).length === 1 && (await row(dad, '驗車')).includes('🚗'), { message: 'filtered to car' });
  assert.match(await row(dad, '驗車'), /遲咗 2 日/);
  assert.match(await text(dad, '#dues .dues-summary'), /1\s*過咗期/);

  // 日曆今日見到過咗期嘅驗車
  await openCalendar(dad);
  assert.ok((await calendarDay(dad, hk(0))).some((r) => r.includes('驗車')), 'calendar today lists overdue item');
  await dad.click('[data-close-sheet]');

  // 一次性做完 → ✓ 完成咗
  await dad.click('#dues .due:has-text("驗車") .chore-check');
  await until(async () => /✓ 完成咗/.test(await text(dad, '#dues')), { message: 'once item finished' });
  await dad.click('#dues [data-filter="all"]');
  await until(async () => (await rows(dad)).length === 3, { message: 'all items' });

  // 冇「到期」分頁嘅屋企人：冇呢頁；開咗之後見到（印尼文）
  const siti = await device('siti', { locale: 'id-ID' });
  await join(siti, link, 'Siti');
  assert.equal(await siti.locator('.views [data-view="dues"]').count(), 0);
  await grant(dad, 'Siti', ['shop', 'dinner', 'dues']);
  await until(async () => (await siti.locator('.views [data-view="dues"]').count()) === 1, { message: 'siti gets dues tab' });
  await siti.click('.views [data-view="dues"]');
  await until(async () => (await row(siti, 'Pajak rumah')).includes('$2.410'), { message: 'siti sees rates in Indonesian' });
}
