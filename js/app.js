import { CEFR, parseWordList, normalizeKey, uniqueTextWords, looksLikeProse, splitArticle, guessPos, stripNumbering, germanPart } from './parser.js';
import { respell, malayalam } from './respell.js';
import * as speech from './speech.js';
import * as audio from './audio.js';
import * as db from './db.js';
import { translate, toEnglish, translateToEnglish, toMalayalam } from './translate.js';
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

const ICONS = {
  youtube: '<svg class="yt" viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="5" width="21" height="14" rx="4.5" fill="#ff0033" stroke="none"/><path d="M10 9v6l5.2-3z" fill="#fff" stroke="none"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  chip: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>',
  swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 1 2-2h13M8 7h7M8 11h5"/></svg>',
  practice: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v10"/></svg>',
};
// A small inline icon next to text.
const icon = (name) => h('span', { class: 'i', icon: name });
const SOURCE_ICON = { native: 'mic', computer: 'chip', none: 'mute', checking: 'mic' };

// ---------- state ----------

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

const settings = Object.assign(
  { voiceURI: '', rate: 0.85, source: 'recording', theme: 'auto', filter: 'all', topic: 'all', addCategory: 'A1', listOrder: 'en-de', aiEndpoint: '', aiPasscode: '', autoplay: true, shuffle: false, showAnswers: true, trDir: 'en-de', practiceMode: 'cards', quizKind: 'de-en', malayalam: true },
  loadSettings(),
);
const state = {
  words: [],
  categories: [],
  view: 'words',
  search: '',
  openTopic: null, // topic opened on the Words page (null = topic overview)
  openSection: null, // sub-topic opened inside it (null = the topic itself)
  organise: null, // topics ticked in "Group topics" mode (a Set), or null
  reading: false,
  busy: false,
  voicesReady: false,
  recent: [],
  tombstones: [], // removed words, kept so the removal syncs to your other devices
  catsUpdatedAt: 0,
  notes: {}, // rules and tips per topic or sub-topic (see noteKey)
  notesUpdatedAt: 0,
  user: null,
  unsubscribe: null,
  syncStatus: '',
  hd: { ready: false, progress: null },
  sync: { since: 0, local: 0 }, // see syncKey()
  fc: { order: [], index: 0, revealed: false },
  quiz: null, // the running quiz round, see startQuiz()
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

function saveNotes() {
  state.notesUpdatedAt = Date.now();
  persist(db.setMeta('notes', state.notes));
  persist(db.setMeta('notesUpdatedAt', state.notesUpdatedAt));
  if (state.user) cloudSave(cloud.saveNotes(state.user.uid, state.notes, state.notesUpdatedAt));
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
  el.className = `source avail ${source.kind || ''}`;
  el.replaceChildren(icon(SOURCE_ICON[source.kind] || 'speaker'), source.href
    ? h('a', { href: source.href, target: '_blank', rel: 'noopener' }, source.label, icon('out'))
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
    return { kind: 'computer', label: 'Computer voice (Thorsten)' };
  }
  if (hasGermanVoice()) {
    speech.speak(text, voiceOpts());
    return { kind: 'computer', label: `Browser voice (${browserVoiceName()})` };
  }
  return null;
}

// A short tone, to check that this browser plays sound at all.
function beep() {
  const rate = 22050;
  const samples = new Float32Array(rate * 0.6).map((_, i) => Math.sin((2 * Math.PI * 660 * i) / rate) * 0.5 * Math.min(1, (rate * 0.6 - i) / 2000));
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => view.setInt16(44 + i * 2, x * 0x7fff, true));
  return new Blob([view.buffer], { type: 'audio/wav' });
}

async function soundCheck() {
  audio.unlock();
  const out = $('sound-result');
  out.hidden = false;
  out.textContent = 'Playing a beep…';
  try {
    await audio.play(beep());
  } catch (err) {
    out.replaceChildren(h('strong', {}, icon('cross'), 'Your browser refused to play sound. '),
      `(${err.name}) Allow sound and autoplay for this site: click the icon left of the address → Site settings → Sound: Allow, Autoplay: Allow. Then reload.`);
    return;
  }
  await new Promise((r) => setTimeout(r, 1200));
  const st = audio.status();
  if (st.played > 0.2) {
    out.replaceChildren(
      h('strong', {}, icon('check'), 'The app and your browser played the beep. '),
      'If you heard nothing, the sound is muted outside the app. Check, in this order:',
      h('ol', {},
        h('li', {}, 'The tab is not muted: right-click this tab → “Unmute site”.'),
        h('li', {}, 'This site is not muted: icon left of the address → Site settings → Sound → Allow.'),
        h('li', {}, 'Other sites play sound in this browser (try a YouTube video).'),
        h('li', {}, 'Your computer volume is up and the right output is selected (speakers vs. headphones / HDMI) in the system sound settings.'),
      ),
    );
  } else {
    out.replaceChildren(h('strong', {}, icon('cross'), 'The browser accepted the sound but did not play it. '),
      'Allow sound and autoplay for this site (icon left of the address → Site settings), then reload.');
  }
}

function soundBlockedHelp() {
  toast('Your browser is not playing the sound. Check the tab is not muted, your volume is up, and sound/autoplay is allowed for this site (Brave: click the icon left of the address → Site settings → Sound / Autoplay → Allow).', 'Sound check', () => {
    setView('settings');
    soundCheck();
  });
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
  audio.unlock();
  try {
    const source = await speakText(text);
    if (source) showSource(sourceEl, source);
    else offerVoiceDownload();
  } catch (err) {
    if (err.name === 'NotAllowedError') soundBlockedHelp();
    else toast(`Could not speak: ${err.message}`);
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
      if (state.words.includes(w)) persist(db.putWords([w]));
    } catch {
      /* lookup failed (network); try again next time */
    }
    btn?.classList.remove('loading');
  }
  if (!w.audio) return false;
  try {
    speech.stop();
    await audio.play(w.audio, rateFor());
    showSource(sourceEl, { kind: 'native', label: 'Native speaker recording', href: audio.recordingPage(w.audio) });
    return true;
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      soundBlockedHelp();
      return true; // the browser blocks all sound; trying another source won't help
    }
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
    if (err.name === 'NotAllowedError') soundBlockedHelp();
    else toast(`Could not speak: ${err.message}`);
    return true;
  } finally {
    btn?.classList.remove('loading');
  }
}

// Single words: your preferred source first, then the other one.
async function playWord(w, btn, sourceEl) {
  audio.unlock();
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

const visibleSource = () => state.words;

function inCategory(list) {
  if (settings.filter === 'all') return list;
  if (settings.filter === 'none') return list.filter((w) => !w.level);
  return list.filter((w) => w.level === settings.filter);
}

function searched(list) {
  const q = state.search.trim().toLowerCase();
  if (!q) return list;
  return list.filter((w) => fullGerman(w).toLowerCase().includes(q) || w.english.toLowerCase().includes(q) || (w.topic || '').toLowerCase().includes(q)
    || (hasForms(w) && w.forms.some((f) => f.toLowerCase().includes(q)))
    || (w.malayalam || '').includes(q));
}

// Topics in list order (a pasted list keeps its heading order); words without one come last.
function topicNames() {
  const names = [...new Set(state.words.map((w) => w.topic || ''))];
  return [...names.filter(Boolean), ...names.filter((t) => !t)];
}

// Sections of a topic, in list order.
function sectionNames(topic) {
  return [...new Set(state.words.filter((w) => (w.topic || '') === topic).map((w) => w.subtopic || ''))]
    .sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1));
}

// The practice filter is either a topic or "topic SEP section".
const SEP = '\u001f';
function inTopic(list) {
  if (settings.topic === 'all') return list;
  const [topic, section] = settings.topic.split(SEP);
  return list.filter((w) => (w.topic || '') === topic && (section === undefined || (w.subtopic || '') === section));
}

// Practice filters: a topic dropdown, and under it a sub-topic dropdown for that topic.
function renderTopicSelect(select, subSelect) {
  const names = topicNames();
  const [topic, section] = settings.topic.split(SEP);
  const subs = topic === 'all' ? [] : sectionNames(topic).filter(Boolean);
  if ((topic !== 'all' && !names.includes(topic)) || (section !== undefined && !subs.includes(section))) settings.topic = 'all';
  const current = settings.topic.split(SEP);
  const count = (list) => ` (${list.length})`;
  select.hidden = !names.some(Boolean);
  select.replaceChildren(
    h('option', { value: 'all' }, 'All topics'),
    ...names.map((t) => h('option', { value: t }, (t || 'Other words') + count(state.words.filter((w) => (w.topic || '') === t)))));
  select.value = current[0];
  const shownSubs = current[0] === 'all' ? [] : sectionNames(current[0]).filter(Boolean);
  subSelect.hidden = !shownSubs.length;
  subSelect.replaceChildren(
    h('option', { value: '' }, 'All sub-topics'),
    ...shownSubs.map((sec) => h('option', { value: sec }, sec + count(state.words.filter((w) => (w.topic || '') === current[0] && w.subtopic === sec)))));
  subSelect.value = current[1] || '';
}

// Topic dropdown on the Add page: "No topic", your topics, or "+ New topic…" with a name box.
const NEW_TOPIC = '\u0000new';
function renderTopicPicker(id, names = topicNames().filter(Boolean), kind = 'topic') {
  const select = $(`${id}-select`);
  const input = $(id);
  const current = select.value;
  select.replaceChildren(
    h('option', { value: '' }, `No ${kind}`),
    ...names.map((t) => h('option', { value: t }, t)),
    h('option', { value: NEW_TOPIC }, `+ New ${kind}…`),
  );
  let value = current;
  if (value === NEW_TOPIC && !input.value && names.includes(input.dataset.last)) value = input.dataset.last;
  if (value !== NEW_TOPIC && !names.includes(value)) value = '';
  select.value = value;
  input.hidden = value !== NEW_TOPIC;
}

