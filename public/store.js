
const ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export function randomId(len = 20) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

// Firestore doc ID 唔可以有「/」，亦唔可以係「.」「..」
const dictId = (key) => encodeURIComponent(String(key).trim().toLowerCase()).slice(0, 400).replace(/^\.*$/, (m) => `_${m}`);

// 用文字方式讀 firebase-config.js，咁無論有冇 `export`、定係成段 Firebase 範例貼晒入去都讀得到
async function loadFirebaseConfig() {
  const res = await fetch('firebase-config.js', { cache: 'no-cache' });
  if (!res.ok) return {};
  const m = (await res.text()).match(/firebaseConfig\s*=\s*(\{[\s\S]*?\})/);
  if (!m) return {};
  try {
    return new Function(`return (${m[1]});`)() || {};
  } catch {
    const err = new Error('firebase-config.js 格式唔啱');
    err.code = 'config/invalid';
    throw err;
  }
}

export async function createStore() {
  const config = await loadFirebaseConfig();
  return config.apiKey && config.projectId ? createFirebaseStore(config) : createLocalStore();
}

// ---------- Firebase (即時同步) ----------

async function createFirebaseStore(firebaseConfig) {
  const fb = await import('./vendor/firebase.js');
  const app = fb.initializeApp(firebaseConfig);
  const auth = fb.getAuth(app);
  const db = fb.initializeFirestore(app, {
    localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }),
  });

  // 開發測試用：localStorage 'fsl-emulator' = 主機名 → 連本機 Firebase emulator（正式用戶唔會有）
  let emulatorHost = null;
  try {
    emulatorHost = localStorage.getItem('fsl-emulator');
  } catch {}
  if (emulatorHost) {
    fb.connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    fb.connectFirestoreEmulator(db, emulatorHost, 8085);
  }

  await new Promise((resolve, reject) => {
    const off = fb.onAuthStateChanged(auth, (user) => {
      if (user) {
        off();
        resolve();
      }
    });
    fb.signInAnonymously(auth).catch((err) => {
      off();
      reject(err);
    });
  });

  const familyRef = (fid) => fb.doc(db, 'families', fid);
  const listsCol = (fid) => fb.collection(db, 'families', fid, 'lists');
  const itemsCol = (fid) => fb.collection(db, 'families', fid, 'items');
  const dictCol = (fid) => fb.collection(db, 'families', fid, 'dict');
  const photosCol = (fid) => fb.collection(db, 'families', fid, 'photos');
  const membersCol = (fid) => fb.collection(db, 'families', fid, 'members');
  const dinnersCol = (fid) => fb.collection(db, 'families', fid, 'dinners');
  const pushCol = (fid) => fb.collection(db, 'families', fid, 'push');
  const recipesCol = (fid) => fb.collection(db, 'families', fid, 'recipes');
  const devicesCol = (fid) => fb.collection(db, 'families', fid, 'devices');
  const walletCol = (fid) => fb.collection(db, 'families', fid, 'wallet');
  const freqCol = (fid) => fb.collection(db, 'families', fid, 'freq');
  const inboxCol = (fid) => fb.collection(db, 'families', fid, 'inbox');
  const choresCol = (fid) => fb.collection(db, 'families', fid, 'chores');
  const eventsCol = (fid) => fb.collection(db, 'families', fid, 'events');
  const toMillis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v ?? Date.now());
  const readDocs = (snap) =>
    snap.docs.map((d) => {
      const data = d.data({ serverTimestamps: 'estimate' });
      return { ...data, id: d.id, createdAt: toMillis(data.createdAt), doneAt: data.doneAt ? toMillis(data.doneAt) : null };
    });

  const registerDevice = (fid, code, info) =>
    fb.setDoc(
      fb.doc(devicesCol(fid), auth.currentUser.uid),
      { code, name: info?.name || '', label: info?.label || '', lastSeen: fb.serverTimestamp() },
      { merge: true },
    );

  return {
    mode: 'firebase',

    get uid() {
      return auth.currentUser?.uid || '';
    },

    // 未登記嘅機讀唔到（會 throw permission-denied）
    async getFamily(fid) {
      const snap = await fb.getDoc(familyRef(fid));
      return snap.exists() ? { id: fid, ...snap.data() } : null;
    },

    // 新家庭一開始就有邀請代碼，建立者部機即刻登記
    async createFamily(name, firstListName, device) {
      const fid = randomId();
      let joinCode = randomId(12);
      try {
        await fb.setDoc(familyRef(fid), { name, joinCode, createdAt: fb.serverTimestamp() });
        await registerDevice(fid, joinCode, device);
      } catch (err) {
        if (err?.code !== 'permission-denied') throw err;
        // Firestore rules 未更新：照舊式開（之後更新 rules 再「換新邀請代碼」就會鎖好）
        joinCode = '';
        await fb.setDoc(familyRef(fid), { name, createdAt: fb.serverTimestamp() });
      }
      await fb.addDoc(listsCol(fid), { name: firstListName, createdAt: fb.serverTimestamp() });
      return { fid, joinCode };
    },

    // ---------- 裝置 ----------
    // 用邀請代碼登記（或者更新最後使用時間）；代碼唔啱會 throw permission-denied
    registerDevice,

    subscribeDevices(fid, cb, onError) {
      return fb.onSnapshot(
        devicesCol(fid),
        (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }), lastSeen: toMillis(d.data({ serverTimestamps: 'estimate' }).lastSeen) }))),
        onError,
      );
    },

    removeDevice(fid, uid) {
      return fb.deleteDoc(fb.doc(devicesCol(fid), uid));
    },

    // ---------- ⭐ 常買 ----------
    subscribeFreq(fid, cb, onError) {
      return fb.onSnapshot(
        freqCol(fid),
        (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data(), lastAt: toMillis(d.data({ serverTimestamps: 'estimate' }).lastAt) }))),
        onError,
      );
    },

    // 加咗一次：次數 +1（全家共用）
    bumpFreq(fid, key, info) {
      return fb.setDoc(fb.doc(freqCol(fid), key), { ...info, count: fb.increment(1), lastAt: fb.serverTimestamp() }, { merge: true });
    },

    deleteFreq(fid, key) {
      return fb.deleteDoc(fb.doc(freqCol(fid), key));
    },

    // ---------- 💰 買餸錢包 ----------
    subscribeWallet(fid, cb, onError) {
      return fb.onSnapshot(walletCol(fid), (snap) => cb(readDocs(snap)), onError);
    },

    // 一次過寫幾筆（例如對數差額 + 入錢）
    addWalletEntries(fid, entries) {
      const batch = fb.writeBatch(db);
      for (const e of entries) batch.set(fb.doc(walletCol(fid)), { ...e, createdAt: fb.serverTimestamp() });
      return batch.commit();
    },

    updateWalletEntry(fid, id, patch) {
      return fb.updateDoc(fb.doc(walletCol(fid), id), patch);
    },

    deleteWalletEntry(fid, id) {
      return fb.deleteDoc(fb.doc(walletCol(fid), id));
    },

    // 🧾 未入數嘅單：相照舊放 photos，收件匣只存細圖同邊個影
    subscribeInbox(fid, cb, onError) {
      return fb.onSnapshot(inboxCol(fid), (snap) => cb(readDocs(snap)), onError);
    },

    addInbox(fid, data, thumb, by) {
      const photo = fb.doc(photosCol(fid));
      const ref = fb.doc(inboxCol(fid));
      const batch = fb.writeBatch(db);
      batch.set(photo, { data, createdAt: fb.serverTimestamp() });
      batch.set(ref, { photo: photo.id, thumb, by, createdAt: fb.serverTimestamp() });
      return { id: ref.id, done: batch.commit() };
    },

    // 揀咗嘅單變成一筆支出（相留低做單據），同時喺收件匣拎走
    saveInboxExpense(fid, entry, inboxIds) {
      const batch = fb.writeBatch(db);
      batch.set(fb.doc(walletCol(fid)), { ...entry, createdAt: fb.serverTimestamp() });
      for (const id of inboxIds) batch.delete(fb.doc(inboxCol(fid), id));
      return batch.commit();
    },

    deleteInbox(fid, id, photoId) {
      const batch = fb.writeBatch(db);
      batch.delete(fb.doc(inboxCol(fid), id));
      if (photoId) batch.delete(fb.doc(photosCol(fid), photoId));
      return batch.commit();
    },

    // cb(true/false)：呢部機仲有冇登記
    subscribeOwnDevice(fid, cb, onError) {
      return fb.onSnapshot(fb.doc(devicesCol(fid), auth.currentUser.uid), (snap) => cb(snap.exists()), onError);
    },

    // 換新邀請代碼：舊連結即時失效，已登記嘅機唔受影響
    async rotateJoinCode(fid) {
      const joinCode = randomId(12);
      await fb.updateDoc(familyRef(fid), { joinCode });
      return joinCode;
    },

    renameFamily(fid, name) {
      return fb.updateDoc(familyRef(fid), { name });
    },

    // 例如 { marketDays: [1, 3, 6], marketListId }
    updateFamily(fid, patch) {
      return fb.updateDoc(familyRef(fid), patch);
    },

    // ---------- 菜式 ----------
    subscribeRecipes(fid, cb, onError) {
      return fb.onSnapshot(recipesCol(fid), (snap) => cb(readDocs(snap)), onError);
    },

    addRecipe(fid, recipe) {
      const ref = fb.doc(recipesCol(fid));
      fb.setDoc(ref, { ...recipe, createdAt: fb.serverTimestamp() }).catch(() => {});
      return ref.id;
    },

    async addRecipes(fid, recipes) {
      const batch = fb.writeBatch(db);
      for (const r of recipes) batch.set(fb.doc(recipesCol(fid)), { ...r, createdAt: fb.serverTimestamp() });
      return batch.commit();
    },

    updateRecipe(fid, rid, patch) {
      return fb.updateDoc(fb.doc(recipesCol(fid), rid), patch);
    },

    deleteRecipe(fid, rid) {
      return fb.deleteDoc(fb.doc(recipesCol(fid), rid));
    },

    setRecipeTranslation(fid, rid, lang, text, auto) {
      return fb.updateDoc(fb.doc(recipesCol(fid), rid), { [`tr.${lang}`]: text, [`trAuto.${lang}`]: auto });
    },

    // ---------- 🧹 家務 ----------
    subscribeChores(fid, cb, onError) {
      return fb.onSnapshot(choresCol(fid), (snap) => cb(readDocs(snap)), onError);
    },

    async addChores(fid, chores) {
      const batch = fb.writeBatch(db);
      for (const c of chores) batch.set(fb.doc(choresCol(fid)), { ...c, createdAt: fb.serverTimestamp() });
      return batch.commit();
    },

    updateChore(fid, id, patch) {
      return fb.updateDoc(fb.doc(choresCol(fid), id), patch);
    },

    deleteChore(fid, id) {
      return fb.deleteDoc(fb.doc(choresCol(fid), id));
    },

    setChoreTranslation(fid, id, lang, text, auto) {
      return fb.updateDoc(fb.doc(choresCol(fid), id), { [`tr.${lang}`]: text, [`trAuto.${lang}`]: auto });
    },

    // ---------- 📅 事項 ----------
    subscribeEvents(fid, cb, onError) {
      return fb.onSnapshot(eventsCol(fid), (snap) => cb(readDocs(snap)), onError);
    },

    addEvent(fid, ev) {
      return fb.addDoc(eventsCol(fid), { ...ev, createdAt: fb.serverTimestamp() });
    },

    updateEvent(fid, id, patch) {
      return fb.updateDoc(fb.doc(eventsCol(fid), id), patch);
    },

    deleteEvent(fid, id) {
      return fb.deleteDoc(fb.doc(eventsCol(fid), id));
    },

    setEventTranslation(fid, id, lang, text, auto) {
      return fb.updateDoc(fb.doc(eventsCol(fid), id), { [`tr.${lang}`]: text, [`trAuto.${lang}`]: auto });
    },

    // 某一晚揀咗邊啲菜式
    setDishes(fid, date, dishes) {
      return fb.setDoc(fb.doc(dinnersCol(fid), date), { dishes }, { merge: true });
    },

    subscribeFamily(fid, cb, onError) {
      return fb.onSnapshot(familyRef(fid), (snap) => cb(snap.exists() ? { id: fid, ...snap.data() } : null), onError);
    },

    subscribeLists(fid, cb, onError) {
      return fb.onSnapshot(listsCol(fid), (snap) => cb(readDocs(snap)), onError);
    },

    addList(fid, name, kind = 'shop') {
      return fb.addDoc(listsCol(fid), { name, kind, createdAt: fb.serverTimestamp() }).then((r) => r.id);
    },

    updateList(fid, lid, patch) {
      return fb.updateDoc(fb.doc(listsCol(fid), lid), patch);
    },

    async deleteList(fid, lid) {
      const items = await fb.getDocs(fb.query(itemsCol(fid), fb.where('listId', '==', lid)));
      const batch = fb.writeBatch(db);
      items.forEach((d) => {
        batch.delete(d.ref);
        for (const pid of d.data().photos || []) batch.delete(fb.doc(photosCol(fid), pid));
      });
      batch.delete(fb.doc(listsCol(fid), lid));
      return batch.commit();
    },

    subscribeItems(fid, cb, onError) {
      return fb.onSnapshot(itemsCol(fid), (snap) => cb(readDocs(snap)), onError);
    },

    addItem(fid, item) {
      return fb.addDoc(itemsCol(fid), { ...item, done: false, doneBy: null, doneAt: null, createdAt: fb.serverTimestamp() });
    },

    updateItem(fid, iid, patch) {
      const data = { ...patch };
      if ('done' in data) data.doneAt = data.done ? fb.serverTimestamp() : null;
      return fb.updateDoc(fb.doc(itemsCol(fid), iid), data);
    },

    deleteItem(fid, iid) {
      return fb.deleteDoc(fb.doc(itemsCol(fid), iid));
    },

    // 用 dotted path，兩個唔同語言嘅人同時翻譯都唔會覆蓋對方
    setTranslation(fid, iid, lang, text, auto) {
      return fb.updateDoc(fb.doc(itemsCol(fid), iid), { [`tr.${lang}`]: text, [`trAuto.${lang}`]: auto });
    },

    // 相片：先喺本機攞 ID，唔使等上載完（離線都得）
    addPhoto(fid, data) {
      const ref = fb.doc(photosCol(fid));
      const done = fb.setDoc(ref, { data, createdAt: fb.serverTimestamp() });
      return { id: ref.id, done };
    },

    async getPhoto(fid, pid) {
      const snap = await fb.getDoc(fb.doc(photosCol(fid), pid));
      return snap.exists() ? snap.data().data : null;
    },

    deletePhotos(fid, ids) {
      if (!ids?.length) return Promise.resolve();
      const batch = fb.writeBatch(db);
      for (const pid of ids) batch.delete(fb.doc(photosCol(fid), pid));
      return batch.commit();
    },

    // ---------- 食飯 ----------
    subscribeMembers(fid, cb, onError) {
      return fb.onSnapshot(membersCol(fid), (snap) => cb(readDocs(snap)), onError);
    },

    addMember(fid, member) {
      const ref = fb.doc(membersCol(fid));
      fb.setDoc(ref, { ...member, createdAt: fb.serverTimestamp() }).catch(() => {});
      return ref.id;
    },

    updateMember(fid, mid, patch) {
      return fb.updateDoc(fb.doc(membersCol(fid), mid), patch);
    },

    deleteMember(fid, mid) {
      return fb.deleteDoc(fb.doc(membersCol(fid), mid));
    },

    // 由 from 到 to（包括）嘅食飯紀錄：{ 'YYYY-MM-DD': { att: {...} } }
    subscribeDinners(fid, from, to, cb, onError) {
      const q = fb.query(dinnersCol(fid), fb.where(fb.documentId(), '>=', from), fb.where(fb.documentId(), '<=', to));
      return fb.onSnapshot(q, (snap) => cb(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))), onError);
    },

    // entries: [{ date, memberId, rec }]，一次過寫（問卷用）
    setAttendance(fid, entries) {
      const batch = fb.writeBatch(db);
      for (const { date, memberId, rec } of entries) {
        batch.set(fb.doc(dinnersCol(fid), date), { att: { [memberId]: { ...rec, at: fb.serverTimestamp() } } }, { merge: true });
      }
      return batch.commit();
    },

    savePushToken(fid, key, data) {
      return fb.setDoc(fb.doc(pushCol(fid), key), { ...data, updatedAt: fb.serverTimestamp() });
    },

    deletePushToken(fid, key) {
      return fb.deleteDoc(fb.doc(pushCol(fid), key));
    },

    // 通知用：攞 FCM token（要喺 firebase-config.js 加 vapidKey）
    async getPushToken(vapidKey) {
      if (!vapidKey || !(await fb.isMessagingSupported())) return null;
      const registration = await navigator.serviceWorker.ready;
      return fb.getToken(fb.getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
    },

    pushConfigured: Boolean(firebaseConfig.vapidKey),
    vapidKey: firebaseConfig.vapidKey || '',

    subscribeDict(fid, cb) {
      return fb.onSnapshot(dictCol(fid), (snap) => cb(snap.docs.map((d) => d.data())), () => cb([]));
    },

    saveDictEntry(fid, key, entry) {
      return fb.setDoc(fb.doc(dictCol(fid), dictId(key)), entry);
    },

    async clearDone(fid, lid) {
      const q = fb.query(itemsCol(fid), fb.where('listId', '==', lid), fb.where('done', '==', true));
      const snap = await fb.getDocs(q);
      const batch = fb.writeBatch(db);
      snap.forEach((d) => {
        batch.delete(d.ref);
        for (const pid of d.data().photos || []) batch.delete(fb.doc(photosCol(fid), pid));
      });
      return batch.commit();
    },
  };
}

