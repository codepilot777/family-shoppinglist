import { firebaseConfig } from './firebase-config.js';

const ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export function randomId(len = 20) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export async function createStore() {
  return isConfigured ? createFirebaseStore() : createLocalStore();
}

// ---------- Firebase (即時同步) ----------

async function createFirebaseStore() {
  const fb = await import('./vendor/firebase.js');
  const app = fb.initializeApp(firebaseConfig);
  const auth = fb.getAuth(app);
  const db = fb.initializeFirestore(app, {
    localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }),
  });

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
  const toMillis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v ?? Date.now());
  const readDocs = (snap) =>
    snap.docs.map((d) => {
      const data = d.data({ serverTimestamps: 'estimate' });
      return { ...data, id: d.id, createdAt: toMillis(data.createdAt), doneAt: data.doneAt ? toMillis(data.doneAt) : null };
    });

  return {
    mode: 'firebase',

    async getFamily(fid) {
      const snap = await fb.getDoc(familyRef(fid));
      return snap.exists() ? { id: fid, ...snap.data() } : null;
    },

    async createFamily(name, firstListName) {
      const fid = randomId();
      await fb.setDoc(familyRef(fid), { name, createdAt: fb.serverTimestamp() });
      await fb.addDoc(listsCol(fid), { name: firstListName, createdAt: fb.serverTimestamp() });
      return fid;
    },

    renameFamily(fid, name) {
      return fb.updateDoc(familyRef(fid), { name });
    },

    subscribeFamily(fid, cb) {
      return fb.onSnapshot(familyRef(fid), (snap) => cb(snap.exists() ? { id: fid, ...snap.data() } : null));
    },

    subscribeLists(fid, cb, onError) {
      return fb.onSnapshot(listsCol(fid), (snap) => cb(readDocs(snap)), onError);
    },

    addList(fid, name) {
      return fb.addDoc(listsCol(fid), { name, createdAt: fb.serverTimestamp() }).then((r) => r.id);
    },

    renameList(fid, lid, name) {
      return fb.updateDoc(fb.doc(listsCol(fid), lid), { name });
    },

    async deleteList(fid, lid) {
      const items = await fb.getDocs(fb.query(itemsCol(fid), fb.where('listId', '==', lid)));
      const batch = fb.writeBatch(db);
      items.forEach((d) => batch.delete(d.ref));
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

    async clearDone(fid, lid) {
      const q = fb.query(itemsCol(fid), fb.where('listId', '==', lid), fb.where('done', '==', true));
      const snap = await fb.getDocs(q);
      const batch = fb.writeBatch(db);
      snap.forEach((d) => batch.delete(d.ref));
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
  const watch = (fn) => {
    listeners.add(fn);
    queueMicrotask(fn);
    return () => listeners.delete(fn);
  };

  return {
    mode: 'local',

    async getFamily(fid) {
      const f = fam(fid);
      return f ? { id: fid, name: f.name } : null;
    },

    async createFamily(name, firstListName) {
      const fid = randomId();
      const lid = randomId();
      data.families[fid] = { name, lists: { [lid]: { name: firstListName, createdAt: Date.now() } }, items: {} };
      save();
      return fid;
    },

    async renameFamily(fid, name) {
      fam(fid).name = name;
      save();
    },

    subscribeFamily(fid, cb) {
      return watch(() => cb(fam(fid) ? { id: fid, name: fam(fid).name } : null));
    },

    subscribeLists(fid, cb) {
      return watch(() => cb(Object.entries(fam(fid)?.lists || {}).map(([id, l]) => ({ id, ...l }))));
    },

    async addList(fid, name) {
      const lid = randomId();
      fam(fid).lists[lid] = { name, createdAt: Date.now() };
      save();
      return lid;
    },

    async renameList(fid, lid, name) {
      fam(fid).lists[lid].name = name;
      save();
    },

    async deleteList(fid, lid) {
      const f = fam(fid);
      delete f.lists[lid];
      for (const [id, it] of Object.entries(f.items)) if (it.listId === lid) delete f.items[id];
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

    async clearDone(fid, lid) {
      const f = fam(fid);
      for (const [id, it] of Object.entries(f.items)) if (it.listId === lid && it.done) delete f.items[id];
      save();
    },
  };
}