// The topic chosen in a picker, without changing it (for the section list).
function currentPick(id) {
  const select = $(`${id}-select`);
  return (select.value === NEW_TOPIC ? $(id).value : select.value).trim().slice(0, 80);
}

function renderSectionPicker() {
  const topic = currentPick('in-topic');
  $('in-sub-field').hidden = !topic;
  renderTopicPicker('in-sub', topic ? sectionNames(topic).filter(Boolean) : [], 'sub-topic');
}

function pickedTopic(id) {
  const select = $(`${id}-select`);
  const topic = (select.value === NEW_TOPIC ? $(id).value : select.value).trim().slice(0, 80);
  // After adding, a new topic becomes a normal choice in the dropdown.
  $(id).dataset.last = topic;
  if (select.value === NEW_TOPIC && topic) $(id).value = '';
  return topic;
}

function setTopic(value) {
  settings.topic = value;
  saveSettings();
  state.fc.index = 0;
  refresh();
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

// How to say the German, written in Malayalam letters (ഗൂടെൻ മൊർഗെൻ).
function malayalamSoundEl(w) {
  if (!settings.malayalam) return null;
  const text = malayalam(fullGerman(w));
  return text ? h('span', { class: 'respell ml', lang: 'ml', title: 'How to say it, in Malayalam letters (approximate)' }, text) : null;
}

// The meaning in Malayalam, under the English.
function malayalamMeaning(text) {
  return settings.malayalam && text ? h('div', { class: 'malayalam', lang: 'ml' }, text) : null;
}

function soundRow(w) {
  const parts = [respellingEl(w), malayalamSoundEl(w), w.ipa ? h('span', { class: 'ipa' }, formatIpa(w.ipa)) : null].filter(Boolean);
  return parts.length ? h('div', { class: 'sound' }, parts) : null;
}

function exampleRow(w, sourceEl) {
  if (!w.example) return null;
  const sound = settings.malayalam && !w.example.startsWith('Plural:') ? malayalam(w.example) : '';
  return h('div', { class: 'sentence' },
    h('span', {},
      h('span', { lang: 'de' }, w.example),
      sound ? h('span', { class: 'sentence-ml', lang: 'ml' }, sound) : null,
      malayalamMeaning(w.exampleMl)),
    h('button', { class: 'icon-btn small', icon: 'play', 'aria-label': 'Play example sentence', onclick: () => say(w.example, sourceEl) }),
  );
}

function playButton(w, sourceEl) {
  const btn = h('button', { class: 'icon-btn play', icon: 'speaker', 'aria-label': `Say ${fullGerman(w)}` });
  btn.addEventListener('click', () => playWord(w, btn, sourceEl));
  return btn;
}

const computerVoiceReady = () => state.hd.ready || hasGermanVoice();

// What will play for this word, shown on the card before you press play.
function availability(w) {
  const native = { kind: 'native', text: 'Native speaker recording' };
  const computer = { kind: 'computer', text: state.hd.ready ? 'Computer voice (Thorsten)' : `Browser voice (${browserVoiceName()})` };
  if (w.audio && (settings.source === 'recording' || !computerVoiceReady())) return native;
  if (computerVoiceReady()) return computer;
  if ((w.audio === undefined || (!w.audio && w.audioV !== AUDIO_LOOKUP_VERSION)) && navigator.onLine) return { kind: 'checking', text: 'Checking for a recording…' };
  if (!navigator.onLine && w.audio) return { kind: 'none', text: 'Offline: recordings need internet' };
  return { kind: 'none', text: 'No voice for this word yet' };
}

function renderAvailability(el, w) {
  const a = availability(w);
  const compact = el.classList.contains('compact');
  el.className = `source avail ${a.kind}${compact ? ' compact' : ''}`;
  // On word cards only a missing voice is worth a line; the rest would just be clutter.
  el.hidden = compact && a.kind !== 'none';
  el.replaceChildren(icon(SOURCE_ICON[a.kind]), a.text);
  if (a.kind === 'none') {
    el.append(' · ', h('button', { class: 'link-btn', onclick: () => { setView('settings'); downloadHd(); } }, 'Get free voice'));
  }
  el.closest('.card, .flashcard')?.querySelector('.icon-btn.play')?.classList.toggle('muted', a.kind === 'none');
  if (a.kind === 'checking') queueLookup(w);
}

const sourceLine = (w) => {
  const el = h('div', { class: 'source', 'aria-live': 'polite', 'data-id': w.id });
  queueMicrotask(() => renderAvailability(el, w));
  return el;
};

// Looks up recordings in the background, one word at a time, so each card can say
// whether a native-speaker recording exists.
const lookupQueue = [];
let lookingUp = false;
function queueLookup(w) {
  if (!lookupQueue.includes(w)) lookupQueue.push(w);
  if (!lookingUp) runLookups();
}
async function runLookups() {
  lookingUp = true;
  while (lookupQueue.length && navigator.onLine) {
    const w = lookupQueue.shift();
    if (w.audio || (w.audio === '' && w.audioV === AUDIO_LOOKUP_VERSION)) continue;
    try {
      w.audio = await audio.findRecording(fullGerman(w));
      w.audioV = AUDIO_LOOKUP_VERSION;
      if (state.words.includes(w)) persist(db.putWords([w]));
    } catch {
      // Offline, or Wiktionary asks us to slow down: put the word back and retry in a minute.
      lookupQueue.unshift(w);
      lookingUp = false;
      setTimeout(() => { if (!lookingUp) runLookups(); }, 60000);
      return;
    }
    document.querySelectorAll(`.source[data-id="${CSS.escape(w.id)}"]`).forEach((el) => {
      if (el.classList.contains('avail')) renderAvailability(el, w);
    });
    // Wiktionary is a free service shared with everyone: about two lookups a second at most.
    await new Promise((r) => setTimeout(r, 500));
  }
  lookingUp = false;
}

// A centred pop-up. `build(close)` returns the content; close() removes it again.
function openModal(build, onCancel = () => {}) {
  const close = () => { dialog.close(); dialog.remove(); };
  const dialog = h('dialog', { class: 'modal', oncancel: (e) => { e.preventDefault(); close(); onCancel(); } });
  dialog.append(build(close));
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

// One-line text question in a pop-up (instead of the browser's prompt box). Resolves to the text, or null.
function textDialog(title, label, placeholder = '') {
  return new Promise((resolve) => {
    const input = h('input', { required: true, placeholder });
    openModal((close) => h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        close();
        resolve(input.value.trim().slice(0, 80) || null);
      },
    },
    h('h2', {}, title),
    h('label', { class: 'field' }, h('span', {}, label), input),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn', type: 'button', onclick: () => { close(); resolve(null); } }, 'Cancel'))), () => resolve(null));
    input.focus();
  });
}

// Asks for a topic or sub-topic name as two parts, German and English, and joins them
// the way list headings are written ("Numbers – Die Zahlen"). Resolves to the name, or null.
function nameDialog(title, old) {
  return new Promise((resolve) => {
    const parts = old.split(/\s+[-–—]\s+/);
    const oldGerman = topicGerman(old);
    const german = h('input', { value: oldGerman, lang: 'de', required: true, placeholder: 'Die Zahlen' });
    const english = h('input', { value: parts.length > 1 ? parts.filter((p) => p.trim() !== oldGerman).join(' – ') : oldGerman ? '' : old, placeholder: 'Numbers' });
    const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
    const close = (value) => { dialog.close(); dialog.remove(); resolve(value); };
    const dialog = h('dialog', { class: 'modal', oncancel: (e) => { e.preventDefault(); close(null); } },
      h('form', {
        onsubmit: (e) => {
          e.preventDefault();
          const de = german.value.trim();
          const en = english.value.trim();
          if (!de) return;
          const name = !en ? de : settings.listOrder === 'en-de' ? `${en} – ${de}` : `${de} – ${en}`;
          close(name.slice(0, 80));
        },
      },
      h('h2', {}, title),
      field('German name (the title, and what the speaker button says)', german),
      field('English name (shown under it)', english),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
        h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'))));
    document.body.append(dialog);
    dialog.showModal();
    german.focus();
    // Suggest whichever half is missing.
    if (!english.value && german.value) {
      toEnglish(german.value).then((en) => { if (en && !english.value) english.value = en; }).catch(() => {});
    } else if (!german.value && english.value) {
      translate(english.value).then(({ results }) => {
        if (results[0] && !german.value) german.value = translationLabel(results[0]);
      }).catch(() => {});
    }
  });
}

async function renameTopic(old) {
  const name = await nameDialog('Rename topic', old);
  if (!name || name === old) return;
  const words = state.words.filter((w) => (w.topic || '') === old);
  words.forEach((w) => { w.topic = name; });
  if (settings.topic === old || settings.topic.startsWith(old + SEP)) {
    settings.topic = name + settings.topic.slice(old.length);
    saveSettings();
  }
  if (state.openTopic === old) state.openTopic = name;
  saveWords(words);
  refresh();
  toast(`Renamed to “${name}”.`);
}

// Edit a word right on its card. Category, topic and section are changed here too,
// so the card itself stays short.
function editWord(w) {
  const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
  const german = h('input', { value: fullGerman(w), lang: 'de', required: true, autocapitalize: 'off', spellcheck: 'false' });
  const english = h('input', { value: w.english, required: true });
  const example = h('input', { value: w.example || '', lang: 'de', placeholder: 'Der Hund bellt.' });
  const mlMeaning = h('input', { value: w.malayalam || '', lang: 'ml', placeholder: 'നായ' });
  const mlExample = h('input', { value: w.exampleMl || '', lang: 'ml', placeholder: 'നായ കുരയ്ക്കുന്നു.' });
  const forms = h('input', { value: hasForms(w) ? w.forms.join(', ') : '', lang: 'de', placeholder: 'lerne, lernst, lernt, lernen, lernt, lernen' });
  const names = categoryNames();
  const level = h('select', {},
    ...[...names, ...(w.level && !names.includes(w.level) ? [w.level] : [])].map((n) => h('option', { value: n, selected: n === w.level }, n)),
    h('option', { value: '', selected: !w.level }, 'No category'));
  const askNew = async (select, kind, fallback) => {
    if (select.value !== NEW_TOPIC) return;
    const name = await nameDialog(`New ${kind}`, '');
    if (!name) {
      select.value = fallback();
    } else {
      select.insertBefore(h('option', { value: name }, name), select.lastChild);
      select.value = name;
    }
  };
  const topic = h('select', {},
    h('option', { value: '' }, 'No topic'),
    ...topicNames().filter(Boolean).map((t) => h('option', { value: t, selected: t === w.topic }, t)),
    h('option', { value: NEW_TOPIC }, '+ New topic…'));
  const section = h('select', {});
  const fillSections = () => {
    const sections = topic.value ? sectionNames(topic.value).filter(Boolean) : [];
    const keep = topic.value === (w.topic || '') ? w.subtopic || '' : '';
    section.replaceChildren(
      h('option', { value: '' }, 'No sub-topic'),
      ...sections.map((sec) => h('option', { value: sec, selected: sec === keep }, sec)),
      h('option', { value: NEW_TOPIC }, '+ New sub-topic…'));
    sectionField.hidden = !topic.value;
  };
  const sectionField = field('Sub-topic', section);
  topic.addEventListener('change', async () => {
    await askNew(topic, 'topic', () => w.topic || '');
    fillSections();
  });
  section.addEventListener('change', () => askNew(section, 'sub-topic', () => ''));
  fillSections();
  openModal((close) => h('form', {
    class: 'edit-form',
    onsubmit: (e) => {
      e.preventDefault();
      const { article, german: de } = splitArticle(german.value.trim().replace(/\s+/g, ' '));
      const en = english.value.trim();
      if (!de || !en) return;
      if (de !== w.german || article !== w.article) {
        // A different German word needs a fresh recording lookup and respelling.
        Object.assign(w, { article, german: de, respelling: '', ipa: '', pos: guessPos(article, de, en) });
        delete w.audio;
        delete w.audioV;
      }
      w.english = en;
      w.example = example.value.trim();
      w.malayalam = mlMeaning.value.trim();
      w.exampleMl = mlExample.value.trim();
      const formList = forms.value.split(',').map((f) => f.trim()).filter(Boolean);
      if (formList.length === 6) w.forms = formList;
      else if (!formList.length) delete w.forms;
      w.level = level.value;
      w.topic = topic.value === NEW_TOPIC ? w.topic || '' : topic.value;
      w.subtopic = w.topic && section.value !== NEW_TOPIC ? section.value : '';
      ensureCategories([w.level].filter(Boolean));
      saveWords([w]);
      close();
      refresh();
      toast(`Saved “${fullGerman(w)}”.`);
    },
  },
  h('h2', {}, 'Edit word'),
  field('German (with der / die / das for nouns)', german),
  field('English', english),
  h('button', {
    class: 'link-btn swap', type: 'button',
    onclick: () => { [german.value, english.value] = [english.value, german.value]; },
  }, icon('swap'), 'Swap German and English'),
  field('Malayalam meaning', mlMeaning),
  field('Example sentence (optional)', example),
  field('Example sentence in Malayalam (optional)', mlExample),
  w.pos === 'verb' || hasForms(w) ? field('Present tense: ich, du, er/sie/es, wir, ihr, sie/Sie (6 forms, with commas)', forms) : null,
  h('div', { class: 'edit-grid' }, field('Category', level), field('Topic', topic), sectionField),
  h('div', { class: 'row' },
    h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
    h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'),
  )));
  german.focus();
}

// Present-tense forms of a verb are stored as `forms`, in this order.
const PRONOUNS = ['ich', 'du', 'er/sie/es', 'wir', 'ihr', 'sie/Sie'];
const SPOKEN_PRONOUNS = ['ich', 'du', 'er', 'wir', 'ihr', 'sie'];
const hasForms = (w) => Array.isArray(w.forms) && w.forms.length === 6 && w.forms.every(Boolean);

// "ich lerne / du lernst / …", each line with its own play button.
function conjugationTable(w) {
  return h('table', { class: 'conj' }, h('tbody', {}, ...w.forms.map((form, i) => {
    const spoken = `${SPOKEN_PRONOUNS[i]} ${form}`;
    return h('tr', {},
      h('th', { scope: 'row' }, PRONOUNS[i]),
      h('td', { lang: 'de' }, form),
      h('td', {}, h('button', { class: 'icon-btn small conj-play', icon: 'play', 'aria-label': `Say ${spoken}`, onclick: () => say(spoken) })));
  })));
}

// A card shows only what you need to learn the word: the German, its English meaning
// under it, how to say it, and the example sentence if there is one.
function wordCard(w) {
  const card = h('li', { class: `card ${colorClass(w.level)}` });
  const voice = h('div', { class: 'source compact', 'data-id': w.id });
  queueMicrotask(() => renderAvailability(voice, w));
  const sounds = [respellingEl(w), malayalamSoundEl(w)].filter(Boolean);
  card.append(
    h('div', { class: 'card-head' },
      h('div', { class: 'text' },
        h('div', { class: 'word', lang: 'de' }, w.article ? h('span', { class: 'article' }, w.article) : null, w.german),
        h('div', { class: 'english' }, w.english),
        malayalamMeaning(w.malayalam),
        sounds.length ? h('div', { class: 'sound' }, ...sounds) : null,
      ),
      h('div', { class: 'card-side' },
        playButton(w, null),
        h('div', { class: 'card-actions' },
          h('button', { class: 'icon-btn small remove', icon: 'edit', 'aria-label': `Edit ${fullGerman(w)}`, title: 'Edit', onclick: () => editWord(w) }),
          h('button', { class: 'icon-btn small remove', icon: 'trash', 'aria-label': `Remove ${fullGerman(w)}`, title: 'Remove', onclick: () => removeWord(w.id) }),
        ),
      ),
    ),
    voice,
  );
  const sentence = exampleRow(w, null);
  if (sentence) card.append(sentence);
  if (hasForms(w)) {
    card.append(h('details', { class: 'conj-box' }, h('summary', {}, 'ich / du / er … ', h('span', { class: 'hint' }, 'present tense')), conjugationTable(w)));
  }
  return card;
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
      h('strong', {}, 'No German voice in this browser. '),
      downloading
        ? `Downloading the free German voice… ${Math.round(state.hd.progress * 100)}%`
        : `Get the free one (${hd.MODEL_SIZE_MB} MB, once) to hear every word and sentence.`),
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
  if (state.view === 'words' && state.hd.progress === null) renderWords();
  else if (state.view === 'words') renderVoiceBanner();
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
      h('p', {}, h('span', { class: 'ok' }, icon('check'), 'Free German voice installed. '), 'Every word and sentence can be spoken, also offline. It is "Thorsten", an open-source voice that runs on this device.'),
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
    h('p', {}, h('span', { class: 'ok' }, icon('check'), 'Syncing '), `as ${state.user.email || state.user.displayName || 'you'}. Changes appear on your other devices automatically.`),
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

// Where this device got to in the cloud: `server` is the newest server stamp it has seen,
// `local` this device's clock at that moment. Kept per account.
const syncKey = (uid) => `cloudSince:${uid}`;

function onCloudWords({ records, isFirst, fromCache, unstamped, newest }) {
  const all = new Map([...state.words, ...state.tombstones].map((w) => [w.id, w]));
  const full = isFirst && !state.sync.since;
  let local;
  let remote;
  if (full) {
    // First sync on this device: the whole list from the cloud, merged with what is here.
    local = [...all.values()];
    remote = records;
  } else {
    // Keep this device's recording lookup when a newer copy arrives.
    const changed = records.filter((r) => isNewer(r, all.get(r.id)));
    for (const r of changed) {
      const old = all.get(r.id);
      all.set(r.id, old ? { ...r, audio: old.audio, audioV: old.audioV } : r);
    }
    // Words changed here while signed out have not reached the cloud yet.
    local = isFirst ? [...all.values()].filter((w) => (w.updatedAt || 0) > state.sync.local) : [];
    remote = [...all.values()];
    if (!changed.length && !local.length) {
      saveCheckpoint(newest, fromCache);
      return;
    }
  }
  const { merged, toUpload } = mergeWords(local, remote);
  // Cloud words from before server stamps existed get one: a one-time write, so later
  // syncs can skip them.
  const uploading = new Set(toUpload.map((w) => w.id));
  const restamp = full ? unstamped.filter((w) => !uploading.has(w.id)).map((w) => merged.find((m) => m.id === w.id) || w) : [];
  applyRecords(merged);
  persist(db.replaceAllWords(merged));
  if (toUpload.length || restamp.length) cloudSave(cloud.saveWords(state.user.uid, [...toUpload, ...restamp]));
  saveCheckpoint(newest, fromCache);
  setSyncStatus(fromCache ? 'Offline: changes will sync when you are back online.' : `Up to date · ${plural(state.words.length, 'word')} in your account.`);
}

function saveCheckpoint(newest, fromCache) {
  if (fromCache || !state.user) return;
  if (newest > state.sync.since) state.sync = { since: newest, local: Date.now() };
  else if (!state.sync.since) return;
  persist(db.setMeta(syncKey(state.user.uid), state.sync));
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
  const notesAt = meta.notesUpdatedAt || 0;
  if (meta.notes && notesAt > state.notesUpdatedAt) {
    state.notes = meta.notes;
    state.notesUpdatedAt = notesAt;
    persist(db.setMeta('notes', state.notes));
    persist(db.setMeta('notesUpdatedAt', notesAt));
    refresh();
  } else if (state.notesUpdatedAt > notesAt) {
    cloudSave(cloud.saveNotes(state.user.uid, state.notes, state.notesUpdatedAt));
  }
}

async function onUserChanged(user) {
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.user = user;
  state.syncStatus = user ? 'Syncing…' : '';
  if (user) {
    state.sync = await db.getMeta(syncKey(user.uid), { since: 0, local: 0 }).catch(() => ({ since: 0, local: 0 }));
    if (state.user !== user) return;
    state.unsubscribe?.();
    state.unsubscribe = cloud.subscribe(user.uid, state.sync.since, onCloudWords, onCloudMeta, (err) => setSyncStatus(`Could not sync: ${err.code || err.message}`));
  }
  if (state.view === 'settings') renderSyncBox();
}

// ---------- appearance ----------

function applyTheme() {
  const choice = settings.theme;
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  const dark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0f1424' : '#fbf6ef'));
  document.querySelectorAll('#theme-group button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === choice)));
}

function setTheme(choice) {
  settings.theme = choice;
  saveSettings();
  applyTheme();
}

// The German part of a topic title: "Time Expressions – Zeitangaben" -> "Zeitangaben".
// Worked out from the words themselves, so it doesn't matter which side the German is on.
let knownGerman = { words: null, set: new Set() };
function topicGerman(topic) {
  if (knownGerman.words !== state.words) {
    knownGerman = { words: state.words, set: new Set(state.words.flatMap((w) => w.german.toLowerCase().split(/[\s-]+/))) };
  }
  return germanPart(topic, knownGerman.set);
}

// Topic names are spoken like words; this keeps one stand-in word per topic so a
// recording found for it is remembered while the app is open.
const topicSpeech = new Map();
function topicWord(topic) {
  const german = topicGerman(topic);
  if (!german) return null;
  if (!topicSpeech.has(german)) topicSpeech.set(german, { id: `topic:${german}`, ...splitArticle(german), english: topic });
  return topicSpeech.get(german);
}

function topicPlayButton(topic, small) {
  const w = topicWord(topic);
  if (!w) return null;
  const btn = h('button', { class: `icon-btn play${small ? ' small' : ''}`, icon: 'speaker', 'aria-label': `Say ${topicGerman(topic)}` });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    playWord(w, btn, null);
  });
  return btn;
}

// The Words page is like folders: topics → sub-topics → words.
function openTopic(topic, section = null) {
  state.openTopic = topic;
  state.openSection = section;
  renderWords();
  window.scrollTo(0, 0);
}

function removeTopic(topic) {
  const words = state.words.filter((w) => (w.topic || '') === topic);
  if (!confirm(`Remove the topic “${topic}”? Its ${plural(words.length, 'word')} stay in your list, without a topic.`)) return;
  words.forEach((w) => { w.topic = ''; w.subtopic = ''; });
  saveWords(words);
  openTopic(null);
}

// Topic and sub-topic names show the German part as the title and the English part under it:
// "German Numbers – Zahlen von 1 bis 100" -> "Zahlen von 1 bis 100" / "German Numbers".
function titlePair(name, tag, fallback) {
  if (!name) return h('div', { class: 'title-pair' }, h(tag, {}, fallback));
  const german = topicGerman(name);
  const english = german ? name.split(/\s+[-–—]\s+/).filter((p) => p.trim() !== german).join(' – ') : '';
  const sound = german ? respell(german) : '';
  return h('div', { class: 'title-pair' },
    h(tag, { lang: german ? 'de' : null }, german || name),
    english ? h('span', { class: 'sub' }, english) : null,
    sound ? h('span', { class: 'respell', title: 'Say it like this. Capitals = stressed syllable.' }, sound) : null);
}

// Cards grouped under topic headings (used for search results).
function groupedCards(list, withHeads) {
  const groups = new Map(topicNames().map((t) => [t, []]));
  list.forEach((w) => groups.get(w.topic || '').push(w));
  return [...groups].filter(([, ws]) => ws.length).flatMap(([topic, ws]) => [
    withHeads ? h('li', { class: 'topic-head' },
      titlePair(topic, 'h3', 'Other words'),
      h('span', { class: 'count' }, plural(ws.length, 'word')),
      topic ? h('button', { class: 'link-btn', onclick: () => openTopic(topic) }, 'Open') : null,
    ) : null,
    ...ws.map(wordCard),
  ]).filter(Boolean);
}

// One folder tile: a topic on the overview, or a sub-topic inside a topic.
function folderTile(name, detail, open, picking, parent = null) {
  const picked = picking?.has(name);
  const choose = () => {
    if (!picking) return open();
    if (picked) picking.delete(name);
    else picking.add(name);
    renderWords();
  };
  return h('li', {
    class: `topic-tile${picked ? ' picked' : ''}`, tabindex: '0', role: picking ? 'checkbox' : 'button',
    'aria-checked': picking ? String(!!picked) : null,
    onclick: choose,
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } },
  },
  picking ? h('span', { class: 'tick', 'aria-hidden': 'true', icon: picked ? 'check' : null }) : null,
  h('div', { class: 'tile-main' }, titlePair(name, 'h3', 'Other words')),
  h('div', { class: 'tile-foot' },
    h('span', { class: 'count' }, icon('folder'), detail),
    picking ? null : h('span', { class: 'tile-actions' }, parent ? youTubeButton(parent, name) : youTubeButton(name), topicPlayButton(name, true))));
}

