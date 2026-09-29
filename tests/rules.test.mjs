// Firestore 規則測試（要 Firebase emulator：npm run emulated）
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-fsl',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
});
await env.clearFirestore();
let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log('ok -', name);
};

const db = (uid) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());
const FID = 'fam0123456789abcdefg';
const CODE = 'code12345678';
const dev = (uid, code, fid = FID) => setDoc(doc(db(uid), `families/${fid}/devices/${uid}`), { code, name: uid, label: 'test', lastSeen: serverTimestamp() }, { merge: true });
const item = { listId: 'l1', name: '牛奶', qty: '', note: '', category: 'dairy', addedBy: 'x', done: false };

// ---------- 新家庭 ----------
await test('alice creates family with joinCode and registers', async () => {
  await assertSucceeds(setDoc(doc(db('alice'), `families/${FID}`), { name: '屋企', joinCode: CODE, createdAt: serverTimestamp() }));
  await assertSucceeds(dev('alice', CODE));
  await assertSucceeds(addDoc(collection(db('alice'), `families/${FID}/items`), item));
  await assertSucceeds(getDocs(collection(db('alice'), `families/${FID}/items`)));
  await assertSucceeds(getDoc(doc(db('alice'), `families/${FID}`)));
});

await test('unregistered bob cannot read anything', async () => {
  await assertFails(getDoc(doc(db('bob'), `families/${FID}`)));
  await assertFails(getDocs(collection(db('bob'), `families/${FID}/items`)));
  await assertFails(getDocs(collection(db('bob'), `families/${FID}/devices`)));
  await assertFails(addDoc(collection(db('bob'), `families/${FID}/items`), item));
});

await test('unauthenticated cannot do anything', async () => {
  await assertFails(getDocs(collection(db(null), `families/${FID}/items`)));
  await assertFails(setDoc(doc(db(null), `families/${FID}/devices/x`), { code: CODE }));
});

await test('bob cannot register with wrong code or as someone else', async () => {
  await assertFails(dev('bob', 'wrongcode123'));
  await assertFails(dev('bob', FID)); // 家庭 ID 唔再係代碼
  await assertFails(setDoc(doc(db('bob'), `families/${FID}/devices/carol`), { code: CODE, name: 'x', label: '' }));
});

await test('bob registers with the right code and can use the family', async () => {
  await assertSucceeds(dev('bob', CODE));
  await assertSucceeds(getDocs(collection(db('bob'), `families/${FID}/items`)));
  await assertSucceeds(getDocs(collection(db('bob'), `families/${FID}/devices`)));
});

await test('bob cannot change alice device, only his own', async () => {
  await assertFails(updateDoc(doc(db('bob'), `families/${FID}/devices/alice`), { name: 'hacked' }));
  await assertSucceeds(updateDoc(doc(db('bob'), `families/${FID}/devices/bob`), { name: 'Bob', lastSeen: serverTimestamp() }));
});

await test('alice removes bob → bob loses access', async () => {
  await assertSucceeds(deleteDoc(doc(db('alice'), `families/${FID}/devices/bob`)));
  await assertFails(getDocs(collection(db('bob'), `families/${FID}/items`)));
  await assertFails(getDoc(doc(db('bob'), `families/${FID}`)));
});

await test('rotating the code: old code no longer registers, new one does', async () => {
  await assertSucceeds(updateDoc(doc(db('alice'), `families/${FID}`), { joinCode: 'newcode98765' }));
  await assertFails(dev('bob', CODE)); // 被踢走嘅 bob 用舊連結返唔到嚟
  await assertFails(dev('carol', CODE));
  await assertSucceeds(dev('carol', 'newcode98765'));
  await assertSucceeds(getDocs(collection(db('carol'), `families/${FID}/items`)));
});

await test('already-registered alice keeps working after rotation (re-register with her old code)', async () => {
  await assertSucceeds(dev('alice', CODE));
  await assertSucceeds(getDocs(collection(db('alice'), `families/${FID}/items`)));
});