// ---------- 示範模式（只存喺本機） ----------

function createLocalStore() {
  const KEY = 'fsl-demo-db';
  const listeners = new Set();
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || { families: {} };
    } catch {
      return { families: {} };
    }
  };
  let data = load();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
    listeners.forEach((fn) => fn());
  };
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      data = load();
      listeners.forEach((fn) => fn());
    }
  });
  const fam = (fid) => data.families[fid];
  const removeItem = (f, id) => {
    for (const pid of f.items[id]?.photos || []) delete f.photos?.[pid];
    delete f.items[id];
  };
  const watch = (fn) => {
    listeners.add(fn);
    queueMicrotask(fn);
    return () => listeners.delete(fn);
  };

  return {
    mode: 'local',

    get uid() {
      let id = null;
      try {
        id = localStorage.getItem('fsl-local-uid');
        if (!id) localStorage.setItem('fsl-local-uid', (id = `local-${randomId(10)}`));
      } catch {}
      return id || 'local';
    },

    async getFamily(fid) {
      const f = fam(fid);
      return f ? { id: fid, name: f.name, joinCode: f.joinCode } : null;
    },

    async createFamily(name, firstListName, device) {
      const fid = randomId();
      const lid = randomId();
      const joinCode = randomId(12);
      data.families[fid] = { name, joinCode, lists: { [lid]: { name: firstListName, createdAt: Date.now() } }, items: {} };
      await this.registerDevice(fid, joinCode, device);
      return { fid, joinCode };
    },

    // 示範模式都照正式版咁檢查代碼，方便測試
    async registerDevice(fid, code, info) {
      const f = fam(fid);
      const cur = f?.devices?.[this.uid];
      if (!f || (code !== (f.joinCode ?? fid) && code !== cur?.code)) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
      f.devices = { ...f.devices, [this.uid]: { code, name: info?.name || '', label: info?.label || '', lastSeen: Date.now() } };
      save();
    },

    subscribeDevices(fid, cb) {
      return watch(() => cb(Object.entries(fam(fid)?.devices || {}).map(([id, dv]) => ({ id, ...dv }))));
    },

    async removeDevice(fid, uid) {
      delete fam(fid).devices?.[uid];
      save();
    },

    subscribeOwnDevice(fid, cb) {
      return watch(() => cb(!!fam(fid)?.devices?.[this.uid]));
    },

    subscribeFreq(fid, cb) {
      return watch(() => cb(Object.entries(fam(fid)?.freq || {}).map(([id, d]) => ({ id, ...d }))));
    },

    async bumpFreq(fid, key, info) {
      const f = fam(fid);
      f.freq = f.freq || {};
      const cur = f.freq[key] || { count: 0 };
      f.freq[key] = { ...cur, ...info, count: (cur.count || 0) + 1, lastAt: Date.now() };
      save();
    },

    async deleteFreq(fid, key) {
      delete fam(fid).freq?.[key];
      save();
    },

    subscribeWallet(fid, cb) {
      return watch(() => cb(Object.entries(fam(fid)?.wallet || {}).map(([id, e]) => ({ id, ...e }))));
    },

    async addWalletEntries(fid, entries) {
      const f = fam(fid);
      f.wallet = f.wallet || {};
      entries.forEach((e, i) => (f.wallet[randomId()] = { ...e, createdAt: Date.now() + i }));
      save();
    },

    async updateWalletEntry(fid, id, patch) {
      Object.assign(fam(fid).wallet[id], patch);
      save();
    },

    async deleteWalletEntry(fid, id) {
      delete fam(fid).wallet?.[id];
      save();
    },

    subscribeInbox(fid, cb) {
      return watch(() => cb(Object.entries(fam(fid)?.inbox || {}).map(([id, r]) => ({ id, ...r }))));
    },

    addInbox(fid, data, thumb, by) {
      const f = fam(fid);
      const photo = randomId();
      const id = randomId();
      f.photos = { ...f.photos, [photo]: data };
      f.inbox = { ...f.inbox, [id]: { photo, thumb, by, createdAt: Date.now() } };
      save();
      return { id, done: Promise.resolve() };
    },

    async saveInboxExpense(fid, entry, inboxIds) {
      const f = fam(fid);
      f.wallet = f.wallet || {};
      f.wallet[randomId()] = { ...entry, createdAt: Date.now() };
      for (const id of inboxIds) delete f.inbox?.[id];
      save();
    },

    async deleteInbox(fid, id, photoId) {
      const f = fam(fid);
      delete f.inbox?.[id];
      if (photoId) delete f.photos?.[photoId];
      save();
    },

    async rotateJoinCode(fid) {
      const joinCode = randomId(12);
      fam(fid).joinCode = joinCode;
      save();
      return joinCode;
    },

    async renameFamily(fid, name) {
      fam(fid).name = name;
      save();
    },

    async updateFamily(fid, patch) {
      Object.assign(fam(fid), patch);
      save();
    },

    subscribeFamily(fid, cb) {
      return watch(() => {
        const f = fam(fid);
        cb(f ? { id: fid, name: f.name, marketDays: f.marketDays, marketListId: f.marketListId, joinCode: f.joinCode } : null);
      });
    },

    subscribeRecipes(fid, cb) {
      return watch(() => cb(Object.entries(fam(fid)?.recipes || {}).map(([id, r]) => ({ id, ...r }))));
    },

    addRecipe(fid, recipe) {
      const id = randomId();
      const f = fam(fid);
      f.recipes = { ...f.recipes, [id]: { ...recipe, createdAt: Date.now() } };
      save();
      return id;
    },

    async addRecipes(fid, recipes) {
      const f = fam(fid);
      f.recipes = f.recipes || {};
      recipes.forEach((r, i) => (f.recipes[randomId()] = { ...r, createdAt: Date.now() + i }));
      save();
    },

    async updateRecipe(fid, rid, patch) {
      Object.assign(fam(fid).recipes[rid], patch);
      save();
    },

    async deleteRecipe(fid, rid) {
      delete fam(fid).recipes[rid];
      save();
    },

    async setRecipeTranslation(fid, rid, lang, text, auto) {
      const r = fam(fid).recipes?.[rid];
      if (!r) return;
      r.tr = { ...r.tr, [lang]: text };
      r.trAuto = { ...r.trAuto, [lang]: auto };
      save();
    },

    subscribeChores(fid, cb) {
      return watch(() => cb(Object.entries(fam(fid)?.chores || {}).map(([id, c]) => ({ id, ...c }))));
    },

    async addChores(fid, chores) {
      const f = fam(fid);
      f.chores = f.chores || {};
      chores.forEach((c, i) => (f.chores[randomId()] = { ...c, createdAt: Date.now() + i }));
      save();
    },

    async updateChore(fid, id, patch) {
      const c = fam(fid).chores?.[id];
      if (!c) return;
      Object.assign(c, patch);
      save();
    },

    async deleteChore(fid, id) {
      delete fam(fid).chores?.[id];
      save();
    },

    async setChoreTranslation(fid, id, lang, text, auto) {
      const c = fam(fid).chores?.[id];
      if (!c) return;
      c.tr = { ...c.tr, [lang]: text };
      c.trAuto = { ...c.trAuto, [lang]: auto };
      save();
    },

    subscribeEvents(fid, cb) {
      return watch(() => cb(Object.entries(fam(fid)?.events || {}).map(([id, e]) => ({ id, ...e }))));
    },

    async addEvent(fid, ev) {
      const f = fam(fid);
      f.events = { ...f.events, [randomId()]: { ...ev, createdAt: Date.now() } };
      save();
    },

    async updateEvent(fid, id, patch) {
      const e = fam(fid).events?.[id];
      if (!e) return;
      Object.assign(e, patch);
      save();
    },

    async deleteEvent(fid, id) {
      delete fam(fid).events?.[id];
      save();
    },

    async setEventTranslation(fid, id, lang, text, auto) {
      const e = fam(fid).events?.[id];
      if (!e) return;
      e.tr = { ...e.tr, [lang]: text };
      e.trAuto = { ...e.trAuto, [lang]: auto };
      save();
    },

    async setDishes(fid, date, dishes) {
      const f = fam(fid);
      f.dinners = f.dinners || {};
      f.dinners[date] = { att: {}, ...f.dinners[date], dishes };
      save();
    },

    subscribeLists(fid, cb) {
      return watch(() => cb(Object.entries(fam(fid)?.lists || {}).map(([id, l]) => ({ id, ...l }))));
    },

    async addList(fid, name, kind = 'shop') {
      const lid = randomId();
      fam(fid).lists[lid] = { name, kind, createdAt: Date.now() };
      save();
      return lid;
    },

    async updateList(fid, lid, patch) {
      Object.assign(fam(fid).lists[lid], patch);
      save();
    },

    async deleteList(fid, lid) {
      const f = fam(fid);
      delete f.lists[lid];
      for (const [id, it] of Object.entries(f.items)) if (it.listId === lid) removeItem(f, id);
      save();
    },

    subscribeItems(fid, cb) {
      return watch(() => cb(Object.entries(fam(fid)?.items || {}).map(([id, it]) => ({ id, ...it }))));
    },

    async addItem(fid, item) {
      fam(fid).items[randomId()] = { ...item, done: false, doneBy: null, doneAt: null, createdAt: Date.now() };
      save();
    },

    async updateItem(fid, iid, patch) {
      const it = fam(fid).items[iid];
      Object.assign(it, patch);
      if ('done' in patch) it.doneAt = patch.done ? Date.now() : null;
      save();
    },

    async deleteItem(fid, iid) {
      delete fam(fid).items[iid];
      save();
    },

    async setTranslation(fid, iid, lang, text, auto) {
      const it = fam(fid).items[iid];
      if (!it) return;
      it.tr = { ...it.tr, [lang]: text };
      it.trAuto = { ...it.trAuto, [lang]: auto };
      save();
    },

    addPhoto(fid, data) {
      const id = randomId();
      const f = fam(fid);
      f.photos = { ...f.photos, [id]: data };
      save();
      return { id, done: Promise.resolve() };
    },

    async getPhoto(fid, pid) {
      return fam(fid)?.photos?.[pid] || null;
    },

    async deletePhotos(fid, ids) {
      const f = fam(fid);
      for (const pid of ids || []) delete f.photos?.[pid];
      save();
    },

    subscribeMembers(fid, cb) {
      return watch(() => cb(Object.entries(fam(fid)?.members || {}).map(([id, m]) => ({ id, ...m }))));
    },

    addMember(fid, member) {
      const id = randomId();
      const f = fam(fid);
      f.members = { ...f.members, [id]: { ...member, createdAt: Date.now() } };
      save();
      return id;
    },

    async updateMember(fid, mid, patch) {
      Object.assign(fam(fid).members[mid], patch);
      save();
    },

    async deleteMember(fid, mid) {
      delete fam(fid).members[mid];
      save();
    },

    subscribeDinners(fid, from, to, cb) {
      return watch(() => cb(Object.fromEntries(Object.entries(fam(fid)?.dinners || {}).filter(([d]) => d >= from && d <= to))));
    },

    async setAttendance(fid, entries) {
      const f = fam(fid);
      f.dinners = f.dinners || {};
      for (const { date, memberId, rec } of entries) {
        const doc = (f.dinners[date] = f.dinners[date] || { att: {} });
        doc.att[memberId] = { ...rec, at: Date.now() };
      }
      save();
    },

    async savePushToken() {},
    async deletePushToken() {},
    async getPushToken() {
      return null;
    },
    pushConfigured: false,
    vapidKey: '',

    subscribeDict(fid, cb) {
      return watch(() => cb(Object.values(fam(fid)?.dict || {})));
    },

    async saveDictEntry(fid, key, entry) {
      const f = fam(fid);
      f.dict = { ...f.dict, [dictId(key)]: entry };
      save();
    },

    async clearDone(fid, lid) {
      const f = fam(fid);
      for (const [id, it] of Object.entries(f.items)) if (it.listId === lid && it.done) removeItem(f, id);
      save();
    },
  };
}
