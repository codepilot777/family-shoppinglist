import assert from 'node:assert/strict';
import { buildMessages } from './messages.mjs';

const members = [
  { id: 'dad', name: '爸爸', pattern: [true, true, true, true, true, true, true] },
  { id: 'son', name: '阿仔', pattern: [true, true, false, true, true, true, true], lastConfirmedWeek: '2026-09-28' },
  { id: 'gran', name: '婆婆', proxy: true },
  { id: 'siti', name: 'Siti', eats: false },
];
const devices = [
  { key: 'k1', token: 't1', memberId: 'dad', lang: 'zh' },
  { key: 'k2', token: 't2', memberId: 'son', lang: 'en' },
  { key: 'k3', token: 't3', memberId: 'siti', lang: 'id' },
  { key: 'k4', token: 't4', memberId: 'gone', lang: 'zh' },
];
const appUrl = 'https://x.github.io/app/';

// 星期日 20:00：阿仔已經填咗，只發俾爸爸
let msgs = buildMessages({ mode: 'weekly', today: '2026-09-27', members, dinners: {}, devices, appUrl });
assert.deepEqual(msgs.map((m) => m.key), ['k1']);
assert.match(msgs[0].data.url, /week=1&m=dad/);

// 星期二 08:00：阿仔固定唔返、爸爸帶 2 位客
const dinners = { '2026-09-29': { att: { dad: { home: true, guests: 2 } } } };
msgs = buildMessages({ mode: 'daily', today: '2026-09-29', members, dinners, devices, appUrl });
assert.deepEqual(msgs.map((m) => m.key), ['k1', 'k2', 'k3']);
const son = msgs.find((m) => m.key === 'k2');
assert.match(son.data.body, /out/);
assert.match(JSON.parse(son.data.actions)[0].url, /set=home&date=2026-09-29&m=son/);
const cook = msgs.find((m) => m.key === 'k3');
assert.equal(cook.data.title, '🍚 Malam ini sementara 4 orang'); // 爸爸 + 2 客 + 婆婆（阿仔唔返，Siti 唔計）
assert.match(cook.data.body, /阿仔/);
assert.doesNotMatch(cook.data.body, /🧺/); // 冇設定買餸日 → 唔提

// 買餸日（星期二）：提負責煮飯嘅人今日要買幾多樣（唔計常備）
const recipes = [{ id: 'r1', name: '番茄炒蛋', ingredients: [{ name: '番茄' }, { name: '雞蛋' }, { name: '鹽', staple: true }] }];
const withMenu = { ...dinners, '2026-09-29': { ...dinners['2026-09-29'], dishes: ['r1'] } };
msgs = buildMessages({ mode: 'daily', today: '2026-09-29', members, dinners: withMenu, devices, appUrl, marketDays: [2, 5], recipes });
assert.match(msgs.find((m) => m.key === 'k3').data.body, /Hari belanja: 2 bahan/);
msgs = buildMessages({ mode: 'daily', today: '2026-09-29', members, dinners: withMenu, devices, appUrl, marketDays: [3], recipes });
assert.doesNotMatch(msgs.find((m) => m.key === 'k3').data.body, /🧺/); // 今日唔係買餸日

// 16:05 截數：只發俾負責煮飯嘅人
msgs = buildMessages({ mode: 'cutoff', today: '2026-09-29', members, dinners, devices, appUrl });
assert.deepEqual(msgs.map((m) => m.key), ['k3']);
assert.ok(Object.values(msgs[0].data).every((v) => typeof v === 'string'), 'FCM data values must be strings');

// 錢包低過提醒：只發俾食飯成員（俾錢嗰啲），唔發俾負責煮飯嘅人
msgs = buildMessages({ mode: 'daily', today: '2026-09-29', members, dinners, devices, appUrl, wallet: { balance: 15050, low: 20000 } });
const lowMsgs = msgs.filter((m) => m.data.tag === 'wallet-low');
assert.deepEqual(lowMsgs.map((m) => m.key), ['k1', 'k2']);
assert.equal(lowMsgs[0].data.title, '💰 買餸錢包得返 $150.5');
assert.match(lowMsgs[1].data.body, /Below \$200/);
assert.match(lowMsgs[0].data.url, /view=wallet/);
msgs = buildMessages({ mode: 'daily', today: '2026-09-29', members, dinners, devices, appUrl, wallet: { balance: 50000, low: 20000 } });
assert.equal(msgs.filter((m) => m.data.tag === 'wallet-low').length, 0);

// 🧹 家務：朝早淨係發俾負責人，過咗期嘅標「遲咗」；任何人 / 未到期 / 截數時間都唔發
const chores = [
  { name: '換床單', due: '2026-09-28', who: 'siti' },
  { name: '抹窗', tr: { id: 'Lap jendela kaca' }, due: '2026-09-29', who: 'siti' },
  { name: '淋花', due: '2026-09-29', who: 'dad' },
  { name: '洗廁所', due: '2026-09-29', who: '' },
  { name: '清雪櫃', due: '2026-09-30', who: 'siti' },
  { name: '倒回收', due: '2026-09-29', who: 'gran' },
];
msgs = buildMessages({ mode: 'daily', today: '2026-09-29', members, dinners, devices, appUrl, chores });
const choreMsgs = msgs.filter((m) => m.data.tag === 'chores');
assert.deepEqual(choreMsgs.map((m) => m.key), ['k1', 'k3']);
assert.equal(choreMsgs[0].data.title, '🧹 今日家務（1 樣）');
assert.equal(choreMsgs[0].data.body, '淋花');
assert.equal(choreMsgs[1].data.title, '🧹 Tugas hari ini (2)');
assert.equal(choreMsgs[1].data.body, 'Ganti seprai (terlambat), Lap jendela kaca');
assert.match(choreMsgs[1].data.url, /view=chores$/);
assert.equal(buildMessages({ mode: 'cutoff', today: '2026-09-29', members, dinners, devices, appUrl, chores }).filter((m) => m.data.tag === 'chores').length, 0);

// 📅 事項：當日朝早發俾相關嘅人，排時間，冇時間就寫「全日」
const events = [
  { title: '家長日', date: '2026-09-29', time: '19:00', who: 'dad', note: '帶手冊' },
  { title: '覆診', date: '2026-09-29', time: '', who: 'dad' },
  { title: '學校旅行', date: '2026-09-30', time: '08:00', who: 'dad' },
  { title: 'Hari libur', date: '2026-09-29', time: '', who: '' },
  { title: '打針', tr: { id: 'Suntik' }, date: '2026-09-29', time: '10:30', who: 'siti' },
];
msgs = buildMessages({ mode: 'daily', today: '2026-09-29', members, dinners, devices, appUrl, events }).filter((m) => m.data.tag === 'events');
assert.deepEqual(msgs.map((m) => m.key), ['k1', 'k3']);
assert.equal(msgs[0].data.title, '📅 今日：全日 覆診');
assert.equal(msgs[0].data.body, '全日 覆診\n19:00 家長日 · 帶手冊');
assert.match(msgs[0].data.url, /cal=2026-09-29$/);
assert.equal(msgs[1].data.title, '📅 Hari ini: 10:30 Suntik');
assert.equal(buildMessages({ mode: 'weekly', today: '2026-09-29', members, dinners, devices, appUrl, events }).filter((m) => m.data.tag === 'events').length, 0);

console.log('messages.test.mjs: all passed');
