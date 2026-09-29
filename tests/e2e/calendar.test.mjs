// 📅 日曆：一次性事項、🔁 每星期重複、只改呢日、取消呢日、刪除全部；另一部機同步
import assert from 'node:assert/strict';
import { createFamily, join, becomeMember, openCalendar, calendarDay, nextWeekday, until } from './lib.mjs';

const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

export default async function ({ device }) {
  const mum = await device('mum');
  const link = await createFamily(mum, '媽媽');
  await becomeMember(mum);
  const siti = await device('siti', { locale: 'id-ID', translate: 'Jemput anak' });
  await join(siti, link, 'Siti');
  await becomeMember(siti, { cook: true });

  const mon = nextWeekday(1);
  const [tue, wed, thu, sat] = [1, 2, 3, 5].map((n) => addDays(mon, n));

  // 一次性事項
  await openCalendar(mum);
  await calendarDay(mum, thu);
  await mum.click('.cal-sheet [data-add-event]');
  await mum.fill('#event-form [name="title"]', '家長日');
  await mum.fill('#event-form [name="time"]', '19:00');
  await mum.click('#event-form .btn.primary');
  assert.ok((await calendarDay(mum, thu)).some((r) => r.includes('19:00') && r.includes('家長日')));
  assert.ok(!(await calendarDay(mum, addDays(thu, 7))).some((r) => r.includes('家長日')), 'one-off only once');

  // 🔁 逢一至五 15:30 接阿仔（Siti），由下星期一開始
  await calendarDay(mum, mon);
  await mum.click('.cal-sheet [data-add-event]');
  await mum.fill('#event-form [name="title"]', '接阿仔');
  await mum.fill('#event-form [name="time"]', '15:30');
  await mum.click('#event-form label:has(span:text-is("Siti"))');
  for (const d of [1, 2, 3, 4, 5]) await mum.click(`#event-form .repeat-days label:has(input[value="${d}"])`);
  assert.equal(await mum.isVisible('#event-form .until-field'), true);
  await mum.click('#event-form .btn.primary');

  const pickup = async (d) => (await calendarDay(mum, d)).find((r) => r.includes('接阿仔')) || '';
  assert.match(await pickup(mon), /15:30.*👤 Siti.*🔁 一至五/);
  assert.match(await pickup(addDays(mon, 14)), /15:30/, 'repeats in later weeks');
  assert.equal(await pickup(sat), '', 'not on Saturday');
  assert.equal(await pickup(addDays(mon, -7)), '', 'not before the start');

  // 只改呢日：星期三媽媽 15:00 接
  await calendarDay(mum, wed);
  await mum.locator('.cal-sheet .cal-row', { hasText: '接阿仔' }).locator('button').click();
  await mum.click('#occ-day');
  await mum.fill('#occ-form [name="time"]', '15:00');
  await mum.click('#occ-form label:has(span:text-is("媽媽"))');
  await mum.click('#occ-form .btn.primary');
  await until(async () => (await pickup(wed)).includes('15:00'), { message: 'this-day change' });
  assert.match(await pickup(wed), /👤 媽媽.*✏️/);
  assert.match(await pickup(thu), /15:30.*👤 Siti/, 'other days unchanged');

  // 取消呢日：星期二
  await calendarDay(mum, tue);
  await mum.locator('.cal-sheet .cal-row', { hasText: '接阿仔' }).locator('button').click();
  await mum.click('#occ-skip');
  await until(async () => (await pickup(tue)) === '', { message: 'cancelled day' });
  assert.match(await pickup(addDays(tue, 7)), /15:30/, 'next Tuesday still on');

  // 姐姐（印尼文）見到翻譯同改動
  await openCalendar(siti);
  await until(async () => (await calendarDay(siti, wed)).some((r) => r.includes('Jemput anak') && r.includes('15:00')), { message: 'siti sees translated change' });

  // 改全部：時間改 16:00，只改過嘅嗰日保留
  await calendarDay(mum, thu);
  await mum.locator('.cal-sheet .cal-row', { hasText: '接阿仔' }).locator('button').click();
  await mum.click('#occ-all');
  await mum.fill('#event-form [name="time"]', '16:00');
  await mum.click('#event-form .btn.primary');
  await until(async () => (await pickup(thu)).includes('16:00'), { message: 'change all' });
  assert.match(await pickup(wed), /15:00/, 'this-day change survives');
  assert.equal(await pickup(tue), '', 'cancelled day stays cancelled');

  // 刪除全部
  await calendarDay(mum, thu);
  await mum.locator('.cal-sheet .cal-row', { hasText: '接阿仔' }).locator('button').click();
  await mum.click('#occ-all');
  await mum.click('#event-del');
  await mum.click('#dialog #ok');
  await until(async () => (await pickup(addDays(mon, 14))) === '', { message: 'series deleted' });
}
