// 🧹 家務：建議一撳就加（自動揀負責煮飯嘅人）、做咗 / 復原、我嘅、兩部機同步
import assert from 'node:assert/strict';
import { createFamily, join, becomeMember, texts, until } from './lib.mjs';

export default async function ({ device }) {
  const mum = await device('mum');
  const link = await createFamily(mum, '媽媽');
  await becomeMember(mum);
  const siti = await device('siti', { locale: 'id-ID' });
  await join(siti, link, 'Siti');
  await becomeMember(siti, { cook: true });

  await siti.click('.views [data-view="chores"]');
  await siti.waitForSelector('#chores [data-preset="換床單"]');
  await siti.click('#chores [data-preset="換床單"]');
  await siti.waitForSelector('#chores .chore');
  const row = (await texts(siti, '#chores .chore'))[0];
  assert.match(row, /Ganti seprai/);
  assert.match(row, /👤 Siti/, 'assigned to the cook by default');

  // 媽媽見到（中文）
  await mum.click('.views [data-view="chores"]');
  await until(async () => (await texts(mum, '#chores .chore')).some((r) => r.includes('換床單')), { message: 'mum sees chore' });

  // 做咗 → 下星期；復原
  await siti.click('#chores .chore .chore-check');
  await until(async () => (await texts(siti, '#chores .chore'))[0].includes('terakhir'), { message: 'done updates row' });
  await siti.click('#toast button');
  await until(async () => !(await texts(siti, '#chores .chore'))[0].includes('terakhir'), { message: 'undo' });

  // 我嘅：媽媽冇家務
  await mum.click('#chores .chores-filter label:has(input[value="mine"])');
  assert.equal(await mum.locator('#chores .chore').count(), 0);
  await mum.click('#chores .chores-filter label:has(input[value="all"])');
  assert.equal(await mum.locator('#chores .chore').count(), 1);
}
