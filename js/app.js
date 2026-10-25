import { CEFR, parseWordList, normalizeKey, uniqueTextWords, looksLikeProse, splitArticle, guessPos, stripNumbering } from './parser.js';
import { respell } from './respell.js';
import * as speech from './speech.js';
import * as audio from './audio.js';
import * as db from './db.js';
import * as hd from './hd-voice.js';
import * as cloud from './cloud.js';
import { mergeWords, isNewer } from './sync.js';

const SETTINGS_KEY = 'wc.settings.v1';
const FILL_BATCH = 120;
const EXTRACT_BATCH = 80;
const POS = ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'article', 'numeral', 'interjection', 'phrase', 'other'];
const DEFAULT_CATEGORIES = ['A1', 'A2', 'B1', 'B2'].map((name, i) => ({ name, color: i + 1 }));
const COLOR_COUNT = 10;
// Bump to re-check recordings for words whose earlier lookup found nothing.
const AUDIO_LOOKUP_VERSION = 2;
// Recordings are spoken at natural speed, so "Normal" plays them unchanged.
const RECORDING_RATE = { 0.6: 0.75, 0.85: 1, 1: 1.15 };

const EXAMPLES = [
  { id: 'ex1', article: 'die', german: 'Schwester', english: 'sister', level: 'A1', pos: 'noun', ipa: 'ˈʃvɛstɐ', respelling: 'SHVES-tuh', example: 'Meine Schwester wohnt in Berlin.' },
  { id: 'ex2', article: '', german: 'gehen', english: 'to go', level: 'A1', pos: 'verb', ipa: 'ˈɡeːən', respelling: 'GAY-un', example: 'Wir gehen heute ins Kino.' },
  { id: 'ex3', article: 'das', german: 'Frühstück', english: 'breakfast', level: 'A1', pos: 'noun', ipa: 'ˈfʁyːʃtʏk', respelling: 'FREW-shtewk', example: 'Das Frühstück ist fertig.' },
  { id: 'ex4', article: 'die', german: 'Erfahrung', english: 'experience', level: 'A2', pos: 'noun', ipa: 'ɛɐ̯ˈfaːʁʊŋ', respelling: 'air-FAH-roong', example: 'Das war eine gute Erfahrung.' },
  { id: 'ex5', article: '', german: 'sich beschweren', english: 'to complain', level: 'B1', pos: 'verb', ipa: 'zɪç bəˈʃveːʁən', respelling: 'zikh buh-SHVAY-run', example: 'Er beschwert sich über den Lärm.' },
  { id: 'ex6', article: 'die', german: 'Umwelt', english: 'environment', level: 'B2', pos: 'noun', ipa: 'ˈʊmvɛlt', respelling: 'OOM-velt', example: 'Wir müssen die Umwelt schützen.' },
];

const ICONS = {
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

// ---------- state ----------

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

const settings = Object.assign(
  { voiceURI: '', rate: 0.85, source: 'recording', theme: 'auto', filter: 'all', addCategory: 'A1', aiEndpoint: '', aiPasscode: '' },
  loadSettings(),
);
const state = {
  words: [],
  categories: [],
  view: 'words',
  search: '',
  reading: false,
  busy: false,
  voicesReady: false,
  recent: [],
  tombstones: [], // removed words, kept so the removal syncs to your other devices
  catsUpdatedAt: 0,
  user: null,
  unsubscribe: null,
  syncStatus: '',
  hd: { ready: false, progress: null },
  fc: { order: [], index: 0, revealed: false },
};
let dbOk = false;

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* per-device convenience only */
  }
}

// Every database write goes through here so a failure is visible instead of silent.
function persist(promise) {
  promise.catch(() => toast('Could not save to this device. Storage may be full or blocked.'));
}

const sortWords = () => state.words.sort((a, b) => (b.added || 0) - (a.added || 0));
// Cloud writes report problems in the sync status instead of a toast.
function cloudSave(promise) {
  promise.then(() => {}, (err) => setSyncStatus(`Could not sync: ${err.code || err.message}`));
}

function saveCategories() {
  state.catsUpdatedAt = Date.now();
  persist(db.setMeta('categories', state.categories));
  persist(db.setMeta('categoriesUpdatedAt', state.catsUpdatedAt));
  if (state.user) cloudSave(cloud.saveCategories(state.user.uid, state.categories, state.catsUpdatedAt));
}

// Saves changed words on this device and, when signed in, to your account.
function saveWords(words) {
  if (!words.length) return;
  const now = Date.now();
  words.forEach((w) => { w.updatedAt = now; });
  persist(db.putWords(words));
  if (state.user) cloudSave(cloud.saveWords(state.user.uid, words));
}

// ---------- helpers ----------

