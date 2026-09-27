// Bundled into public/vendor/firebase.js by `npm run vendor`.
export { initializeApp } from 'firebase/app';
export { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
export {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  getDocs,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
