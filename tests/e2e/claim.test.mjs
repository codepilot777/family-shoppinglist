// 👑 舊家庭升級：未有管理員嗰陣人人用晒；第一部撳「我係管理員」嘅機做管理員，其他機變返預設（購物 + 食飯）
import assert from 'node:assert/strict';
import { createFamily, join, tabsOf, until } from './lib.mjs';

// 直接改 emulator 資料（owner 身份，唔經規則）：模擬未有管理員功能之前開嘅家庭
async function patch(path, fields) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'boolean' ? { booleanValue: v } : { stringValue: v }])) };
  const res = await fetch(`http://127.0.0.1:8085/v1/projects/demo-fsl/databases/(default)/documents/${path}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`patch ${path}: ${res.status} ${await res.text()}`);
}

export default async function ({ device }) {
  const mum = await device('mum');
  const link = await createFamily(mum, '媽媽');
  const fid = await mum.evaluate(() => localStorage.getItem('fsl-family'));
  const siti = await device('siti');
  await join(siti, link, 'Siti');

  // 變返「舊家庭」：冇管理員
  await patch(`families/${fid}`, { hasAdmin: false });
  const devs = await (await fetch(`http://127.0.0.1:8085/v1/projects/demo-fsl/databases/(default)/documents/families/${fid}/devices`, { headers: { Authorization: 'Bearer owner' } })).json();
  for (const d of devs.documents) await patch(d.name.split('/documents/')[1], { role: 'member' });

  // 未有管理員：姐姐都用晒
  await until(async () => (await tabsOf(siti)).length === 5, { message: 'no admin → everyone sees all tabs' });

  // 媽媽撳「我係管理員」
  await mum.click('#settings-btn');
  await mum.click('#open-devices');
  await mum.waitForSelector('.claim-admin');
  await mum.click('.claim-admin');
  await until(async () => (await mum.locator('.device-list .device-access').count()) === 1, { message: 'mum can now edit access' });
  await mum.click('#dialog [data-close]');

  // 姐姐變返預設，亦撳唔到「我係管理員」
  await until(async () => (await tabsOf(siti)).join() === 'shop,dinner', { message: 'siti back to defaults' });
  await siti.click('#settings-btn');
  await siti.click('#open-devices');
  await siti.waitForSelector('.device-list');
  assert.equal(await siti.locator('.claim-admin').count(), 0);
}