await test('cannot remove the joinCode or set a too-short one', async () => {
  let snap;
  await env.withSecurityRulesDisabled(async (c) => {
    snap = (await getDoc(doc(c.firestore(), `families/${FID}`))).data();
  });
  const { joinCode, ...rest } = snap;
  await assertFails(setDoc(doc(db('alice'), `families/${FID}`), rest));
  await assertFails(updateDoc(doc(db('alice'), `families/${FID}`), { joinCode: 'short' }));
  await assertFails(setDoc(doc(db('zed'), 'families/fam9999999999999999'), { name: 'x', joinCode: 'short' }));
});

// ---------- 舊式家庭（未有 joinCode） ----------
const LEG = 'legacy0123456789abcd';
await env.withSecurityRulesDisabled(async (c) => {
  await setDoc(doc(c.firestore(), `families/${LEG}`), { name: '舊屋企' });
});

await test('legacy family: anyone signed in can still use it (same as before)', async () => {
  await assertSucceeds(getDoc(doc(db('old1'), `families/${LEG}`)));
  await assertSucceeds(addDoc(collection(db('old1'), `families/${LEG}/items`), item));
});

await test('legacy family: register with family ID as code, wrong code fails', async () => {
  await assertFails(dev('old1', 'something123', LEG));
  await assertSucceeds(dev('old1', LEG, LEG));
});

await test('legacy family: first rotation locks out unregistered devices', async () => {
  await assertSucceeds(updateDoc(doc(db('old1'), `families/${LEG}`), { joinCode: 'lockedcode12' }));
  await assertFails(getDocs(collection(db('old2'), `families/${LEG}/items`)));
  await assertFails(dev('old2', LEG, LEG)); // 舊連結失效
  await assertSucceeds(getDocs(collection(db('old1'), `families/${LEG}/items`)));
  await assertSucceeds(dev('old1', LEG, LEG)); // 已登記嘅機照用返原本代碼更新
});

await test('non-existent family is not readable and not joinable', async () => {
  await assertFails(getDoc(doc(db('x'), 'families/doesnotexist123456')));
  await assertFails(dev('x', 'doesnotexist123456', 'doesnotexist123456'));
});

await test('push token docs need registration and accept uid', async () => {
  await assertSucceeds(setDoc(doc(db('carol'), `families/${FID}/push/k1`), { token: 't', memberId: 'm', lang: 'zh', uid: 'carol', updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db('bob'), `families/${FID}/push/k2`), { token: 't', memberId: 'm', lang: 'zh', uid: 'bob' }));
});

// ---------- 💰 錢包 ----------
await test('wallet: registered device can add topup/expense/adjust; bad data rejected', async () => {
  const w = (uid) => collection(db(uid), `families/${FID}/wallet`);
  await assertSucceeds(addDoc(w('carol'), { type: 'topup', amount: 100000, date: '2026-09-28', by: 'Carol' }));
  await assertSucceeds(addDoc(w('carol'), { type: 'expense', amount: 21850, date: '2026-09-28', by: 'Siti', place: '街市', items: ['菜心'], receipts: ['p1'] }));
  await assertSucceeds(addDoc(w('carol'), { type: 'adjust', amount: -600, expected: 34600, counted: 34000, date: '2026-10-02', by: 'Carol' }));
  await assertFails(addDoc(w('carol'), { type: 'expense', amount: -500, date: '2026-09-28' })); // 支出唔可以負數
  await assertFails(addDoc(w('carol'), { type: 'expense', amount: 12.5, date: '2026-09-28' })); // 要用整數（仙）
  await assertFails(addDoc(w('carol'), { type: 'gift', amount: 100, date: '2026-09-28' }));
  await assertFails(addDoc(w('carol'), { type: 'expense', amount: 100, date: '28/9' }));
  await assertFails(addDoc(w('carol'), { type: 'expense', amount: 100, date: '2026-09-28', hacker: true }));
  await assertFails(addDoc(w('bob'), { type: 'expense', amount: 100, date: '2026-09-28' })); // 被移除嘅機
  await assertFails(getDocs(w('bob')));
  await assertSucceeds(getDocs(w('carol')));
});

