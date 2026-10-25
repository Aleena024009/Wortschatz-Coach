// Cloud sync with Firebase (free plan): sign in with Google, and your words and
// categories are stored under your account and synced to every device you sign in on.
// Firebase is only loaded when js/firebase-config.js contains your project's config.

import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/11.0.2';
export const configured = !!(firebaseConfig && firebaseConfig.apiKey);

let api = null;

async function load() {
  if (api) return api;
  const [app, auth, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const firebaseApp = app.initializeApp(firebaseConfig);
  const db = fs.initializeFirestore(firebaseApp, {
    // Keeps a local copy so the app opens fast and changes made offline are sent later.
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  api = { auth: auth.getAuth(firebaseApp), authLib: auth, db, fs };
  return api;
}

// Calls onUser(user | null) now and whenever the sign-in state changes.
export async function watchUser(onUser) {
  if (!configured) return;
  const { auth, authLib } = await load();
  authLib.onAuthStateChanged(auth, onUser);
}

export async function signIn() {
  const { auth, authLib } = await load();
  const provider = new authLib.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await authLib.signInWithPopup(auth, provider);
}

export async function signOut() {
  const { auth, authLib } = await load();
  await authLib.signOut(auth);
}

const wordsCol = (uid) => api.fs.collection(api.db, 'users', uid, 'words');
const metaDoc = (uid) => api.fs.doc(api.db, 'users', uid, 'meta', 'settings');

// The cloud record of a word: everything except the per-device recording lookup.
function toCloud(w) {
  const { audio, audioV, ...rest } = w;
  return rest;
}

export async function saveWords(uid, words) {
  const { fs, db } = api;
  // Firestore allows up to 500 writes per batch.
  for (let i = 0; i < words.length; i += 450) {
    const batch = fs.writeBatch(db);
    for (const w of words.slice(i, i + 450)) batch.set(fs.doc(wordsCol(uid), w.id), toCloud(w));
    await batch.commit();
  }
}

export async function saveCategories(uid, categories, updatedAt) {
  await api.fs.setDoc(metaDoc(uid), { categories, categoriesUpdatedAt: updatedAt }, { merge: true });
}

// Live updates. onWords(records, isFirst) gets every changed word; onMeta(meta) the categories.
export function subscribe(uid, onWords, onMeta, onError) {
  const { fs } = api;
  let first = true;
  const stopWords = fs.onSnapshot(wordsCol(uid), (snap) => {
    const records = (first ? snap.docs : snap.docChanges().map((c) => c.doc)).map((d) => ({ ...d.data(), id: d.id }));
    onWords(records, first, snap.metadata.fromCache);
    first = false;
  }, onError);
  const stopMeta = fs.onSnapshot(metaDoc(uid), (snap) => onMeta(snap.data() || {}), onError);
  return () => {
    stopWords();
    stopMeta();
  };
}
