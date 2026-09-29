// ✈️ roster（.ics）自動當唔返食飯；🌴 姐姐放假（.xlsx）日曆紅點；每部機揀分頁
import assert from 'node:assert/strict';
import { createFamily, join, becomeMember, openCalendar, calendarDay, importRosterFile, hk, text, texts, until } from './lib.mjs';
import { makeIcs, makeRosterXlsx, tmpFile } from './fixtures.mjs';

export default async function ({ device }) {
  const pilot = await device('pilot');
  const link = await createFamily(pilot, '爸爸');
  await becomeMember(pilot);
  const siti = await device('siti', { locale: 'id-ID' });
  await join(siti, link, 'Siti');
  await becomeMember(siti, { cook: true });

  // 聽日 11:30 出門去 LAX，後日早上返；大後日 SIM 14:00–20:00；再之後 reserve
  const [d1, d2, d3, d4, d5] = [1, 2, 3, 4, 5].map(hk);
  const ics = tmpFile(
    'roster.ics',
    makeIcs([
      { sum: `X CX 100 HKG-LAX`, s: `${d1}T11:30`, e: `${d1}T23:00` },
      { sum: `X CX 101 LAX-HKG`, s: `${d2}T20:00`, e: `${d3}T06:00` },
      { sum: 'X S1514  MW', s: `${d4}T14:00`, e: `${d4}T20:00` },
      { sum: 'X AR8 ', s: `${d5}T09:10`, e: `${d5}T10:10` },
      { sum: 'X O ', day: hk(0) },
    ]),
  );
  await openCalendar(pilot);
  await importRosterFile(pilot, ics, '#roster-form');
  assert.equal(await pilot.locator('#roster-form input[name="member"]:checked + span').textContent(), '爸爸');
  const preview = await text(pilot, '.roster-away');
  for (const d of [d1, d2, d4]) assert.ok(preview.includes(String(Number(d.slice(8)))), `preview lists ${d}: ${preview}`);
  await pilot.click('#roster-form .btn.primary');
  assert.ok((await calendarDay(pilot, d1)).some((r) => r.includes('爸爸') && r.includes('LAX')));
  assert.ok((await calendarDay(pilot, d3)).some((r) => r.includes('🏠')), 'back home row');
  assert.ok((await calendarDay(pilot, d5)).some((r) => r.includes('⏳')), 'reserve row');
  await pilot.click('[data-close-sheet]');

  // 姐姐嘅食飯頁：聽日爸爸唔返（✈️ LAX）
  await until(async () => (await text(siti, `#dinner .days [data-day="${d1}"]`)).includes('爸爸'), { message: 'dinner shows pilot away tomorrow' });
  assert.match(await text(siti, `#dinner .days [data-day="${d5}"]`), /Semua di rumah/, 'reserve day counts as home');

  // 🌴 姐姐放假（Excel）：聽日同第 5 日；其他字當返工
  const months = [...new Set([0, 5, 20, 35].map((n) => hk(n).slice(0, 7)))];
  const xlsx = tmpFile('helper.xlsx', makeRosterXlsx(months, { [d1]: 'OFF', [d5]: 'off', [d2]: 'Half day' }));
  await openCalendar(pilot);
  await importRosterFile(pilot, xlsx, '#off-form');
  assert.equal(await pilot.locator('#off-form input[name="member"]:checked + span').textContent(), 'Siti', 'defaults to the cook');
  assert.match(await text(pilot, '#off-form'), /Half day/);
  await pilot.click('#off-form .btn.primary');
  await calendarDay(pilot, d1);
  await until(async () => (await pilot.locator(`.cal-sheet [data-day="${d1}"] .cal-dots i.off`).count()) === 1, { message: 'red dot for day off' });
  assert.equal(await pilot.locator(`.cal-sheet [data-day="${d2}"] .cal-dots i.off`).count(), 0);
  assert.ok((await texts(pilot, '.cal-sheet .cal-row')).some((r) => r.includes('🌴 Siti')));
  // 匯入放假日之後，爸爸嘅出勤仲喺度
  assert.ok((await calendarDay(pilot, d1)).some((r) => r.includes('LAX')), 'flight roster kept');
  await pilot.click('[data-close-sheet]');

  // 🗂 每部機揀分頁：淨係食飯 → 冇分頁列，日曆冇家務
  const uncle = await device('uncle', { storage: { 'fsl-tabs': JSON.stringify(['dinner']) } });
  await join(uncle, link, '叔叔');
  assert.equal(await uncle.isVisible('.views'), false, 'tab bar hidden with one tab');
  assert.equal(await uncle.isVisible('#dinner'), true);
}