function topicTile(topic, count) {
  const subs = sectionNames(topic).filter(Boolean).length;
  return folderTile(topic, `${subs ? `${plural(subs, 'sub-topic')} · ` : ''}${plural(count, 'word')}`, () => openTopic(topic), state.organise);
}

async function renameSection(topic, old) {
  const name = await nameDialog('Rename sub-topic', old);
  if (!name || name === old) return;
  const words = state.words.filter((w) => (w.topic || '') === topic && w.subtopic === old);
  words.forEach((w) => { w.subtopic = name; });
  if (settings.topic === topic + SEP + old) {
    settings.topic = topic + SEP + name;
    saveSettings();
  }
  if (state.openSection === old) state.openSection = name;
  saveWords(words);
  refresh();
}

// Takes a sub-topic out of its topic: into another topic, or as a topic of its own.
function moveSection(topic, section, target) {
  const words = state.words.filter((w) => (w.topic || '') === topic && w.subtopic === section);
  words.forEach((w) => {
    w.topic = target || section;
    w.subtopic = target ? section : '';
  });
  saveWords(words);
  openTopic(target || section, target ? section : null);
  toast(target ? `“${section}” is now a sub-topic of “${target}”.` : `“${section}” is now a topic of its own.`);
}

// Turns whole topics into sub-topics of another topic ("Numbers 0–20", "Numbers 21–29"…
// into "German Numbers"). A sub-topic the topic already had keeps its name after a dash.
function moveTopicsInto(topics, parent) {
  const words = state.words.filter((w) => topics.includes(w.topic || ''));
  words.forEach((w) => {
    w.subtopic = w.subtopic ? `${w.topic} – ${w.subtopic}` : w.topic;
    w.topic = parent;
  });
  saveWords(words);
  state.organise = null;
  openTopic(parent);
  toast(`${plural(topics.length, 'topic')} moved into “${parent}” as sub-topics.`);
}