const $ = (id) => document.getElementById(id);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'icon') el.innerHTML = ICONS[v];
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const fullGerman = (w) => (w.article ? `${w.article} ${w.german}` : w.german);
const formatIpa = (ipa) => (/^[/[]/.test(ipa) ? ipa : `/${ipa}/`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const categoryNames = () => state.categories.map((c) => c.name);
const hasGermanVoice = () => speech.germanVoices().length > 0;

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

let toastTimer;
function toast(message, actionLabel, action) {
  const el = $('toast');
  el.replaceChildren(h('span', {}, message));
  if (actionLabel) el.append(h('button', { onclick: () => { action(); el.hidden = true; } }, actionLabel));
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

// ---------- sound ----------

const voiceOpts = () => ({ voiceURI: settings.voiceURI, rate: settings.rate });
const rateFor = () => RECORDING_RATE[settings.rate] || 1;

// Shows under a word where the sound you just heard came from.
function showSource(el, source) {
  if (!el) return;
  el.replaceChildren(source.href
    ? h('a', { href: source.href, target: '_blank', rel: 'noopener' }, source.label)
    : source.label);
  el.hidden = false;
}

function browserVoiceName() {
  const voices = speech.germanVoices();
  return (voices.find((v) => v.voiceURI === settings.voiceURI) || voices[0])?.name || 'German';
}

// Speaks German text with a computer voice: the downloaded open-source voice if you
// installed it, otherwise the browser's own German voice. Returns the source, or null.
async function speakText(text) {
  audio.stop();
  speech.stop();
  if (state.hd.ready) {
    await audio.play(await hd.speakBlob(text), rateFor());
    return { label: 'Computer voice: Thorsten (open-source, runs on this device)' };
  }
  if (hasGermanVoice()) {
    speech.speak(text, voiceOpts());
    return { label: `Computer voice: ${browserVoiceName()} (built into your browser)` };
  }
  return null;
}

function offerVoiceDownload() {
  if (state.hd.ready || state.hd.progress !== null) {
    toast('Could not play this. Please try again.');
    return;
  }
  toast(`This browser has no German voice. Get the free one (${hd.MODEL_SIZE_MB} MB, once)?`, 'Download', () => {
    setView('settings');
    downloadHd();
  });
}

// Sentences: always a computer voice.
async function say(text, sourceEl) {
  try {
    const source = await speakText(text);
    if (source) showSource(sourceEl, source);
    else offerVoiceDownload();
  } catch (err) {
    toast(`Could not speak: ${err.message}`);
  }
}

async function playRecording(w, btn, sourceEl) {
  if (!navigator.onLine) return false;
  if (w.audio === undefined || (!w.audio && w.audioV !== AUDIO_LOOKUP_VERSION)) {
    btn?.classList.add('loading');
    try {
      w.audio = await audio.findRecording(fullGerman(w));
      w.audioV = AUDIO_LOOKUP_VERSION;
      // Only stored on this device: it is just a lookup cache, not your data.
      if (!w.id.startsWith('ex')) persist(db.putWords([w]));
    } catch {
      /* lookup failed (network); try again next time */
    }
    btn?.classList.remove('loading');
  }
  if (!w.audio) return false;
  try {
    speech.stop();
    await audio.play(w.audio, rateFor());
    showSource(sourceEl, { label: 'Native speaker recording (Wiktionary) · who recorded it', href: audio.recordingPage(w.audio) });
    return true;
  } catch {
    return false;
  }
}

async function playComputerVoice(w, btn, sourceEl) {
  btn?.classList.add('loading');
  try {
    const source = await speakText(fullGerman(w));
    if (source) showSource(sourceEl, source);
    return !!source;
  } catch (err) {
    toast(`Could not speak: ${err.message}`);
    return false;
  } finally {
    btn?.classList.remove('loading');
  }
}

// Single words: your preferred source first, then the other one.
async function playWord(w, btn, sourceEl) {
  const order = settings.source === 'recording' ? [playRecording, playComputerVoice] : [playComputerVoice, playRecording];
  for (const play of order) if (await play(w, btn, sourceEl)) return;
  offerVoiceDownload();
}

// ---------- categories ----------

function colorOf(level) {
  const cat = state.categories.find((c) => c.name === level);
  if (cat) return cat.color;
  const cefr = CEFR.indexOf(level);
  return cefr >= 0 ? cefr + 1 : 0;
}
const colorClass = (level) => (colorOf(level) ? `cat${colorOf(level)}` : '');

function nextColor(name) {
  const cefr = CEFR.indexOf(name);
  if (cefr >= 0) return cefr + 1;
  const used = new Set(state.categories.map((c) => c.color));
  for (let c = 7; c <= COLOR_COUNT; c++) if (!used.has(c)) return c;
  for (let c = 1; c <= COLOR_COUNT; c++) if (!used.has(c)) return c;
  return 7 + (state.categories.length % 4);
}

// Adds categories that don't exist yet; returns the names that were added.
function ensureCategories(names) {
  const added = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) continue;
    state.categories.push({ name, color: nextColor(name) });
    added.push(name);
  }
  if (added.length) {
    // CEFR levels first in order, then your own categories in the order you made them.
    state.categories.sort((a, b) => {
      const ia = CEFR.indexOf(a.name);
      const ib = CEFR.indexOf(b.name);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return 0;
    });
    saveCategories();
  }
  return added;
}

function addCategoryByName(raw) {
  const trimmed = (raw || '').trim().slice(0, 30);
  if (!trimmed) return '';
  const name = CEFR.find((c) => c.toLowerCase() === trimmed.toLowerCase()) || trimmed;
  const added = ensureCategories([name]);
  toast(added.length ? `Added category “${name}”.` : `“${name}” already exists.`);
  return state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase())?.name || '';
}

function deleteCategory(name) {
  const affected = state.words.filter((w) => w.level === name);
  const question = affected.length
    ? `Delete category “${name}”? Its ${plural(affected.length, 'word')} will stay in your list with no category.`
    : `Delete category “${name}”?`;
  if (!confirm(question)) return;
  state.categories = state.categories.filter((c) => c.name !== name);
  affected.forEach((w) => { w.level = ''; });
  saveCategories();
  saveWords(affected);
  if (settings.filter === name) settings.filter = 'all';
  if (settings.addCategory === name) settings.addCategory = state.categories[0]?.name || '';
  saveSettings();
  refresh();
}

// ---------- filtering ----------

const showingExamples = () => state.words.length === 0;
const visibleSource = () => (showingExamples() ? EXAMPLES : state.words);

