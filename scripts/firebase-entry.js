// Bundled into public/vendor/firebase.js by `npm run vendor`.
export { initializeApp } from 'firebase/app';
export { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator } from 'firebase/auth';
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
  increment,
  documentId,
  connectFirestoreEmulator,
} from 'firebase/firestore';
export { getMessaging, getToken, deleteToken, isSupported as isMessagingSupported } from 'firebase/messaging';