// For lists pasted the wrong way round (e.g. "A – ah"): swaps German and English for these words.
function swapLanguages(words, name) {
  if (!confirm(`Swap German and English for all ${plural(words.length, 'word')} in “${name}”?`)) return;
  words.forEach((w) => {
    const { article, german } = splitArticle(w.english);
    Object.assign(w, { english: fullGerman(w), article, german, respelling: '', ipa: '', pos: guessPos(article, german, fullGerman(w)) });
    delete w.audio;
    delete w.audioV;
  });
  saveWords(words);
  refresh();
  toast('Swapped German and English.');
}

const menuButton = (iconName, label, onclick, cls) => h('button', { class: cls, onclick }, icon(iconName), label);

// A "Move to…" dropdown inside the More menu.
function menuSelect(label, choices, onpick) {
  return h('label', {},
    h('span', {}, label),
    h('select', { onchange: (e) => { if (!onpick(e.target.value)) e.target.value = ''; } },
      h('option', { value: '' }, 'Choose…'),
      ...choices.map(([value, text]) => h('option', { value }, text))));
}

// Rules and tips belong to a topic, or to one sub-topic of it.
const noteKey = (topic, section) => (section ? `${topic} › ${section}` : topic);

const isYouTube = (url) => /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(url);

// One video per topic. A YouTube link in the topic's own rules and tips wins, so you can
// pick any video yourself; otherwise a checked video for common grammar topics is used.
const TOPIC_VIDEOS = [
  [/akkusativ\s*präp|präpositionen mit akkusativ|accusative prep/i, 'nZduxD7nEU8'], // YourGermanTeacher
  [/dativ\s*präp|präpositionen mit dativ|dative prep/i, 'CDgG2K7Kbbs'], // Easy German
  [/wechselpräp|two-way prep/i, 'auWRmuw_AcY'], // YourGermanTeacher
  [/präposition|preposition/i, 'OlRQT4V72LM'], // YourGermanTeacher
  [/dativ|dative/i, 'G-dgLzu18EU'], // YourGermanTeacher
  [/akkusativ|accusative/i, 'fPKH95g_9cs'], // YourGermanTeacher
  [/fälle|\bcases\b/i, '0Fwr5gyNNDM'], // Dein Sprachcoach
  [/adosu|konjunktion|conjunction/i, 'DWkaLIghET8'], // Learn German
  [/zeitadverb|time adverb/i, 'nFBOwzDCzrg'], // Learn German
  [/imperativ/i, 'Mty5HjzgNOc'], // YourGermanTeacher
  [/\bkein\b|negation/i, 'NcswV-xuyMc'], // YourGermanTeacher
  [/adjektiv|adjective|gegenteil|opposite/i, 'Iok1CECJZfg'], // Deutsch1
  [/\bverben\b|\bverbs?\b/i, 'CyME2ZobD60'], // Hallo Deutschschule
];
const YT_LINK = /\[[^\]]+\]\((https:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[^)\s]+)\)|(https:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)\S+)/;

