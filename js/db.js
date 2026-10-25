// Local database: IndexedDB on this device (words + small key/value "meta" store).
// Falls back to localStorage if IndexedDB is unavailable (e.g. some private windows).

const DB_NAME = 'wortschatz-coach';
const VERSION = 1;
let dbPromise;

function openDb() {
  dbPromise ||= new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('words')) db.createObjectStore('words', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const result = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const fallback = {
  read: (key, def) => {
    try {
      const raw = localStorage.getItem(`wc.${key}`);
      return raw == null ? def : JSON.parse(raw);
    } catch {
      return def;
    }
  },
  write: (key, value) => {
    try {
      localStorage.setItem(`wc.${key}`, JSON.stringify(value));
    } catch {
      /* storage full or blocked */
    }
  },
};
let useFallback = false;
let fallbackWords = [];

export async function init() {
  try {
    await openDb();
  } catch {
    useFallback = true;
    fallbackWords = fallback.read('words', []);
  }
  // Ask the browser not to evict our data when the device is low on space.
  navigator.storage?.persist?.().catch(() => {});
  return !useFallback;
}

export async function getAllWords() {
  if (useFallback) return [...fallbackWords];
  return run('words', 'readonly', (s) => s.getAll());
}

export async function putWords(words) {
  if (useFallback) {
    const byId = new Map(fallbackWords.map((w) => [w.id, w]));
    words.forEach((w) => byId.set(w.id, w));
    fallbackWords = [...byId.values()];
    return fallback.write('words', fallbackWords);
  }
  return run('words', 'readwrite', (s) => { words.forEach((w) => s.put(w)); });
}

export async function deleteWords(ids) {
  if (useFallback) {
    fallbackWords = fallbackWords.filter((w) => !ids.includes(w.id));
    return fallback.write('words', fallbackWords);
  }
  return run('words', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); });
}

export async function replaceAllWords(words) {
  if (useFallback) {
    fallbackWords = [...words];
    return fallback.write('words', fallbackWords);
  }
  return run('words', 'readwrite', (s) => { s.clear(); words.forEach((w) => s.put(w)); });
}

export async function getMeta(key, def) {
  if (useFallback) return fallback.read(key, def);
  const value = await run('meta', 'readonly', (s) => s.get(key));
  return value === undefined ? def : value;
}

export async function setMeta(key, value) {
  if (useFallback) return fallback.write(key, value);
  return run('meta', 'readwrite', (s) => { s.put(value, key); });
}