function inCategory(list) {
  if (settings.filter === 'all') return list;
  if (settings.filter === 'none') return list.filter((w) => !w.level);
  return list.filter((w) => w.level === settings.filter);
}

function searched(list) {
  const q = state.search.trim().toLowerCase();
  if (!q) return list;
  return list.filter((w) => fullGerman(w).toLowerCase().includes(q) || w.english.toLowerCase().includes(q));
}

function renderCatTabs(container) {
  const list = visibleSource();
  const noLevel = list.filter((w) => !w.level).length;
  const names = categoryNames();
  if ((settings.filter === 'none' && !noLevel) || (!['all', 'none'].includes(settings.filter) && !names.includes(settings.filter))) {
    settings.filter = 'all';
  }
  const tabs = [['all', 'All', list.length, ''], ...state.categories.map((c) => [c.name, c.name, list.filter((w) => w.level === c.name).length, `cat${c.color}`])];
  if (noLevel) tabs.push(['none', 'No level', noLevel, '']);
  container.replaceChildren(
    ...tabs.map(([value, label, count, color]) =>
      h('button', {
        class: `cat-tab ${color}`,
        'aria-pressed': String(settings.filter === value),
        onclick: () => {
          settings.filter = value;
          saveSettings();
          state.fc.index = 0;
          refresh();
        },
      },
      color ? h('span', { class: 'dot' }) : null,
      label,
      h('span', { class: 'count' }, String(count))),
    ),
  );
}

// ---------- word cards ----------

function respellingEl(w) {
  if (w.respelling) return h('span', { class: 'respell', title: 'Say it like this. Capitals = stressed syllable.' }, w.respelling);
  const guess = respell(fullGerman(w));
  if (!guess) return null;
  return h('span', { class: 'respell auto', title: 'Automatic guess, may be wrong. Capitals = stressed syllable.' }, guess);
}

function soundRow(w) {
  const parts = [respellingEl(w), w.ipa ? h('span', { class: 'ipa' }, formatIpa(w.ipa)) : null].filter(Boolean);
  return parts.length ? h('div', { class: 'sound' }, parts) : null;
}

function exampleRow(w, sourceEl) {
  if (!w.example) return null;
  return h('div', { class: 'sentence' },
    h('span', { lang: 'de' }, w.example),
    h('button', { class: 'icon-btn small', icon: 'play', 'aria-label': 'Play example sentence', onclick: () => say(w.example, sourceEl) }),
  );
}

function playButton(w, sourceEl) {
  const btn = h('button', { class: 'icon-btn play', icon: 'speaker', 'aria-label': `Say ${fullGerman(w)}` });
  btn.addEventListener('click', () => playWord(w, btn, sourceEl));
  return btn;
}

const sourceLine = () => h('div', { class: 'source', hidden: true, 'aria-live': 'polite' });

function levelSelect(w) {
  const names = categoryNames();
  const options = [...names, ...(w.level && !names.includes(w.level) ? [w.level] : [])];
  return h('select', {
    class: `badge ${colorClass(w.level)}`,
    'aria-label': `Category of ${fullGerman(w)}`,
    title: 'Move to another category',
    onchange: (e) => {
      w.level = e.target.value;
      saveWords([w]);
      refresh();
    },
  },
  ...options.map((name) => h('option', { value: name, selected: name === w.level }, name)),
  h('option', { value: '', selected: !w.level }, 'No level'));
}

function wordCard(w, isExample) {
  const source = sourceLine();
  return h('li', { class: `card ${colorClass(w.level)}${isExample ? ' example' : ''}` },
    h('div', { class: 'card-head' },
      h('div', { class: 'text' },
        h('div', { class: 'word', lang: 'de' }, w.article ? h('span', { class: 'article' }, w.article) : null, w.german),
        h('div', { class: 'english' }, w.english),
      ),
      playButton(w, source),
    ),
    soundRow(w),
    source,
    exampleRow(w, source),
    h('div', { class: 'card-foot' },
      isExample
        ? h('span', { class: `badge ${colorClass(w.level)}` }, w.level)
        : levelSelect(w),
      w.pos ? h('span', { class: 'pos' }, w.pos) : null,
      isExample ? h('span', { class: 'tag' }, 'Example') : null,
      h('span', { class: 'spacer' }),
      isExample ? null : h('button', { class: 'icon-btn small remove', icon: 'trash', 'aria-label': `Remove ${fullGerman(w)}`, onclick: () => removeWord(w.id) }),
    ),
  );
}

function removeWord(id) {
  const index = state.words.findIndex((w) => w.id === id);
  if (index < 0) return;
  const [removed] = state.words.splice(index, 1);
  removed.deleted = true;
  state.tombstones.push(removed);
  saveWords([removed]);
  refresh();
  toast(`Removed “${removed.german}”`, 'Undo', () => {
    removed.deleted = false;
    state.tombstones = state.tombstones.filter((t) => t !== removed);
    state.words.push(removed);
    sortWords();
    saveWords([removed]);
    refresh();
  });
}

function renderVoiceBanner() {
  const banner = $('voice-banner');
  banner.hidden = !state.voicesReady || hasGermanVoice() || state.hd.ready;
  if (banner.hidden) return;
  const downloading = state.hd.progress !== null;
  banner.replaceChildren(
    h('div', {},
      h('strong', {}, 'This browser has no German voice. '),
      downloading
        ? `Downloading the free German voice… ${Math.round(state.hd.progress * 100)}%`
        : `Most single words still play native-speaker recordings. To hear every word and sentence, download the free German voice (${hd.MODEL_SIZE_MB} MB, once).`),
    downloading ? null : h('div', { class: 'actions' },
      h('button', { class: 'btn primary small', onclick: downloadHd }, 'Download voice'),
      h('button', { class: 'btn small', onclick: () => setView('settings') }, 'Options'),
    ),
  );
}