function topicVideo(topic, section) {
  for (const key of [section && noteKey(topic, section), topic].filter(Boolean)) {
    const link = (state.notes[key] || '').match(YT_LINK);
    if (link) return link[1] || link[2];
  }
  for (const name of [section, topic].filter(Boolean)) {
    const hit = TOPIC_VIDEOS.find(([re]) => re.test(name));
    if (hit) return `https://www.youtube.com/watch?v=${hit[1]}`;
  }
  return '';
}

function youTubeButton(topic, section = null) {
  const url = topicVideo(topic, section);
  if (!url) return null;
  return h('a', {
    class: 'icon-btn small yt-btn', href: url, target: '_blank', rel: 'noopener',
    title: 'Watch the video on YouTube', 'aria-label': `YouTube video about ${section || topic}`,
    onclick: (e) => e.stopPropagation(), onkeydown: (e) => e.stopPropagation(),
  }, icon('youtube'));
}

// **bold**, so a note can highlight an ending or a rule, and [text](https://…) for a link.
const inline = (text) => text.split(/(\*\*.+?\*\*|\[[^\]]+\]\(https:\/\/[^)\s]+\))/).map((part) => {
  const link = part.match(/^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/);
  if (link) {
    const yt = isYouTube(link[2]);
    return h('a', { href: link[2], target: '_blank', rel: 'noopener', class: `note-link${yt ? ' yt-chip' : ''}` }, icon(yt ? 'youtube' : 'out'), link[1]);
  }
  return /^\*\*.+\*\*$/.test(part) ? h('strong', {}, part.slice(2, -2)) : part;
});

// Turns the plain text of a note into headings, lists and little tables:
// "Ich → -e" lines in a row become a two-column table, "- " lines a list, "Something:" a heading.
function formatNotes(text) {
  const out = [];
  let rows = null;
  let items = null;
  const flush = () => {
    if (rows) out.push(h('table', { class: 'note-table' }, h('tbody', {}, ...rows)));
    if (items) out.push(h('ul', {}, ...items));
    rows = null;
    items = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const heading = line.endsWith(':') && line.length < 70 && !line.startsWith('- ');
    const pair = !heading && line.match(/^(.+?)\s+→\s+(.+)$/);
    if (pair && !line.startsWith('- ')) {
      if (items) flush();
      (rows ||= []).push(h('tr', {}, h('th', { lang: 'de' }, ...inline(pair[1])), h('td', { lang: 'de' }, ...inline(pair[2]))));
    } else if (line.startsWith('- ')) {
      if (rows) flush();
      (items ||= []).push(h('li', {}, ...inline(line.slice(2))));
    } else {
      flush();
      if (!line) continue;
      out.push(heading ? h('h4', {}, ...inline(line.slice(0, -1))) : h('p', {}, ...inline(line)));
    }
  }
  flush();
  return out;
}

function renderNotes(key) {
  const box = $('topic-notes');
  const text = state.notes[key];
  box.hidden = !text;
  if (!text) return;
  // Remembers, per topic, whether you folded the rules away.
  let folded = [];
  try { folded = JSON.parse(localStorage.getItem('wc.foldedNotes') || '[]'); } catch { /* storage blocked */ }
  const details = h('details', { open: !folded.includes(key) },
    h('summary', {}, icon('book'), 'Rules and tips'),
    h('div', { class: 'notes-body' }, ...formatNotes(text)),
    h('button', { class: 'link-btn notes-edit', onclick: () => editNotes(key) }, icon('edit'), 'Edit'));
  details.addEventListener('toggle', () => {
    const rest = folded.filter((k) => k !== key);
    folded = details.open ? rest : [...rest, key];
    try { localStorage.setItem('wc.foldedNotes', JSON.stringify(folded)); } catch { /* storage blocked */ }
  });
  box.replaceChildren(details);
}

function editNotes(key) {
  const text = h('textarea', { rows: 12, lang: 'de', spellcheck: 'false' });
  text.value = state.notes[key] || '';
  openModal((close) => h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const value = text.value.trim();
      if (value) state.notes[key] = value;
      else delete state.notes[key];
      saveNotes();
      close();
      renderWords();
    },
  },
  h('h2', {}, `Rules and tips: ${topicGerman(key.split(' › ').pop()) || key.split(' › ').pop()}`),
  h('p', { class: 'hint' }, 'Write a line like "Ich → -e" for a table row, "- " for a list item, a line ending in ":" for a heading, **word** for bold and [name](https://…) for a link.'),
  text,
  h('div', { class: 'row' },
    h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
    h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'))));
  text.focus();
}

// The bar at the top of an open topic or sub-topic: back, title, play, Practise and More.
function renderFolderBar({ name, fallback, parent, count, back, practise, menu, notes }) {
  renderNotes(notes);
  const backBtn = $('words-back');
  backBtn.hidden = false;
  backBtn.onclick = back;
  backBtn.title = parent ? `Back to ${parent}` : 'Back to all topics';
  backBtn.setAttribute('aria-label', backBtn.title);
  $('topic-bar').hidden = false;
  $('topic-bar').replaceChildren(...[
    h('div', { class: 'topic-title' },
      parent ? h('button', { class: 'crumb', onclick: back }, topicGerman(parent) || parent) : null,
      titlePair(name, 'h2', fallback),
      h('span', { class: 'count' }, count)),
    topicPlayButton(name),
    h('div', { class: 'topic-actions' },
      name ? (parent ? youTubeButton(parent, name) : youTubeButton(name)) : null,
      practise ? h('button', { class: 'btn small primary', onclick: practise }, icon('practice'), 'Practise') : null,
      h('details', { class: 'more-menu' },
        h('summary', { class: 'icon-btn', icon: 'more', 'aria-label': 'More actions', title: 'More actions' }),
        h('div', { class: 'menu' },
          menuButton('book', state.notes[notes] ? 'Edit rules and tips' : 'Add rules and tips', () => editNotes(notes)),
          ...menu.filter(Boolean)))),
  ].filter(Boolean));
}

function practiseIn(value) {
  settings.topic = value;
  saveSettings();
  setView('practice');
}

function renderTopicBar(topic, words) {
  const others = topicNames().filter((t) => t && t !== topic);
  const subs = sectionNames(topic).filter(Boolean).length;
  renderFolderBar({
    name: topic,
    fallback: 'Other words',
    count: `${subs ? `${plural(subs, 'sub-topic')} · ` : ''}${plural(words.length, 'word')}`,
    back: () => openTopic(null),
    practise: words.length ? () => practiseIn(topic) : null,
    notes: noteKey(topic),
    menu: [
      topic ? menuButton('edit', 'Rename topic', () => renameTopic(topic)) : null,
      menuButton('swap', 'Swap German and English', () => swapLanguages(words, topic || 'Other words')),
      topic && others.length ? menuSelect('Make this a sub-topic of:', others.map((t) => [t, t]), (parent) => {
        if (!parent || !confirm(`Move “${topic}” into “${parent}” as a sub-topic?`)) return false;
        moveTopicsInto([topic], parent);
        return true;
      }) : null,
      topic ? menuButton('trash', 'Remove topic (keeps the words)', () => removeTopic(topic), 'danger') : null,
    ],
  });
}

function renderSectionBar(topic, section, words) {
  const MOVE_OUT = '\u0000own';
  renderFolderBar({
    name: section,
    fallback: 'Other words',
    parent: topic || 'Other words',
    count: plural(words.length, 'word'),
    back: () => openTopic(topic),
    practise: words.length ? () => practiseIn(topic + SEP + section) : null,
    notes: noteKey(topic, section),
    menu: [
      menuButton('edit', 'Rename sub-topic', () => renameSection(topic, section)),
      menuButton('swap', 'Swap German and English', () => swapLanguages(words, section)),
      menuSelect('Move to:', [[MOVE_OUT, 'Its own topic'], ...topicNames().filter((t) => t && t !== topic).map((t) => [t, `Sub-topic of ${t}`])], (target) => {
        if (!target) return false;
        moveSection(topic, section, target === MOVE_OUT ? '' : target);
        return true;
      }),
    ],
  });
}

