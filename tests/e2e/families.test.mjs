// 🏠 一部機幾個家庭：叔叔自己屋企（管理員）+ 返哥哥屋企食飯（淨係食飯）；切換、資料分開、再撳邀請連結直接轉、離開後返自己屋企
import assert from 'node:assert/strict';
import { APP, grant, tabsOf, text, texts, until } from './lib.mjs';

async function create(page, me, family) {
  await page.goto(APP);
  await page.fill('#me', me);
  await page.fill('#family-name', family);
  await page.click('#create');
  await page.waitForSelector('#dialog[open] .code');
  const link = await text(page, '#dialog .code');
  await page.click('#dialog [data-close]');
  return link;
}
const title = (p) => text(p, '#family-title');
const items = (p) => texts(p, '#list .item .name');

export default async function ({ device }) {
  const dad = await device('dad');
  const dadLink = await create(dad, '爸爸', '哥哥屋企');

  const uncle = await device('uncle');
  await create(uncle, '叔叔', '叔叔屋企');
  await uncle.fill('#add-name', '叔叔嘅牙膏');
  await uncle.press('#add-name', 'Enter');
  await until(async () => (await items(uncle)).some((n) => n.includes('叔叔嘅牙膏')), { message: 'own item' });

  // 加入另一個家庭：可以返轉頭
  await uncle.click('#family-switch');
  await uncle.waitForSelector('.family-list');
  assert.equal(await uncle.locator('.family-list [data-fam]').count(), 1);
  await uncle.click('#add-family');
  await uncle.waitForSelector('#setup-back');
  assert.match(await text(uncle, '#setup-back'), /叔叔屋企/);
  await uncle.fill('#code', dadLink);
  await uncle.click('#join');
  await until(async () => (await title(uncle)) === '哥哥屋企', { message: 'joined second family' });
  assert.deepEqual(await tabsOf(uncle), ['shop', 'dinner']);
  assert.ok(!(await items(uncle)).some((n) => n.includes('叔叔嘅牙膏')), 'data kept separate');

  // 哥哥淨係開食飯畀叔叔
  await grant(dad, '叔叔', ['dinner']);
  await until(async () => !(await uncle.isVisible('.views')) && (await uncle.isVisible('#dinner')), { message: 'uncle dinner only' });

  // 轉返自己屋企：全部分頁、自己啲嘢
  await uncle.click('#family-switch');
  assert.equal(await uncle.locator('.family-list [data-fam]').count(), 2);
  await uncle.click('.family-list [data-fam]:not([aria-current="true"])');
  await until(async () => (await title(uncle)) === '叔叔屋企', { message: 'switched back' });
  assert.equal((await tabsOf(uncle)).length, 5, 'admin of own family');
  await uncle.click('.views [data-view="shop"]');
  await until(async () => (await items(uncle)).some((n) => n.includes('叔叔嘅牙膏')), { message: 'own item after switch' });

  // 再撳哥哥嘅邀請連結：已經加入咗 → 直接轉，唔使再填
  await uncle.goto(dadLink);
  await until(async () => (await title(uncle).catch(() => '')) === '哥哥屋企', { message: 'invite link switches' });
  assert.equal(await uncle.locator('#join-invite').count(), 0);

  // 通知連結 ?fam= 開返指定家庭
  const ownId = await uncle.evaluate(() => JSON.parse(localStorage.getItem('fsl-families')).find((f) => f.name === '叔叔屋企').id);
  await uncle.goto(`${APP}?fam=${ownId}&view=dinner`);
  await until(async () => (await title(uncle).catch(() => '')) === '叔叔屋企', { message: 'fam param opens family' });

  // 喺哥哥屋企離開 → 自動返自己屋企
  await uncle.click('#family-switch');
  await uncle.click('.family-list [data-fam]:not([aria-current="true"])');
  await until(async () => (await title(uncle)) === '哥哥屋企', { message: 'in brother family again' });
  await uncle.click('#settings-btn');
  await uncle.click('#leave');
  await uncle.click('#dialog #ok');
  await until(async () => (await title(uncle).catch(() => '')) === '叔叔屋企', { message: 'back to own family after leaving' });
  await uncle.click('#family-switch');
  assert.equal(await uncle.locator('.family-list [data-fam]').count(), 1);
}
