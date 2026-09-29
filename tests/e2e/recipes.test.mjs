// 🍽 菜式：兩部機同時「加入常見菜式」唔會重複；重複菜式一撳合併，未來菜單跟住改
import assert from 'node:assert/strict';
import { createFamily, join, becomeMember, hk, text, until } from './lib.mjs';

const openLibrary = async (p) => {
  if (await p.isVisible('#dialog[open] [data-close]')) await p.click('#dialog [data-close]');
  await p.click('#open-recipes');
  await p.waitForSelector('#dialog[open] h2');
};
const count = (p, name) => p.locator(`#dialog .recipe-list .item${name ? `:has-text("${name}")` : ''}`).count();

export default async function ({ device }) {
  const mum = await device('mum');
  const link = await createFamily(mum, '媽媽');
  await becomeMember(mum);
  const dad = await device('dad');
  await join(dad, link, '爸爸');
  await becomeMember(dad);

  await openLibrary(mum);
  await openLibrary(dad);
  await Promise.all([mum.click('#recipes-seed'), dad.click('#recipes-seed')]);
  await until(async () => (await openLibrary(mum), (await count(mum)) === 20), { message: '20 recipes' });
  await mum.waitForTimeout(800);
  await openLibrary(mum);
  assert.equal(await count(mum), 20, 'no duplicates after concurrent seeding');
  assert.equal(await mum.locator('[data-merge-dups]').count(), 0);

  // 同一個菜加 3 次（以前可能出現嘅重複）
  for (let i = 0; i < 3; i++) {
    await mum.click('#recipes-new');
    await mum.fill('#recipe-form [name="name"]', '白灼蝦');
    await mum.fill('#recipe-form .ing-row [name="ing-name"]', '蝦');
    await mum.click('#recipe-form .btn.primary');
    await mum.waitForTimeout(250);
    await openLibrary(mum);
  }
  assert.equal(await count(mum, '白灼蝦'), 3);
  assert.match(await text(mum, '[data-merge-dups]'), /2/);
  await mum.click('#dialog [data-close]');

  // 聽日揀咗第三個
  const tomorrow = hk(1);
  await mum.click(`#dinner [data-menu="${tomorrow}"]`);
  await mum.locator('#menu-form .dish-row:has-text("白灼蝦") input').nth(2).check();
  await mum.click('#menu-form .btn.primary');

  await openLibrary(dad);
  await until(async () => (await dad.locator('[data-merge-dups]').count()) === 1, { message: 'dad sees merge button' });
  await dad.click('[data-merge-dups]');
  await until(async () => (await openLibrary(dad), (await count(dad, '白灼蝦')) === 1), { message: 'merged' });
  await until(async () => (await text(mum, `#dinner .days [data-day="${tomorrow}"] .dishes-meta`)).includes('白灼蝦'), { message: 'menu repointed' });
}