// ---------- free German voice ----------

let lastPercent = -1;
function renderVoiceUi() {
  if (state.view === 'settings') renderHdBox();
  if (state.view === 'words') renderVoiceBanner();
}

async function downloadHd() {
  if (state.hd.progress !== null || state.hd.ready) return;
  state.hd.progress = 0;
  renderVoiceUi();
  try {
    await hd.download((loaded, total) => {
      state.hd.progress = total ? loaded / total : 0;
      const percent = Math.floor(state.hd.progress * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        renderVoiceUi();
      }
    });
    state.hd.ready = true;
    toast('German voice installed. Every word and sentence can be spoken now.');
    hd.warmUp().catch(() => {});
  } catch (err) {
    toast(`Download failed: ${err.message}. Check your internet and try again.`);
  } finally {
    state.hd.progress = null;
    renderVoiceUi();
  }
}

async function removeHd() {
  if (!confirm('Remove the German voice from this device? You can download it again any time.')) return;
  await hd.remove();
  state.hd.ready = false;
  renderVoiceUi();
}

function renderHdBox() {
  const box = $('hd-box');
  if (state.hd.ready) {
    box.replaceChildren(
      h('p', {}, h('span', { class: 'ok' }, '✓ Free German voice installed. '), 'Every word and sentence can be spoken, also offline. It is "Thorsten", an open-source voice that runs on this device.'),
      h('button', { class: 'btn small', onclick: removeHd }, `Remove (frees ${hd.MODEL_SIZE_MB} MB)`),
    );
  } else if (state.hd.progress !== null) {
    const pct = Math.round(state.hd.progress * 100);
    box.replaceChildren(
      h('p', { class: 'status' }, `Downloading the German voice… ${pct}%`),
      h('div', { class: 'progress-bar' }, h('span', { style: `width: ${pct}%` })),
      h('p', { class: 'hint' }, 'Keep this page open until it finishes.'),
    );
  } else {
    box.replaceChildren(
      h('p', {}, h('strong', {}, 'Free German voice for every word and sentence. '),
        `Works in every browser (also Brave and Firefox), and offline once downloaded. Download once: ${hd.MODEL_SIZE_MB} MB.`),
      hasGermanVoice() ? h('p', { class: 'hint' }, `Your browser already has a German voice (${browserVoiceName()}), so this is optional.`) : null,
      h('button', { class: 'btn primary', onclick: downloadHd }, `Download German voice (${hd.MODEL_SIZE_MB} MB)`),
    );
  }
}

// ---------- sync across devices ----------

function setSyncStatus(text) {
  state.syncStatus = text;
  if (state.view === 'settings') renderSyncBox();
}

function signInError(err) {
  if (err.code === 'auth/unauthorized-domain') return `Sign-in is not allowed on ${location.hostname} yet. Add it in Firebase → Authentication → Settings → Authorized domains.`;
  if (err.code === 'auth/popup-blocked') return 'The sign-in window was blocked. Allow pop-ups for this site and try again.';
  return `Could not sign in: ${err.code || err.message}`;
}

function renderSyncBox() {
  const box = $('sync-box');
  if (!cloud.configured) {
    box.replaceChildren(h('div', { class: 'sync-card' },
      h('p', {}, h('strong', {}, 'Your words are saved on this device only. '),
        'To have them on every phone, PC and browser, cloud sync needs a free Firebase project (one-time setup, about 10 minutes). The steps are in the README under “Cloud sync”.'),
      h('p', { class: 'hint' }, 'Until then, use Export backup / Import backup below to move your words.'),
    ));
    return;
  }
  if (!state.user) {
    box.replaceChildren(h('div', { class: 'sync-card' },
      h('p', {}, 'Sign in to keep your words on all your devices. Sign in with the same Google account on your phone and PC, and your list is the same everywhere.'),
      h('button', { class: 'btn primary', onclick: () => cloud.signIn().catch((err) => { if (err.code !== 'auth/popup-closed-by-user') toast(signInError(err)); }) }, 'Sign in with Google'),
    ));
    return;
  }
  box.replaceChildren(h('div', { class: 'sync-card' },
    h('p', {}, h('span', { class: 'ok' }, '✓ Syncing '), `as ${state.user.email || state.user.displayName || 'you'}. Changes appear on your other devices automatically.`),
    state.syncStatus ? h('p', { class: 'hint' }, state.syncStatus) : null,
    h('button', { class: 'btn small', onclick: () => cloud.signOut() }, 'Sign out'),
  ));
}

// Replaces the in-memory list with `records` (live words and removed ones).
function applyRecords(records) {
  state.words = records.filter((w) => !w.deleted);
  state.tombstones = records.filter((w) => w.deleted);
  sortWords();
  ensureCategories(state.words.map((w) => w.level).filter(Boolean));
  refresh();
}

function onCloudWords(records, isFirst, fromCache) {
  const all = new Map([...state.words, ...state.tombstones].map((w) => [w.id, w]));
  let local;
  let remote;
  if (isFirst) {
    local = [...all.values()];
    remote = records;
  } else {
    // Keep this device's recording lookup when a newer copy arrives.
    const changed = records.filter((r) => isNewer(r, all.get(r.id)));
    if (!changed.length) return;
    for (const r of changed) {
      const old = all.get(r.id);
      all.set(r.id, old ? { ...r, audio: old.audio, audioV: old.audioV } : r);
    }
    local = [];
    remote = [...all.values()];
  }
  const { merged, toUpload } = mergeWords(local, remote);
  applyRecords(merged);
  persist(db.replaceAllWords(merged));
  if (toUpload.length) cloudSave(cloud.saveWords(state.user.uid, toUpload));
  setSyncStatus(fromCache ? 'Offline: changes will sync when you are back online.' : `Up to date · ${plural(state.words.length, 'word')} in your account.`);
}