// "Group topics" on the topic overview: tick several topics and put them into one topic as its sub-topics.
function renderOrganiseBar(names) {
  const bar = $('topic-bar');
  bar.hidden = false;
  const picked = [...state.organise];
  const targets = names.filter((t) => t && !state.organise.has(t));
  const target = h('select', { 'aria-label': 'Topic to put them into' },
    h('option', { value: NEW_TOPIC }, '+ A new topic…'),
    ...targets.map((t) => h('option', { value: t }, t)));
  bar.replaceChildren(
    h('div', { class: 'topic-title' },
      h('h2', {}, 'Group topics'),
      h('span', { class: 'count' }, picked.length ? `${plural(picked.length, 'topic')} ticked. They become sub-topics of:` : 'Tick the topics that belong together, e.g. all the “Numbers …” ones.')),
    h('div', { class: 'topic-actions' },
      picked.length ? target : null,
      picked.length ? h('button', {
        class: 'btn small primary',
        onclick: async () => {
          let parent = target.value;
          if (parent === NEW_TOPIC) parent = await nameDialog('Topic to put them in', '');
          if (parent) moveTopicsInto(picked, parent);
        },
      }, 'Group') : null,
      h('button', { class: 'btn small', onclick: () => { state.organise = null; renderWords(); } }, 'Done'),
    ),
  );
}

function renderWords() {
  renderVoiceBanner();
  renderCatTabs($('cat-tabs'));
  $('examples-note').hidden = state.words.length > 0;
  $('topic-bar').hidden = true;
  $('topic-notes').hidden = true;
  $('words-back').hidden = true;
  const list = $('word-list');
  const base = inCategory(visibleSource());
  const q = state.search.trim();
  const names = topicNames();
  if (state.openTopic !== null && !names.includes(state.openTopic)) state.openTopic = null;
  if (state.openTopic === null || (state.openSection !== null && !sectionNames(state.openTopic).includes(state.openSection))) state.openSection = null;
  if (q || state.openTopic !== null) state.organise = null;
  list.className = 'cards';
  const empty = (text) => [h('li', { class: 'empty' }, text)];

  if (!state.words.length) {
    list.replaceChildren();
  } else if (q) {
    // Search always looks through every topic.
    const found = searched(base);
    list.replaceChildren(...(found.length
      ? [h('li', { class: 'search-note' }, `${found.length} ${found.length === 1 ? 'match' : 'matches'} for “${q}” in all topics`), ...groupedCards(found, names.some(Boolean))]
      : empty(`No words match “${q}” in any topic.`)));
  } else if (!names.some(Boolean)) {
    list.replaceChildren(...(base.length ? base.map(wordCard) : empty('No words in this category yet.')));
  } else if (state.openTopic === null) {
    // Topic overview: one tile per topic; open a tile to see what is inside.
    const tiles = names.map((t) => [t, base.filter((w) => (w.topic || '') === t).length]).filter(([, n]) => n);
    if (state.organise) renderOrganiseBar(names);
    list.className = 'cards topics';
    list.replaceChildren(
      ...(tiles.length ? tiles.map(([t, n]) => topicTile(t, n)) : empty('No words in this category yet.')),
      !state.organise && tiles.length > 1
        ? h('li', { class: 'organise-row' }, h('button', { class: 'link-btn', onclick: () => { state.organise = new Set(); renderWords(); } }, 'Group topics into one…'))
        : '',
    );
  } else {
    const topic = state.openTopic;
    const inside = base.filter((w) => (w.topic || '') === topic);
    if (state.openSection !== null) {
      // An open sub-topic: just its words.
      const ws = inside.filter((w) => (w.subtopic || '') === state.openSection);
      renderSectionBar(topic, state.openSection, ws);
      list.replaceChildren(...(ws.length ? ws.map(wordCard) : empty('No words of this category here.')));
      return;
    }
    renderTopicBar(topic, inside);
    const subs = sectionNames(topic).filter(Boolean)
      .map((sec) => [sec, inside.filter((w) => w.subtopic === sec).length]).filter(([, n]) => n);
    const loose = inside.filter((w) => !w.subtopic);
    list.className = subs.length ? 'cards topics' : 'cards';
    list.replaceChildren(...(inside.length
      ? [
        ...subs.map(([sec, n]) => folderTile(sec, plural(n, 'word'), () => openTopic(topic, sec), null, topic)),
        subs.length && loose.length ? h('li', { class: 'topic-head' }, h('h3', {}, 'Other words in this topic'), h('span', { class: 'count' }, plural(loose.length, 'word'))) : null,
        ...loose.map(wordCard),
      ].filter(Boolean)
      : empty('No words of this category in this topic.')));
  }
}

// ---------- translate ----------

const translationLabel = (r) => (r.article ? `${r.article} ${r.german}` : r.german);

function renderTranslate() {
  const select = $('tr-category');
  select.replaceChildren(...categoryNames().map((n) => h('option', { value: n, selected: n === settings.addCategory }, n)));
  document.querySelectorAll('#tr-dir button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.dir === settings.trDir)));
  $('tr-input').placeholder = settings.trDir === 'de-en' ? 'z. B. das Wochenende, oder: Bis morgen!' : 'e.g. the weekend, or: See you tomorrow!';
  $('tr-input').lang = settings.trDir === 'de-en' ? 'de' : 'en';
}

// The Translate page: a word or sentence in one language, the other language out,
// with play (always the German) and "+ Add to my words".
async function translateBox(e) {
  e.preventDefault();
  const input = $('tr-input').value.trim();
  if (!input) return;
  const toEnglish = settings.trDir === 'de-en';
  const list = $('tr-results');
  $('tr-note').textContent = 'Translating…';
  list.replaceChildren();
  try {
    // Each result is a German / English pair, whichever way you translated.
    const { results, source } = toEnglish
      ? await translateToEnglish(input)
      : await translate(input).then(({ results: r, source: src }) => ({ source: src, results: r.map((x) => ({ ...x, english: input })) }));
    $('tr-note').textContent = !results.length ? `No translation found for “${input}”.`
      : source === 'machine' ? 'Machine translation: usually right for sentences, but please check with your teacher.'
        : 'From Wiktionary (written by people). The first one is the most common meaning.';
    list.replaceChildren(...results.map((r) => {
      const germanLabel = translationLabel(r);
      const stand = { id: `tr:${germanLabel}`, article: r.article, german: r.german, english: r.english };
      const btn = h('button', { class: 'icon-btn play small', icon: 'speaker', 'aria-label': `Say ${germanLabel}` });
      btn.addEventListener('click', () => (germanLabel.split(/\s+/).length > 3 ? say(germanLabel) : playWord(stand, btn, null)));
      const add = h('button', {
        class: 'btn small',
        onclick: () => {
          const { added } = addWords([{
            article: r.article, german: r.german, english: r.english, level: settings.addCategory,
            pos: guessPos(r.article, r.german, r.english),
          }]);
          add.disabled = true;
          add.replaceChildren(icon('check'), added ? `Added to ${settings.addCategory || 'your words'}` : 'Already in your words');
        },
      }, '+ Add to my words');
      // German → English shows the English meaning big, with the German it belongs to under it.
      const text = toEnglish
        ? h('span', { class: 'tr-german' }, r.english, h('span', { class: 'tr-sub', lang: 'de' }, germanLabel))
        : h('span', { class: 'tr-german', lang: 'de' }, germanLabel);
      return h('li', {}, text, btn, add);
    }));
  } catch (err) {
    $('tr-note').textContent = '';
    toast(navigator.onLine ? `Could not translate: ${err.message}. Try again in a moment.` : 'Translating needs internet.');
  }
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
      onclick: async () => {
        const name = addCategoryByName(await textDialog('New category', 'Name of the category', 'e.g. C1 or Travel'));
        if (name) {
          settings.addCategory = name;
          saveSettings();
        }
        refresh();
      },
    }, '+ New'),
  );
  $('single-submit').textContent = settings.addCategory ? `Add to ${settings.addCategory}` : 'Add word';
  const enFirst = settings.listOrder === 'en-de';
  document.querySelectorAll('#order-group button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.order === settings.listOrder)));
  $('order-example').textContent = enFirst ? 'dog - der Hund' : 'der Hund - dog';
  $('draft').placeholder = enFirst
    ? 'dog - der Hund\nto go - gehen\nexperience = die Erfahrung\nto complain - sich beschweren'
    : 'der Hund - dog\ngehen - to go\ndie Erfahrung = experience\nsich beschweren - to complain';
  $('recent').replaceChildren(...state.recent.map((r) => h('li', {}, r)));
  renderTopicPicker('in-topic');
  renderSectionPicker();
  renderTopicPicker('bulk-topic');
}

// New words get their Malayalam meaning (and example) from a free machine translation,
// one at a time in the background. Edit a card to correct it.
const mlQueue = [];
let mlRunning = false;
async function fillMalayalam(words) {
  mlQueue.push(...words.filter((w) => !w.malayalam && !w.mlTried));
  if (mlRunning || !navigator.onLine) return;
  mlRunning = true;
  while (mlQueue.length) {
    const w = mlQueue.shift();
    if (!state.words.includes(w)) continue;
    try {
      w.malayalam = await toMalayalam(w.english, 'en');
      if (w.example && !w.exampleMl && !w.example.startsWith('Plural:')) w.exampleMl = await toMalayalam(w.example, 'de');
    } catch {
      // Offline or the service is busy: leave it; the edit form can fill it in.
    }
    w.mlTried = true;
    saveWords([w]);
    if (state.view === 'words') renderWords();
    await new Promise((r) => setTimeout(r, 1200));
  }
  mlRunning = false;
}

