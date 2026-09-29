// NAS 匯出（scripts/export）：備份包埋家務、事項、roster、常買、未入數嘅單，仲有 calendar.csv
// 要 Firebase emulator 同 scripts/export 嘅 npm 套件（npm ci --prefix ../scripts/export）
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-fsl', firestore: { host: '127.0.0.1', port: 8085 } });
await env.clearFirestore();
const FID = 'exportfamily0123456';
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const put = (path, data) => setDoc(doc(db, `families/${FID}/${path}`), data);
  await setDoc(doc(db, `families/${FID}`), { name: '測試屋企', joinCode: 'secretcode123' });
  await put('members/dad', { name: '爸爸' });
  await put('members/siti', { name: 'Siti', eats: false });
  await put('devices/u1', { name: '爸爸', code: 'secretcode123' });
  await put('chores/c1', { name: '換床單', every: 1, unit: 'week', start: '2026-10-05', due: '2026-10-05', who: 'siti' });
  await put('events/e1', { title: '接阿仔', date: '2026-10-05', time: '15:30', who: 'siti', repeat: [1, 2, 3, 4, 5], until: '2026-12-18', exc: { '2026-10-07': { skip: true } } });
  await put('events/e2', { title: '家長日', date: '2026-10-08', time: '19:00', who: 'dad', note: '帶手冊, 簽名' });
  await put('rosters/dad', { trips: [{ s: '2026-10-06T11:30', e: '2026-10-08T06:00', d: 'LAX', k: 'flight' }], reserves: [{ s: '2026-10-10T09:10', e: '2026-10-10T10:10', c: 'AR8' }] });
  await put('rosters/siti', { trips: [], reserves: [], off: ['2026-10-04', '2026-10-11'] });
  await put('freq/milk', { name: '牛奶', count: 3 });
  await put('inbox/r1', { photo: 'p1', thumb: '', by: 'Siti' });
});

const out = mkdtempSync(join(tmpdir(), 'export-'));
const log = execFileSync('node', [new URL('../scripts/export/export.mjs', import.meta.url).pathname], {
  env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', GCLOUD_PROJECT: 'demo-fsl', OUT_DIR: out, FAMILY_ID: FID },
  encoding: 'utf8',
});
const dir = join(out, `測試屋企-${FID.slice(-4)}`);
for (const c of ['chores', 'events', 'rosters', 'freq', 'inbox']) {
  assert.ok(existsSync(join(dir, 'backup', `${c}.json`)), `backup/${c}.json`);
  assert.equal(JSON.parse(readFileSync(join(dir, 'backup', `${c}.json`), 'utf8')).length > 0, true, `${c} has data`);
}
assert.ok(!readFileSync(join(dir, 'backup', 'devices.json'), 'utf8').includes('secretcode123'), 'no invite codes');
assert.ok(!readFileSync(join(dir, 'backup', 'family.json'), 'utf8').includes('secretcode123'), 'no invite codes');

const csv = readFileSync(join(dir, 'calendar.csv'), 'utf8').replace(/^﻿/, '').trim().split('\r\n');
assert.equal(csv[0], 'date,time,end,kind,repeat,title,who,note');
const rows = csv.slice(1);
assert.deepEqual(
  rows,
  [
    '2026-10-04,,,off,,,Siti,',
    '2026-10-05,15:30,2026-12-18,event,一二三四五,接阿仔,Siti,1 日取消 / 0 日改咗',
    '2026-10-06,11:30,2026-10-08 06:00,duty,,LAX,爸爸,',
    '2026-10-08,19:00,,event,,家長日,爸爸,"帶手冊, 簽名"',
    '2026-10-10,09:10,2026-10-10 10:10,reserve,,AR8,爸爸,',
    '2026-10-11,,,off,,,Siti,',
  ],
);
console.log(log.trim().split('\n').at(-1));
await env.cleanup();
console.log('export.test.mjs: all passed');