function onCloudMeta(meta) {
  const remoteAt = meta.categoriesUpdatedAt || 0;
  if (Array.isArray(meta.categories) && remoteAt > state.catsUpdatedAt) {
    state.categories = meta.categories;
    state.catsUpdatedAt = remoteAt;
    persist(db.setMeta('categories', state.categories));
    persist(db.setMeta('categoriesUpdatedAt', remoteAt));
    refresh();
  } else if (state.catsUpdatedAt > remoteAt) {
    cloudSave(cloud.saveCategories(state.user.uid, state.categories, state.catsUpdatedAt));
  }
}

function onUserChanged(user) {
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.user = user;
  state.syncStatus = user ? 'Syncing…' : '';
  if (user) {
    state.unsubscribe = cloud.subscribe(user.uid, onCloudWords, onCloudMeta, (err) => setSyncStatus(`Could not sync: ${err.code || err.message}`));
  }
  if (state.view === 'settings') renderSyncBox();
}

// ---------- appearance ----------

function applyTheme() {
  const choice = settings.theme;
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  const dark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0f1513' : '#f4f2ec'));
  document.querySelectorAll('#theme-group button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === choice)));
}

function setTheme(choice) {
  settings.theme = choice;
  saveSettings();
  applyTheme();
}

function renderWords() {
  renderVoiceBanner();
  renderCatTabs($('cat-tabs'));
  $('examples-note').hidden = !showingExamples();
  const list = searched(inCategory(visibleSource()));
  const emptyText = state.search ? `No words match “${state.search}”.` : 'No words in this category yet.';
  $('word-list').replaceChildren(
    ...(list.length ? list.map((w) => wordCard(w, showingExamples())) : [h('li', { class: 'empty' }, emptyText)]),
  );
}

// ---------- add ----------

function renderAdd() {
  if (!categoryNames().includes(settings.addCategory)) settings.addCategory = state.categories[0]?.name || '';
  $('cat-picker').replaceChildren(
    ...state.categories.map((c) =>
      h('button', {
        class: `cat-option cat${c.color}`,
        role: 'radio',
        'aria-checked': String(settings.addCategory === c.name),
        onclick: () => {
          settings.addCategory = c.name;
          saveSettings();
          renderAdd();
        },
      }, c.name),
    ),
    h('button', {
      class: 'cat-option new',
      onclick: () => {
        const name = addCategoryByName(prompt('Name of the new category (e.g. C1 or Travel):'));
        if (name) {
          settings.addCategory = name;
          saveSettings();
        }
        refresh();
      },
    }, '+ New'),
  );
  $('single-submit').textContent = settings.addCategory ? `Add to ${settings.addCategory}` : 'Add word';
  $('recent').replaceChildren(...state.recent.map((r) => h('li', {}, r)));
}

function addWords(items) {
  const existing = new Set(state.words.map((w) => normalizeKey(w.article, w.german)));
  const fresh = [];
  let duplicates = 0;
  const now = Date.now();
  for (const item of items) {
    const key = normalizeKey(item.article, item.german);
    if (!item.german || existing.has(key)) {
      duplicates++;
      continue;
    }
    existing.add(key);
    // Earlier lines get a slightly newer timestamp so a pasted list keeps its order at the top.
    fresh.push({ ipa: '', respelling: '', example: '', pos: '', level: '', ...item, id: uid(), added: now - fresh.length });
  }
  ensureCategories(fresh.map((w) => w.level).filter(Boolean));
  state.words.push(...fresh);
  sortWords();
  saveWords(fresh);
  refresh();
  return { added: fresh.length, duplicates };
}

function addSingle(e) {
  e.preventDefault();
  const germanIn = $('in-german');
  const englishIn = $('in-english');
  const exampleIn = $('in-example');
  const { article, german } = splitArticle(germanIn.value.trim().replace(/\s+/g, ' '));
  const english = englishIn.value.trim();
  if (!german || !english) return;
  const { added } = addWords([{
    article, german, english,
    example: exampleIn.value.trim(),
    level: settings.addCategory,
    pos: guessPos(article, german, english),
  }]);
  const label = article ? `${article} ${german}` : german;
  if (added) {
    $('single-msg').textContent = `Added “${label}” to ${settings.addCategory || 'your list'}.`;
    state.recent.unshift(`${label} → ${settings.addCategory || 'No level'}`);
    state.recent = state.recent.slice(0, 8);
    germanIn.value = '';
    englishIn.value = '';
    exampleIn.value = '';
  } else {
    $('single-msg').textContent = `“${label}” is already in your list.`;
  }
  renderAdd();
  germanIn.focus();
}

function addFromDraft() {
  const text = $('draft').value;
  const parsed = parseWordList(text, categoryNames(), settings.addCategory);
  ensureCategories(parsed.newCategories);
  const { added, duplicates } = addWords(parsed.words);
  const parts = [`Added ${plural(added, 'word')}.`];
  if (parsed.newCategories.length) parts.push(`New categories: ${parsed.newCategories.join(', ')}.`);
  if (duplicates) parts.push(`Skipped ${duplicates} already in your list.`);
  if (parsed.unparsed.length) parts.push(`${plural(parsed.unparsed.length, 'line')} not understood.`);
  $('add-msg').textContent = text.trim() ? parts.join(' ') : 'Paste or upload a list first.';
  $('extract-offer').hidden = !looksLikeProse(parsed);
}

let draftTimer;
function saveDraftSoon() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => persist(db.setMeta('draft', $('draft').value)), 300);
}

