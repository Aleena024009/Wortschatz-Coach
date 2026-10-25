// Merging the word list on this device with the copy in the cloud.
// Every word carries `updatedAt` (ms); the newer copy wins. Removed words are kept
// as `deleted: true` "tombstones" so a removal on one device reaches the others.

import { normalizeKey } from './parser.js';

// Returns { merged, toUpload }: the combined list, and the records the cloud is missing
// or has an older copy of.
export function mergeWords(local, remote, now = Date.now()) {
  const byId = new Map(remote.map((w) => [w.id, w]));
  const upload = new Map();
  for (const l of local) {
    const r = byId.get(l.id);
    if (!r || (l.updatedAt || 0) > (r.updatedAt || 0)) {
      byId.set(l.id, l);
      upload.set(l.id, l);
    }
  }

  // The same word added separately on two devices: keep the earliest, remove the copy.
  const seen = new Set();
  const live = [...byId.values()].filter((w) => !w.deleted).sort((a, b) => (a.added || 0) - (b.added || 0));
  for (const w of live) {
    const key = normalizeKey(w.article, w.german, w.english);
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    const tomb = { ...w, deleted: true, updatedAt: now };
    byId.set(w.id, tomb);
    upload.set(w.id, tomb);
  }
  return { merged: [...byId.values()], toUpload: [...upload.values()] };
}

// Applies one record from the cloud; returns true if it replaced the local copy.
export function isNewer(remote, local) {
  return !local || (remote.updatedAt || 0) > (local.updatedAt || 0);
}
