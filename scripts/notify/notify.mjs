// GitHub Actions 定時執行：讀 Firestore → 發 FCM 通知。
// 環境變數：FIREBASE_SERVICE_ACCOUNT（JSON）、MODE（weekly | daily | cutoff）、APP_URL、DRY_RUN
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { hkNow, addDays } from '../../public/dates.js';
import { buildMessages } from './messages.mjs';
import { balance, DEFAULT_LOW } from '../../public/wallet.js';

const { FIREBASE_SERVICE_ACCOUNT, MODE, APP_URL, DRY_RUN } = process.env;
const dryRun = DRY_RUN === 'true';

if (!FIREBASE_SERVICE_ACCOUNT) {
  console.log('未設定 FIREBASE_SERVICE_ACCOUNT secret，唔發通知（睇 README「食飯通知」）。');
  process.exit(0);
}
if (!['weekly', 'daily', 'cutoff'].includes(MODE)) throw new Error(`Unknown MODE: ${MODE}`);

initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const messaging = getMessaging();
const today = hkNow().date;
console.log(`mode=${MODE} today=${today} (HKT) dryRun=${dryRun}`);

const INVALID = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);
let sent = 0;
let failed = 0;

for (const famRef of await db.collection('families').listDocuments()) {
  const [membersSnap, pushSnap, dinnersSnap, rostersSnap] = await Promise.all([
    famRef.collection('members').get(),
    famRef.collection('push').get(),
    famRef.collection('dinners').where('__name__', '>=', today).where('__name__', '<=', addDays(today, 7)).get(),
    famRef.collection('rosters').get(), // ✈️ 機師 roster：出勤嗰晚自動當唔返
  ]);
  if (pushSnap.empty || membersSnap.empty) continue;

  const [famSnap, devicesSnap, recipesSnap, walletSnap, choresSnap, eventsSnap] = await Promise.all([
    famRef.get(),
    famRef.collection('devices').get(),
    // 買餸日同錢包提示用（淨係朝早要）
    MODE === 'daily' ? famRef.collection('recipes').get() : null,
    MODE === 'daily' ? famRef.collection('wallet').get() : null,
    MODE === 'daily' ? famRef.collection('chores').get() : null,
    MODE === 'daily' ? famRef.collection('events').where('date', '==', today).get() : null,
  ]);

  const rosters = Object.fromEntries(rostersSnap.docs.map((d) => [d.id, d.data()]));
  const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data(), ...(rosters[d.id] ? { roster: rosters[d.id] } : {}) }));
  let devices = pushSnap.docs.map((d) => ({ key: d.id, ...d.data() }));
  // 已鎖好嘅家庭：只發俾仲有登記嘅機；被移除嘅機清走 token
  if (famSnap.data()?.joinCode) {
    const registered = new Set(devicesSnap.docs.map((d) => d.id));
    const removed = devices.filter((dv) => dv.uid && !registered.has(dv.uid));
    for (const dv of removed) await famRef.collection('push').doc(dv.key).delete().catch(() => {});
    devices = devices.filter((dv) => dv.uid && registered.has(dv.uid));
    if (removed.length) console.log(`  removed ${removed.length} token(s) of removed devices`);
  }
  const dinners = Object.fromEntries(dinnersSnap.docs.map((d) => [d.id, d.data()]));
  const recipes = recipesSnap ? recipesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  const marketDays = famSnap?.data()?.marketDays || [];
  const walletEntries = walletSnap ? walletSnap.docs.map((d) => d.data()) : [];
  const walletLow = famSnap.data()?.walletLow;
  const wallet = walletEntries.length
    ? { balance: balance(walletEntries), low: Number.isInteger(walletLow) ? walletLow : DEFAULT_LOW }
    : null;
  const chores = choresSnap ? choresSnap.docs.map((d) => d.data()) : [];
  const events = eventsSnap ? eventsSnap.docs.map((d) => d.data()) : [];
  const messages = buildMessages({ mode: MODE, today, members, dinners, devices, appUrl: APP_URL, marketDays, recipes, wallet, chores, events });
  console.log(`family …${famRef.id.slice(-4)}: ${members.length} members, ${devices.length} devices, ${messages.length} messages`);

  for (const msg of messages) {
    if (dryRun) {
      console.log(`  [dry run] ${msg.data.title} — ${msg.data.body}`);
      continue;
    }
    try {
      await messaging.send({
        token: msg.token,
        data: msg.data,
        webpush: { headers: { Urgency: 'high', TTL: String(6 * 3600) } },
      });
      sent++;
    } catch (err) {
      failed++;
      console.warn(`  send failed (${err.code || err.message})`);
      // 部機已經取消通知或者 app 刪咗：清走舊 token
      if (INVALID.has(err.code)) await famRef.collection('push').doc(msg.key).delete().catch(() => {});
    }
  }
}

console.log(`done: sent=${sent} failed=${failed}`);