function stopReading() {
  state.reading = false;
  speech.stop();
  audio.stop();
  $('read-btn').textContent = 'Read text aloud';
}

async function toggleReadAloud() {
  if (state.reading) {
    stopReading();
    return;
  }
  const text = $('draft').value.trim();
  if (!text) {
    $('add-msg').textContent = 'Paste some text first.';
    return;
  }
  if (!state.hd.ready && !hasGermanVoice()) {
    offerVoiceDownload();
    return;
  }
  state.reading = true;
  $('read-btn').textContent = 'Stop';
  try {
    if (state.hd.ready) {
      // Prepare the next sentence while the current one plays.
      const chunks = speech.splitText(text);
      let next = hd.speakBlob(chunks[0]);
      for (let i = 0; i < chunks.length && state.reading; i++) {
        const blob = await next;
        next = i + 1 < chunks.length ? hd.speakBlob(chunks[i + 1]) : null;
        if (!state.reading) break;
        await audio.playUntilEnd(blob, rateFor());
      }
      next?.catch(() => {});
    } else {
      await new Promise((resolve) => speech.speakLong(text, voiceOpts(), resolve));
    }
  } catch (err) {
    toast(`Could not read the text: ${err.message}`);
  } finally {
    stopReading();
  }
}

// ---------- practice ----------

function buildDeck() {
  const ids = inCategory(visibleSource()).map((w) => w.id);
  const keep = state.fc.order.filter((id) => ids.includes(id));
  state.fc.order = keep.length === ids.length ? keep : ids;
  state.fc.index = Math.min(state.fc.index, Math.max(0, state.fc.order.length - 1));
}

function currentCard() {
  return visibleSource().find((x) => x.id === state.fc.order[state.fc.index]);
}

function renderPractice() {
  renderCatTabs($('cat-tabs-practice'));
  const el = $('flashcard');
  const { order, index, revealed } = state.fc;
  const w = currentCard();
  ['fc-prev', 'fc-next', 'fc-shuffle'].forEach((id) => { $(id).disabled = order.length < 2; });
  el.className = `flashcard ${w ? colorClass(w.level) : ''}`;
  if (!w) {
    el.replaceChildren(h('p', { class: 'empty' }, 'No words in this category yet.'));
    return;
  }
  const source = sourceLine();
  el.replaceChildren(
    h('div', { class: 'progress' }, `${index + 1} / ${order.length}${showingExamples() ? ' · Examples' : ''}`),
    h('span', { class: `badge ${colorClass(w.level)}` }, w.level || 'No level'),
    h('div', { class: 'word', lang: 'de' }, w.article ? h('span', { class: 'article' }, w.article) : null, w.german),
    playButton(w, source),
    source,
    revealed
      ? h('div', { class: 'answer' }, soundRow(w), h('div', { class: 'english' }, w.english), exampleRow(w, source))
      : h('button', { class: 'btn', onclick: reveal }, 'Show answer'),
  );
}

function reveal() {
  state.fc.revealed = true;
  renderPractice();
}

function stepCard(delta) {
  const n = state.fc.order.length;
  if (!n) return;
  state.fc.index = (state.fc.index + delta + n) % n;
  state.fc.revealed = false;
  renderPractice();
}

function shuffleDeck() {
  const a = state.fc.order;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  state.fc.index = 0;
  state.fc.revealed = false;
  renderPractice();
}

// ---------- settings ----------

function renderSettings() {
  $('cat-list').replaceChildren(
    ...state.categories.map((c) =>
      h('li', {},
        h('span', { class: `badge cat${c.color}` }, c.name),
        h('span', { class: 'count' }, plural(state.words.filter((w) => w.level === c.name).length, 'word')),
        h('button', { class: 'icon-btn small remove', icon: 'close', 'aria-label': `Delete category ${c.name}`, onclick: () => deleteCategory(c.name) }),
      ),
    ),
  );
  $('storage-msg').textContent = state.user
    ? `${plural(state.words.length, 'word')} saved on this device and in your account.`
    : `${plural(state.words.length, 'word')} saved on this device${dbOk ? ' (IndexedDB)' : ''}. Clearing browser data deletes them, so sign in to sync or export a backup now and then.`;
  renderSegmented();
  renderHdBox();
  renderSyncBox();
  applyTheme();
}

function renderVoices() {
  const select = $('voice-select');
  const voices = speech.germanVoices();
  const options = [h('option', { value: '' }, voices.length ? 'Automatic (German)' : 'No German voice in this browser')];
  for (const v of voices) {
    options.push(h('option', { value: v.voiceURI, selected: v.voiceURI === settings.voiceURI }, `${v.name} (${v.lang})${v.localService ? '' : ' · online'}`));
  }
  select.replaceChildren(...options);
  select.disabled = !voices.length;
  $('test-voice').disabled = !speech.hasAnyVoice();
  if (!voices.some((v) => v.voiceURI === settings.voiceURI)) select.value = '';
}

function renderSegmented() {
  document.querySelectorAll('#speed-group button').forEach((b) => {
    b.setAttribute('aria-checked', String(Number(b.dataset.rate) === settings.rate));
  });
  document.querySelectorAll('#source-group button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.source === settings.source));
  });
}

// ---------- views ----------

function render() {
  if (state.view === 'words') renderWords();
  else if (state.view === 'add') renderAdd();
  else if (state.view === 'practice') renderPractice();
  else renderSettings();
}

function refresh() {
  buildDeck();
  render();
}