function addWords(items) {
  const byKey = new Map(state.words.map((w) => [normalizeKey(w.article, w.german, w.english), w]));
  const existing = new Set(byKey.keys());
  const fresh = [];
  const topicFilled = [];
  let duplicates = 0;
  const now = Date.now();
  for (const item of items) {
    const key = normalizeKey(item.article, item.german, item.english);
    if (!item.german || existing.has(key)) {
      // Re-adding a word you already have gives it a topic if it had none.
      const old = byKey.get(key);
      if (old && item.topic && !old.topic) {
        old.topic = item.topic;
        old.subtopic = item.subtopic || '';
        topicFilled.push(old);
      } else if (old && item.subtopic && old.topic === item.topic && !old.subtopic) {
        old.subtopic = item.subtopic;
        topicFilled.push(old);
      }
      duplicates++;
      continue;
    }
    existing.add(key);
    // Earlier lines get a slightly newer timestamp so a pasted list keeps its order at the top.
    fresh.push({ ipa: '', respelling: '', example: '', pos: '', level: '', topic: '', subtopic: '', ...item, id: uid(), added: now - fresh.length });
  }
  ensureCategories(fresh.map((w) => w.level).filter(Boolean));
  state.words.push(...fresh);
  sortWords();
  saveWords([...fresh, ...topicFilled]);
  refresh();
  fillMalayalam(fresh);
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
  // The topic stays filled in, so several words can be added under the same topic.
  const topic = pickedTopic('in-topic');
  const subtopic = topic ? pickedTopic('in-sub') : '';
  const { added } = addWords([{
    article, german, english, topic, subtopic,
    example: exampleIn.value.trim(),
    level: settings.addCategory,
    pos: guessPos(article, german, english),
  }]);
  const label = article ? `${article} ${german}` : german;
  if (added) {
    const where = [topic, subtopic].filter(Boolean).join(' › ');
    $('single-msg').textContent = `Added “${label}” to ${settings.addCategory || 'your list'}${where ? ` · ${where}` : ''}.`;
    state.recent.unshift(`${label} → ${settings.addCategory || 'No level'}${where ? ` · ${where}` : ''}`);
    state.recent = state.recent.slice(0, 8);
    germanIn.value = '';
    englishIn.value = '';
    exampleIn.value = '';
  } else {
    $('single-msg').textContent = `“${label}” is already in your list.`;
  }
  renderAdd();
  englishIn.focus();
}

function addFromDraft() {
  const text = $('draft').value;
  const parsed = parseWordList(text, categoryNames(), settings.addCategory, settings.listOrder, pickedTopic('bulk-topic'));
  ensureCategories(parsed.newCategories);
  const { added, duplicates } = addWords(parsed.words);
  const topicCount = new Set(parsed.words.map((w) => w.topic).filter(Boolean)).size;
  const parts = [`Added ${plural(added, 'word')}${topicCount ? ` in ${plural(topicCount, 'topic')}` : ''}.`];
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
  audio.unlock();
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
  const ids = inTopic(inCategory(visibleSource())).map((w) => w.id);
  const keep = state.fc.order.filter((id) => ids.includes(id));
  state.fc.order = keep.length === ids.length ? keep : settings.shuffle ? shuffled(ids) : ids;
  state.fc.index = Math.min(state.fc.index, Math.max(0, state.fc.order.length - 1));
}

function currentCard() {
  return visibleSource().find((x) => x.id === state.fc.order[state.fc.index]);
}