await test('family walletLow setting must be a non-negative integer', async () => {
  await assertSucceeds(updateDoc(doc(db('carol'), `families/${FID}`), { walletLow: 20000 }));
  await assertFails(updateDoc(doc(db('carol'), `families/${FID}`), { walletLow: -1 }));
  await assertFails(updateDoc(doc(db('carol'), `families/${FID}`), { walletLow: '200' }));
});

await test('freq: registered device can bump counts with increment; bad data and removed devices rejected', async () => {
  const { increment } = await import('firebase/firestore');
  const ref = (uid) => doc(db(uid), `families/${FID}/freq/milk`);
  await assertSucceeds(setDoc(ref('carol'), { name: '牛奶', category: 'dairy', lang: 'zh', tr: { zh: '牛奶' }, count: increment(1), lastAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(setDoc(ref('carol'), { name: '牛奶', count: increment(1), lastAt: serverTimestamp() }, { merge: true }));
  const snap = await getDoc(ref('carol'));
  assert.equal(snap.data().count, 2);
  await assertFails(setDoc(ref('carol'), { name: '牛奶', count: 'lots' }, { merge: true }));
  await assertFails(setDoc(ref('carol'), { name: '牛奶', count: 1, extra: 1 }, { merge: true }));
  await assertFails(setDoc(ref('bob'), { name: '牛奶', count: increment(1) }, { merge: true }));
  await assertFails(getDoc(ref('bob')));
});

await test('inbox: registered device can add/read/delete pending receipts; no updates; bad data rejected', async () => {
  const col = (uid) => collection(db(uid), `families/${FID}/inbox`);
  const ok = { photo: 'p123', thumb: 'data:image/jpeg;base64,AAA', by: 'Siti', createdAt: serverTimestamp() };
  const ref = await addDoc(col('carol'), ok);
  await assertSucceeds(getDocs(col('carol')));
  await assertFails(updateDoc(doc(db('carol'), ref.path), { by: 'x' }));
  await assertFails(addDoc(col('carol'), { ...ok, amount: 5 }));
  await assertFails(addDoc(col('carol'), { ...ok, photo: '' }));
  await assertFails(addDoc(col('carol'), { ...ok, thumb: 'x'.repeat(30001) }));
  await assertFails(addDoc(col('bob'), ok));
  await assertFails(getDocs(col('bob')));
  await assertSucceeds(deleteDoc(doc(db('carol'), ref.path)));
});

await test('chores: valid chore saved/updated; bad schedule, extra fields and removed devices rejected', async () => {
  const col = (uid) => collection(db(uid), `families/${FID}/chores`);
  const ok = { name: '換床單', lang: 'zh', tr: { zh: '換床單' }, trAuto: {}, every: 1, unit: 'week', start: '2026-09-28', due: '2026-09-28', who: 'm1', note: '', by: 'Siti', createdAt: serverTimestamp() };
  const ref = await addDoc(col('carol'), ok);
  await assertSucceeds(updateDoc(doc(db('carol'), ref.path), { due: '2026-10-05', lastDone: '2026-09-29', lastBy: 'Siti' }));
  await assertSucceeds(updateDoc(doc(db('carol'), ref.path), { 'tr.id': 'Ganti seprai', 'trAuto.id': false }));
  await assertFails(updateDoc(doc(db('carol'), ref.path), { every: 0 }));
  await assertFails(updateDoc(doc(db('carol'), ref.path), { every: 1.5 }));
  await assertFails(updateDoc(doc(db('carol'), ref.path), { unit: 'year' }));
  await assertFails(updateDoc(doc(db('carol'), ref.path), { due: 'tomorrow' }));
  await assertFails(addDoc(col('carol'), { ...ok, hacker: 1 }));
  await assertFails(addDoc(col('carol'), { ...ok, name: '' }));
  await assertFails(addDoc(col('bob'), ok));
  await assertFails(getDocs(col('bob')));
  await assertSucceeds(deleteDoc(doc(db('carol'), ref.path)));
});

await test('events: valid event saved/updated; bad date/time, extra fields and removed devices rejected', async () => {
  const col = (uid) => collection(db(uid), `families/${FID}/events`);
  const ok = { title: '家長日', lang: 'zh', tr: { zh: '家長日' }, trAuto: {}, date: '2026-10-08', time: '19:00', who: 'm1', note: '帶手冊', photo: 'p1', by: 'Mum', createdAt: serverTimestamp() };
  const ref = await addDoc(col('carol'), ok);
  await assertSucceeds(addDoc(col('carol'), { ...ok, time: '' }));
  await assertSucceeds(updateDoc(doc(db('carol'), ref.path), { date: '2026-10-09', 'tr.id': 'Hari orang tua', 'trAuto.id': true }));
  await assertFails(updateDoc(doc(db('carol'), ref.path), { time: '7pm' }));
  await assertFails(updateDoc(doc(db('carol'), ref.path), { date: '8/10' }));
  await assertFails(addDoc(col('carol'), { ...ok, title: '' }));
  await assertFails(addDoc(col('carol'), { ...ok, repeat: 'weekly' }));
  await assertSucceeds(addDoc(col('carol'), { ...ok, repeat: [1, 2, 3, 4, 5], until: '2026-12-31', exc: { '2026-10-07': { skip: true } } }));
  await assertSucceeds(addDoc(col('carol'), { ...ok, repeat: [3], until: '' }));
  await assertFails(addDoc(col('carol'), { ...ok, repeat: [0, 1, 2, 3, 4, 5, 6, 0] }));
  await assertFails(addDoc(col('carol'), { ...ok, repeat: [1], until: 'next year' }));
  await assertFails(addDoc(col('carol'), { ...ok, exc: 'none' }));
  await assertFails(addDoc(col('bob'), ok));
  await assertFails(getDocs(col('bob')));
  await assertSucceeds(deleteDoc(doc(db('carol'), ref.path)));
});

await test('rosters: valid roster saved; bad settings, extra fields and removed devices rejected', async () => {
  const ref = (uid) => doc(db(uid), `families/${FID}/rosters/m1`);
  const ok = { trips: [{ s: '2026-09-01T11:30', e: '2026-09-04T06:21', d: 'LAX', k: 'flight' }], reserves: [], from: '2026-09-01', to: '2026-09-30', dinner: '19:30', commute: 90, showDest: true, by: 'Pilot', updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(ref('carol'), ok));
  await assertSucceeds(updateDoc(ref('carol'), { dinner: '20:00', commute: 60, showDest: false }));
  await assertFails(updateDoc(ref('carol'), { commute: 500 }));
  await assertFails(updateDoc(ref('carol'), { commute: 1.5 }));
  await assertFails(updateDoc(ref('carol'), { dinner: '8pm' }));
  await assertFails(setDoc(ref('carol'), { ...ok, flightNumbers: ['CX884'] }));
  await assertFails(setDoc(ref('carol'), { ...ok, trips: 'x' }));
  await assertSucceeds(setDoc(ref('carol'), { ...ok, off: ['2026-09-06', '2026-09-13'] }));
  await assertSucceeds(setDoc(doc(db('carol'), `families/${FID}/rosters/helper`), { trips: [], reserves: [], off: ['2026-09-06'], from: '2026-01-01', to: '2026-12-31', by: 'Mum' }));
  await assertFails(setDoc(ref('carol'), { ...ok, off: 'sunday' }));
  await assertFails(setDoc(ref('carol'), { ...ok, off: Array.from({ length: 401 }, () => '2026-01-01') }));
  await assertFails(setDoc(ref('bob'), ok));
  await assertFails(getDoc(ref('bob')));
  await assertSucceeds(deleteDoc(ref('carol')));
});

await env.cleanup();
console.log(`\n${passed} rule tests passed`);