function setView(view) {
  state.view = view;
  if (state.reading) stopReading();
  speech.stop();
  audio.stop();
  document.querySelectorAll('.nav button').forEach((b) => {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  for (const v of ['words', 'add', 'practice', 'settings']) $(`view-${v}`).hidden = v !== view;
  if (view === 'practice') state.fc.revealed = false;
  refresh();
  window.scrollTo(0, 0);
}

// ---------- backup ----------

function exportBackup() {
  const words = state.words.map(({ audio: _audio, ...w }) => w);
  const data = { app: 'wortschatz-coach', version: 1, exported: new Date().toISOString(), categories: state.categories, words };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: `wortschatz-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'wortschatz-coach' || !Array.isArray(data.words)) throw new Error('bad file');
    ensureCategories((data.categories || []).map((c) => String(c.name || '')));
    const items = data.words
      .filter((w) => w && typeof w.german === 'string' && typeof w.english === 'string')
      .map(({ id, added, audio: _audio, ...w }) => w);
    const { added, duplicates } = addWords(items);
    toast(`Imported ${plural(added, 'word')}${duplicates ? `, skipped ${duplicates} duplicates` : ''}.`);
  } catch {
    toast('That file is not a Wortschatz Coach backup.');
  }
}

// ---------- optional AI ----------

async function callAI(payload) {
  const headers = { 'content-type': 'application/json' };
  if (settings.aiPasscode) headers['x-app-passcode'] = settings.aiPasscode;
  let res;
  try {
    res = await fetch(settings.aiEndpoint.trim() || 'api/enrich', { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch {
    throw new Error(navigator.onLine ? 'Could not reach the AI endpoint. Is it set up? See the README.' : 'You are offline.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    if ([404, 405, 501].includes(res.status)) throw new Error('No AI endpoint at this address. The AI part is optional; see the README to set it up.');
    if (res.status === 401) throw new Error('Wrong or missing passcode.');
    throw new Error(data?.error || `AI request failed (HTTP ${res.status}).`);
  }
  return data;
}

function setBusy(busy) {
  state.busy = busy;
  ['fill-btn', 'extract-btn'].forEach((id) => { $(id).disabled = busy; });
}

async function fillMissing() {
  if (state.busy) return;
  const msg = $('ai-msg');
  const targets = state.words.filter((w) => !w.level || !w.respelling || !w.ipa);
  if (!targets.length) {
    msg.textContent = state.words.length ? 'Every word already has a level, IPA and respelling.' : 'Add some words first.';
    return;
  }
  setBusy(true);
  const batches = chunk(targets, FILL_BATCH);
  let updated = 0;
  try {
    for (const [i, batch] of batches.entries()) {
      msg.textContent = `Asking AI… batch ${i + 1} of ${batches.length} (${batch.length} words)`;
      const data = await callAI({
        mode: 'fill',
        words: batch.map((w) => ({ id: w.id, german: fullGerman(w), english: w.english })),
      });
      const changed = [];
      for (const item of data.items || []) {
        const w = state.words.find((x) => x.id === item.id);
        if (!w) continue;
        const before = JSON.stringify(w);
        // Never overwrite something the user gave.
        if (!w.level && CEFR.includes(item.level)) w.level = item.level;
        if (!w.respelling && item.respelling) w.respelling = item.respelling;
        if (!w.ipa && item.ipa) w.ipa = item.ipa;
        if (!w.pos && POS.includes(item.pos)) w.pos = item.pos;
        if (JSON.stringify(w) !== before) changed.push(w);
      }
      ensureCategories(changed.map((w) => w.level).filter(Boolean));
      saveWords(changed);
      updated += changed.length;
      refresh();
    }
    msg.textContent = `Done. Updated ${plural(updated, 'word')}.`;
  } catch (err) {
    msg.textContent = `${err.message}${updated ? ` (${plural(updated, 'word')} updated before the error.)` : ''}`;
  } finally {
    setBusy(false);
  }
}

async function extractWords() {
  if (state.busy) return;
  const msg = $('add-msg');
  const text = parseWordList($('draft').value, categoryNames()).unparsed.join('\n');
  const known = new Set(state.words.map((w) => w.german.toLowerCase()));
  const tokens = uniqueTextWords(text).filter((t) => !known.has(t.toLowerCase()));
  if (!tokens.length) {
    msg.textContent = 'No new words found in the text.';
    return;
  }
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  setBusy(true);
  const batches = chunk(tokens, EXTRACT_BATCH);
  let added = 0;
  try {
    for (const [i, batch] of batches.entries()) {
      msg.textContent = `Extracting with AI… batch ${i + 1} of ${batches.length}`;
      const wanted = new Set(batch.map((t) => t.toLowerCase()));
      const context = sentences
        .filter((s) => uniqueTextWords(s).some((t) => wanted.has(t.toLowerCase())))
        .join('\n')
        .slice(0, 4000);
      const data = await callAI({ mode: 'extract', words: batch, context });
      const items = (data.items || []).map((it) => ({
        german: String(it.german || '').trim(),
        article: ['der', 'die', 'das'].includes(it.article) ? it.article : '',
        english: String(it.english || '').trim(),
        level: CEFR.includes(it.level) ? it.level : '',
        pos: POS.includes(it.pos) ? it.pos : '',
        ipa: String(it.ipa || ''),
        respelling: String(it.respelling || ''),
        example: String(it.example || ''),
      }));
      added += addWords(items).added;
    }
    msg.textContent = `Added ${plural(added, 'word')} from your text.`;
    $('extract-offer').hidden = true;
  } catch (err) {
    msg.textContent = `${err.message}${added ? ` (${plural(added, 'word')} added before the error.)` : ''}`;
  } finally {
    setBusy(false);
  }
}

// ---------- install (PWA) ----------

function setupInstall() {
  const btn = $('install-btn');
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferred = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => { btn.hidden = true; });

  if (isIos) btn.hidden = false;
  btn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      btn.hidden = true;
    } else if (isIos) {
      toast('In Safari: tap Share, then “Add to Home Screen”.');
    }
  });
}

// Lists saved before numbering was stripped kept it in the word ("7. Der Juli");
// split it into article + word so it displays and plays properly.
function repairNumberedWords() {
  const fixed = [];
  for (const w of state.words) {
    if (w.article || stripNumbering(w.german) === w.german) continue;
    Object.assign(w, splitArticle(w.german));
    if (w.article && !w.pos) w.pos = 'noun';
    delete w.audio;
    fixed.push(w);
  }
  saveWords(fixed);
}

// ---------- wiring ----------

function onKey(e) {
  if (state.view !== 'practice' || e.target.closest('input, textarea, select')) return;
  if (e.key === 'ArrowRight') stepCard(1);
  else if (e.key === 'ArrowLeft') stepCard(-1);
  else if (e.key === ' ' && !state.fc.revealed) { e.preventDefault(); reveal(); }
  else if (e.key.toLowerCase() === 'l') {
    const w = currentCard();
    if (w) playWord(w, null, $('flashcard').querySelector('.source'));
  }
}

async function init() {
  dbOk = await db.init();
  try {
    const all = await db.getAllWords();
    state.words = all.filter((w) => !w.deleted);
    state.tombstones = all.filter((w) => w.deleted);
    state.categories = await db.getMeta('categories', null);
    state.catsUpdatedAt = await db.getMeta('categoriesUpdatedAt', 0);
    $('draft').value = await db.getMeta('draft', '');
  } catch {
    toast('Could not open the local database.');
  }
  if (!Array.isArray(state.categories)) {
    // Saved with timestamp 0 so categories already in your account win on first sync.
    state.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    persist(db.setMeta('categories', state.categories));
  }
  state.hd.ready = await hd.isDownloaded();
  applyTheme();
  repairNumberedWords();
  sortWords();

  document.querySelectorAll('.nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.goto)));
  $('search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderWords();
  });

  $('single-form').addEventListener('submit', addSingle);
  const draft = $('draft');
  draft.addEventListener('input', saveDraftSoon);
  $('add-btn').addEventListener('click', addFromDraft);
  $('clear-btn').addEventListener('click', () => {
    draft.value = '';
    saveDraftSoon();
    $('add-msg').textContent = '';
    $('extract-offer').hidden = true;
  });
  $('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    draft.value = await file.text();
    saveDraftSoon();
    e.target.value = '';
    addFromDraft();
  });
  $('read-btn').addEventListener('click', toggleReadAloud);
  $('extract-btn').addEventListener('click', extractWords);

  $('fc-prev').addEventListener('click', () => stepCard(-1));
  $('fc-next').addEventListener('click', () => stepCard(1));
  $('fc-shuffle').addEventListener('click', shuffleDeck);
  document.addEventListener('keydown', onKey);

  $('voice-select').addEventListener('change', (e) => {
    settings.voiceURI = e.target.value;
    saveSettings();
    speech.speak('Hallo! Wie geht es dir?', voiceOpts());
  });
  $('test-voice').addEventListener('click', () => speech.speak('Hallo! Wie geht es dir?', voiceOpts()));
  $('theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark'
      || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    setTheme(dark ? 'light' : 'dark');
  });
  document.querySelectorAll('#theme-group button').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeChoice)));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  document.querySelectorAll('#speed-group button').forEach((b) =>
    b.addEventListener('click', () => {
      settings.rate = Number(b.dataset.rate);
      saveSettings();
      renderSegmented();
    }),
  );
  document.querySelectorAll('#source-group button').forEach((b) =>
    b.addEventListener('click', () => {
      settings.source = b.dataset.source;
      saveSettings();
      renderSegmented();
    }),
  );
  $('cat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addCategoryByName($('cat-name').value);
    $('cat-name').value = '';
    refresh();
  });
  $('export-btn').addEventListener('click', exportBackup);
  $('import-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importBackup(file);
  });
  $('fill-btn').addEventListener('click', fillMissing);
  const aiEndpoint = $('ai-endpoint');
  const aiPasscode = $('ai-passcode');
  aiEndpoint.value = settings.aiEndpoint;
  aiPasscode.value = settings.aiPasscode;
  aiEndpoint.addEventListener('change', () => { settings.aiEndpoint = aiEndpoint.value.trim(); saveSettings(); });
  aiPasscode.addEventListener('change', () => { settings.aiPasscode = aiPasscode.value; saveSettings(); });

  // Voices load asynchronously; wait briefly before deciding there are none.
  speech.onVoicesChanged(() => {
    renderVoices();
    if (speech.hasAnyVoice()) state.voicesReady = true;
    if (state.view === 'words') renderVoiceBanner();
  });
  setTimeout(() => {
    state.voicesReady = true;
    renderVoices();
    if (state.view === 'words') renderVoiceBanner();
  }, 1500);

  setupInstall();
  setView(state.words.length ? 'words' : 'add');

  if (cloud.configured) {
    cloud.watchUser(onUserChanged).catch(() => setSyncStatus('Could not load cloud sync. Check your internet.'));
  }
  // Load the downloaded voice in the background so the first word plays quickly.
  if (state.hd.ready) setTimeout(() => hd.warmUp().catch(() => {}), 3000);

  if ('serviceWorker' in navigator) {
    // When a new version takes over, reload once so you see it straight away.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