function renderPractice() {
  renderCatTabs($('cat-tabs-practice'));
  renderTopicSelect($('topic-filter-practice'), $('sub-filter-practice'));
  const quizMode = settings.practiceMode === 'quiz';
  document.querySelectorAll('#practice-mode button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === settings.practiceMode)));
  $('quiz-area').hidden = !quizMode;
  $('cards-area').hidden = quizMode;
  if (quizMode) {
    renderQuiz();
    return;
  }
  const el = $('flashcard');
  const { order, index } = state.fc;
  // "Show answers" on: every card shows its meaning; off: press Show answer per card.
  const revealed = settings.showAnswers || state.fc.revealed;
  const w = currentCard();
  ['fc-prev', 'fc-next', 'fc-shuffle'].forEach((id) => { $(id).disabled = order.length < 2; });
  $('fc-shuffle').setAttribute('aria-pressed', String(!!settings.shuffle));
  $('fc-shuffle').textContent = `Shuffle: ${settings.shuffle ? 'on' : 'off'}`;
  $('fc-autoplay').checked = settings.autoplay;
  $('fc-answers').checked = settings.showAnswers;
  el.className = `flashcard ${w ? colorClass(w.level) : ''}`;
  if (!w) {
    el.replaceChildren(h('p', { class: 'empty' }, state.words.length ? 'No words in this category yet.' : 'Add some words first, then practise them here.'));
    return;
  }
  const source = sourceLine(w);
  el.replaceChildren(
    h('div', { class: 'progress' }, `${index + 1} / ${order.length}`),
    h('div', { class: 'fc-topic' }, [w.level, topicGerman(w.subtopic || '') || w.subtopic || topicGerman(w.topic || '') || w.topic].filter(Boolean).join(' · ')),
    h('div', { class: 'word', lang: 'de' }, w.article ? h('span', { class: 'article' }, w.article) : null, w.german),
    playButton(w, source),
    source,
    revealed
      ? h('div', { class: 'answer' }, soundRow(w), h('div', { class: 'english' }, w.english), malayalamMeaning(w.malayalam), exampleRow(w, source), hasForms(w) ? conjugationTable(w) : null)
      : h('button', { class: 'btn', onclick: reveal }, 'Show answer'),
  );
}

// Says the word on the card as soon as it appears (Practice → Auto-play).
function autoPlay() {
  if (settings.autoplay && state.view === 'practice' && settings.practiceMode !== 'quiz') $('flashcard').querySelector('.icon-btn.play')?.click();
}

// ---------- quiz ----------
// Four answers per question, from the words of the chosen category, topic and sub-topic.
// Kinds: see the German and pick the English, the other way round, or hear it and pick the German.

const quizWords = () => inTopic(inCategory(visibleSource()));
const quizDeckKey = () => `${settings.filter}|${settings.topic}|${settings.quizKind}|${quizWords().length}`;
const promptText = (w) => (settings.quizKind === 'en-de' ? w.english : fullGerman(w));
const answerText = (w) => (settings.quizKind === 'de-en' ? w.english : fullGerman(w));

function startQuiz(ids) {
  const pool = quizWords();
  state.quiz = {
    key: quizDeckKey(),
    queue: shuffled(ids || pool.map((w) => w.id)),
    index: 0,
    score: 0,
    wrong: [],
    picked: null,
    options: null,
  };
}

// Three wrong answers, preferably from the same sub-topic (harder, and teaches the differences).
function quizOptions(w) {
  const label = answerText(w).toLowerCase();
  const seen = new Set([label]);
  const near = shuffled(quizWords().filter((x) => x.topic === w.topic && (x.subtopic || '') === (w.subtopic || '')));
  const rest = shuffled(quizWords());
  const all = shuffled(visibleSource());
  const wrong = [];
  for (const x of [...near, ...rest, ...all]) {
    const t = answerText(x).toLowerCase();
    if (wrong.length === 3) break;
    if (seen.has(t)) continue;
    seen.add(t);
    wrong.push(x);
  }
  return shuffled([w, ...wrong]);
}

function quizWord() {
  const q = state.quiz;
  return q && visibleSource().find((x) => x.id === q.queue[q.index]);
}

function renderQuiz() {
  document.querySelectorAll('#quiz-kind button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === settings.quizKind)));
  const el = $('quiz');
  if (quizWords().length < 2) {
    el.replaceChildren(h('p', { class: 'empty' }, 'A quiz needs at least 2 words here. Choose a bigger topic or category.'));
    return;
  }
  if (!state.quiz || state.quiz.key !== quizDeckKey()) startQuiz();
  const q = state.quiz;
  if (q.index >= q.queue.length) return renderQuizEnd();
  const w = quizWord();
  if (!w) {
    q.index++;
    return renderQuiz();
  }
  q.options ||= quizOptions(w);
  const listen = settings.quizKind === 'listen';
  const play = playButton(w, null);
  const ask = listen ? 'Which word do you hear?'
    : settings.quizKind === 'en-de' ? 'What is this in German?' : 'What does this mean?';
  el.className = `flashcard quiz ${colorClass(w.level)}`;
  el.replaceChildren(
    h('div', { class: 'quiz-top' },
      h('span', { class: 'progress' }, `${q.index + 1} / ${q.queue.length}`),
      h('span', { class: 'quiz-score' }, icon('check'), String(q.score))),
    h('div', { class: 'quiz-bar' }, h('span', { style: `width:${(q.index / q.queue.length) * 100}%` })),
    h('div', { class: 'fc-topic' }, ask),
    listen ? null : h('div', { class: 'word', lang: settings.quizKind === 'en-de' ? 'en' : 'de' }, promptText(w)),
    listen || q.picked ? play : null,
    h('div', { class: 'quiz-options' }, ...q.options.map((o, i) => {
      const right = o.id === w.id;
      const cls = !q.picked ? '' : right ? ' right' : o.id === q.picked ? ' wrong' : ' dim';
      return h('button', {
        class: `quiz-option${cls}`,
        disabled: !!q.picked,
        lang: settings.quizKind === 'de-en' ? 'en' : 'de',
        onclick: () => answerQuiz(o),
      }, h('span', { class: 'key' }, String(i + 1)), answerText(o));
    })),
    q.picked ? h('div', { class: `quiz-feedback ${q.picked === w.id ? 'good' : 'bad'}` },
      h('strong', {}, q.picked === w.id ? 'Richtig! ' : 'Not quite. '),
      h('span', { lang: 'de' }, fullGerman(w)), ` = ${w.english}`,
      malayalamMeaning(w.malayalam),
      w.example ? h('div', { class: 'quiz-example', lang: 'de' }, w.example) : null) : null,
    q.picked ? h('button', { class: 'btn primary wide', id: 'quiz-next', onclick: nextQuiz }, q.index + 1 < q.queue.length ? 'Next question' : 'See my score') : null,
  );
  if (listen && !q.picked && !q.played) {
    q.played = true;
    play.click();
  }
}

function answerQuiz(option) {
  const q = state.quiz;
  const w = quizWord();
  if (!q || q.picked || !w) return;
  q.picked = option.id;
  if (option.id === w.id) q.score++;
  else q.wrong.push(w.id);
  renderQuiz();
  // Hear the right word after every answer, so sound and meaning stick together.
  if (settings.quizKind !== 'listen') $('quiz').querySelector('.icon-btn.play')?.click();
  $('quiz-next')?.focus({ preventScroll: true });
}

function nextQuiz() {
  const q = state.quiz;
  Object.assign(q, { index: q.index + 1, picked: null, options: null, played: false });
  renderQuiz();
}

function renderQuizEnd() {
  const q = state.quiz;
  const total = q.queue.length;
  const pct = Math.round((q.score / total) * 100);
  const praise = pct === 100 ? 'Perfekt!' : pct >= 80 ? 'Sehr gut!' : pct >= 50 ? 'Gut gemacht!' : 'Weiter üben!';
  const missed = [...new Set(q.wrong)].map((id) => visibleSource().find((x) => x.id === id)).filter(Boolean);
  $('quiz').className = 'flashcard quiz';
  $('quiz').replaceChildren(
    h('div', { class: 'quiz-result' }, `${q.score} / ${total}`),
    h('div', { class: 'english' }, `${praise} (${pct}%)`),
    missed.length ? h('div', { class: 'quiz-missed' },
      h('h4', {}, 'Words to practise:'),
      h('ul', {}, ...missed.map((w) => h('li', {}, h('strong', { lang: 'de' }, fullGerman(w)), ` = ${w.english}`)))) : null,
    h('div', { class: 'row center' },
      missed.length ? h('button', { class: 'btn primary', onclick: () => { startQuiz(missed.map((w) => w.id)); renderQuiz(); } }, `Practise the ${plural(missed.length, 'mistake')} again`) : null,
      h('button', { class: `btn${missed.length ? '' : ' primary'}`, onclick: () => { startQuiz(); renderQuiz(); } }, 'New round')),
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
  autoPlay();
}

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shuffle on: cards in random order; off: in your list's order.
function toggleShuffle() {
  settings.shuffle = !settings.shuffle;
  saveSettings();
  const ids = inTopic(inCategory(visibleSource())).map((w) => w.id);
  state.fc.order = settings.shuffle ? shuffled(ids) : ids;
  state.fc.index = 0;
  state.fc.revealed = false;
  renderPractice();
  autoPlay();
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
  renderStorage();
  $('ml-toggle').checked = settings.malayalam;
  renderSegmented();
  renderHdBox();
  renderSyncBox();
  applyTheme();
}

const formatBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// How much space the app takes in this browser: your words, the voice download, and the rest.
async function renderStorage() {
  const words = new Blob([JSON.stringify(state.words)]).size;
  const parts = [`Your ${plural(state.words.length, 'word')}: ${formatBytes(words)}`];
  try {
    const { usage = 0, quota = 0, usageDetails } = await navigator.storage.estimate();
    if (usageDetails?.caches !== undefined) {
      parts.push(`Voice and offline app files: ${formatBytes(usageDetails.caches)}`);
    }
    parts.push(`In total: ${formatBytes(usage)} of the ${formatBytes(quota)} this browser allows`);
  } catch {
    /* storage estimate not supported */
  }
  $('storage-used').replaceChildren(...parts.map((t) => h('li', {}, t)));
}

function renderVoices() {
  const select = $('voice-select');
  const voices = speech.germanVoices();
  const options = [h('option', { value: '' }, voices.length ? 'Automatic (German)' : 'No German voice in this browser')];
  for (const v of voices) {
    options.push(h('option', { value: v.voiceURI, selected: v.voiceURI === settings.voiceURI }, `${v.name} (${v.lang})${v.localService ? '' : ' · online'}`));
  }
  select.replaceChildren(...options);
  // Without a German browser voice these controls do nothing, so hide them.
  $('browser-voice-field').hidden = !voices.length;
  $('test-voice').hidden = !voices.length;
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
  else if (state.view === 'translate') renderTranslate();
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
  for (const v of ['words', 'add', 'translate', 'practice', 'settings']) $(`view-${v}`).hidden = v !== view;
  if (view === 'practice') state.fc.revealed = false;
  refresh();
  window.scrollTo(0, 0);
  if (view === 'practice') autoPlay();
}

// ---------- backup ----------

function exportBackup() {
  const words = state.words.map(({ audio: _audio, ...w }) => w);
  const data = { app: 'wortschatz-coach', version: 1, exported: new Date().toISOString(), categories: state.categories, words, notes: state.notes };
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
    // Rules and tips from the file fill only topics that have none, so your own notes stay as they are.
    let notesAdded = 0;
    for (const [key, text] of Object.entries(data.notes && typeof data.notes === 'object' ? data.notes : {})) {
      if (typeof text !== 'string' || !text.trim() || state.notes[key]) continue;
      state.notes[key] = text.trim();
      notesAdded++;
    }
    if (notesAdded) {
      saveNotes();
      renderWords();
    }
    toast(`Imported ${plural(added, 'word')}${notesAdded ? ` and ${plural(notesAdded, 'set')} of rules and tips` : ''}${duplicates ? `, skipped ${duplicates} duplicates` : ''}.`);
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
  const text = parseWordList($('draft').value, categoryNames(), '', settings.listOrder).unparsed.join('\n');
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
  if (settings.practiceMode === 'quiz') {
    const q = state.quiz;
    if (/^[1-4]$/.test(e.key) && q && !q.picked) $('quiz').querySelectorAll('.quiz-option')[Number(e.key) - 1]?.click();
    else if (e.key === 'Enter' && q?.picked && !e.target.closest('button')) nextQuiz();
    else if (e.key.toLowerCase() === 'l') $('quiz').querySelector('.icon-btn.play')?.click();
    return;
  }
  if (e.key === 'ArrowRight') stepCard(1);
  else if (e.key === 'ArrowLeft') stepCard(-1);
  else if (e.key === ' ') {
    e.preventDefault();
    $('fc-answers').click();
  }
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
    state.notes = await db.getMeta('notes', {});
    state.notesUpdatedAt = await db.getMeta('notesUpdatedAt', 0);
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
  $('topic-filter-practice').addEventListener('change', (e) => setTopic(e.target.value));
  $('sub-filter-practice').addEventListener('change', (e) => {
    const topic = $('topic-filter-practice').value;
    setTopic(e.target.value ? topic + SEP + e.target.value : topic);
  });
  $('fc-answers').addEventListener('change', (e) => {
    settings.showAnswers = e.target.checked;
    state.fc.revealed = false;
    saveSettings();
    renderPractice();
  });
  document.querySelectorAll('#practice-mode button').forEach((b) => b.addEventListener('click', () => {
    settings.practiceMode = b.dataset.mode;
    saveSettings();
    renderPractice();
    autoPlay();
  }));
  document.querySelectorAll('#quiz-kind button').forEach((b) => b.addEventListener('click', () => {
    settings.quizKind = b.dataset.kind;
    saveSettings();
    state.quiz = null;
    renderQuiz();
  }));
  $('ml-toggle').addEventListener('change', (e) => {
    settings.malayalam = e.target.checked;
    saveSettings();
    refresh();
  });
  $('fc-autoplay').addEventListener('change', (e) => {
    settings.autoplay = e.target.checked;
    saveSettings();
    autoPlay();
  });
  document.querySelectorAll('#tr-dir button').forEach((b) => b.addEventListener('click', () => {
    settings.trDir = b.dataset.dir;
    saveSettings();
    $('tr-results').replaceChildren();
    $('tr-note').textContent = '';
    renderTranslate();
    $('tr-input').focus();
  }));
  $('tr-category').addEventListener('change', (e) => {
    settings.addCategory = e.target.value;
    saveSettings();
  });
  $('search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderWords();
  });

  $('single-form').addEventListener('submit', addSingle);
  $('tr-form').addEventListener('submit', translateBox);
  for (const id of ['in-topic', 'in-sub', 'bulk-topic']) {
    $(`${id}-select`).addEventListener('change', (e) => {
      $(id).hidden = e.target.value !== NEW_TOPIC;
      if (!$(id).hidden) $(id).focus();
      if (id === 'in-topic') renderSectionPicker();
    });
  }
  $('in-topic').addEventListener('input', renderSectionPicker);
  document.querySelectorAll('#order-group button').forEach((b) => b.addEventListener('click', () => {
    settings.listOrder = b.dataset.order;
    saveSettings();
    renderAdd();
  }));
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
  $('fc-shuffle').addEventListener('click', toggleShuffle);
  document.addEventListener('keydown', onKey);

  $('voice-select').addEventListener('change', (e) => {
    settings.voiceURI = e.target.value;
    saveSettings();
    speech.speak('Hallo! Wie geht es dir?', voiceOpts());
  });
  $('sound-check').addEventListener('click', soundCheck);
  audio.setStalledHandler(soundBlockedHelp);
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
