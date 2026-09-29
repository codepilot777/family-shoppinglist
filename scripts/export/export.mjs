// 將屋企通嘅資料匯出去 NAS（或者任何一部電腦）：
//   <OUT_DIR>/<家庭名>-<ID 尾 4 位>/
//     wallet-all.csv            全部家用紀錄（Excel 開得）
//     wallet/2026-09.csv        每月一個檔
//     receipts/2026-09-28_街市_218.00_1.jpg   單據相（已經有就唔再下載）
//     photos/<id>.jpg           其他相（貨品相）
//     backup/<collection>.json  所有資料嘅完整備份（清單、貨品、食飯、菜式…）
//     last-export.txt
//
// 環境變數：
//   FIREBASE_SERVICE_ACCOUNT_FILE  service account .json 檔案路徑（或者 FIREBASE_SERVICE_ACCOUNT = 成段 JSON）
//   OUT_DIR                        輸出資料夾（預設 ./home-hub-export）
//   FAMILY_ID                      淨係匯出某個家庭（可以唔填）
//   FIRESTORE_EMULATOR_HOST + GCLOUD_PROJECT：測試用
import { mkdir, writeFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { toCSV, byNewest } from '../../public/wallet.js';

const { FIREBASE_SERVICE_ACCOUNT, FIREBASE_SERVICE_ACCOUNT_FILE, OUT_DIR = './home-hub-export', FAMILY_ID, FIRESTORE_EMULATOR_HOST, GCLOUD_PROJECT } =
  process.env;

if (FIRESTORE_EMULATOR_HOST) {
  initializeApp({ projectId: GCLOUD_PROJECT || 'demo-fsl' });
} else {
  const json = FIREBASE_SERVICE_ACCOUNT || (FIREBASE_SERVICE_ACCOUNT_FILE && readFileSync(FIREBASE_SERVICE_ACCOUNT_FILE, 'utf8'));
  if (!json) {
    console.error('請設定 FIREBASE_SERVICE_ACCOUNT_FILE（service account .json 嘅路徑）。');
    process.exit(1);
  }
  initializeApp({ credential: cert(JSON.parse(json)) });
}
const db = getFirestore();

// 備份嘅 collection（push token 同邀請代碼唔匯出）
const COLLECTIONS = ['lists', 'items', 'members', 'dinners', 'recipes', 'dict', 'wallet', 'devices'];

const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || '_';
const exists = (p) => access(p).then(() => true, () => false);

// Firestore Timestamp → ISO 字串，方便人睇
function plain(v) {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}
const millis = (v) => (v instanceof Timestamp ? v.toMillis() : v ?? 0);

async function savePhoto(famRef, id, path) {
  if (await exists(path)) return false;
  const snap = await famRef.collection('photos').doc(id).get();
  const data = snap.exists ? snap.data().data : null;
  const m = typeof data === 'string' && data.match(/^data:image\/jpeg;base64,(.*)$/);
  if (!m) return false;
  await writeFile(path, Buffer.from(m[1], 'base64'));
  return true;
}

const families = FAMILY_ID ? [db.collection('families').doc(FAMILY_ID)] : await db.collection('families').listDocuments();
let total = 0;

for (const famRef of families) {
  const famSnap = await famRef.get();
  if (!famSnap.exists) continue;
  const fam = famSnap.data();
  const dir = join(OUT_DIR, `${safe(fam.name)}-${famRef.id.slice(-4)}`);
  await mkdir(join(dir, 'wallet'), { recursive: true });
  await mkdir(join(dir, 'receipts'), { recursive: true });
  await mkdir(join(dir, 'photos'), { recursive: true });
  await mkdir(join(dir, 'backup'), { recursive: true });

  const data = {};
  for (const name of COLLECTIONS) {
    const snap = await famRef.collection(name).get();
    data[name] = snap.docs.map((d) => {
      const doc = { id: d.id, ...plain(d.data()) };
      if (name === 'devices') delete doc.code;
      return doc;
    });
    await writeFile(join(dir, 'backup', `${name}.json`), JSON.stringify(data[name], null, 2));
  }
  const { joinCode, ...famInfo } = plain(fam);
  await writeFile(join(dir, 'backup', 'family.json'), JSON.stringify({ id: famRef.id, ...famInfo }, null, 2));

  // 家用 CSV
  const walletSnap = await famRef.collection('wallet').get();
  const entries = walletSnap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: millis(d.data().createdAt) }));
  await writeFile(join(dir, 'wallet-all.csv'), toCSV(entries));
  const months = [...new Set(entries.map((e) => (e.date || '').slice(0, 7)).filter(Boolean))];
  for (const m of months) {
    await writeFile(join(dir, 'wallet', `${m}.csv`), toCSV(entries.filter((e) => e.date?.startsWith(m))));
  }

  // 單據相：日期_地方_銀碼_n.jpg
  let newReceipts = 0;
  const receiptIds = new Set();
  for (const e of entries.sort(byNewest)) {
    (e.receipts || []).forEach((id) => receiptIds.add(id));
    for (const [i, id] of (e.receipts || []).entries()) {
      const name = `${e.date}_${safe(e.place || e.type)}_${(Math.abs(e.amount) / 100).toFixed(2)}_${i + 1}.jpg`;
      if (await savePhoto(famRef, id, join(dir, 'receipts', name))) newReceipts++;
    }
  }
  // 其他相（貨品相）
  let newPhotos = 0;
  for (const ref of await famRef.collection('photos').listDocuments()) {
    if (receiptIds.has(ref.id)) continue;
    if (await savePhoto(famRef, ref.id, join(dir, 'photos', `${ref.id}.jpg`))) newPhotos++;
  }

  await writeFile(join(dir, 'last-export.txt'), `${new Date().toISOString()}\n`);
  console.log(
    `${fam.name} (…${famRef.id.slice(-4)}): ${entries.length} wallet entries, ${months.length} month file(s), ` +
      `${newReceipts} new receipt(s), ${newPhotos} new photo(s), ${COLLECTIONS.map((c) => `${c}=${data[c].length}`).join(' ')}`,
  );
  total++;
}
console.log(`done: ${total} family(ies) → ${OUT_DIR}`);
