import { CEFR, parseWordList, normalizeKey, uniqueTextWords, looksLikeProse, splitArticle, guessPos } from './parser.js';
import { respell } from './respell.js';
import * as speech from './speech.js';
import * as audio from './audio.js';
import * as db from './db.js';

const SETTINGS_KEY = 'wc.settings.v1';
const FILL_BATCH = 120;
const EXTRACT_BATCH = 80;
const POS = ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'article', 'numeral', 'interjection', 'phrase', 'other'];
const DEFAULT_CATEGORIES = ['A1', 'A2', 'B1', 'B2'].map((name, i) => ({ name, color: i + 1 }));
const COLOR_COUNT = 10;
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
  { voiceURI: '', rate: 0.85, source: 'recording', filter: 'all', addCategory: 'A1', aiEndpoint: '', aiPasscode: '' },
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
const saveCategories = () => persist(db.setMeta('categories', state.categories));

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

// Sentences and free text: device voice only.
function say(text) {
  audio.stop();
  if (!speech.supported || !speech.hasAnyVoice()) {
    toast('This browser has no voice for sentences. See Settings → Pronunciation.', 'Open', () => setView('settings'));
    return;
  }
  speech.speak(text, { voiceURI: settings.voiceURI, rate: settings.rate });
}

// Single words: a native-speaker recording when there is one, otherwise the device voice.
async function playWord(w, btn) {
  const wantRecording = settings.source === 'recording' || !hasGermanVoice();
  if (wantRecording && navigator.onLine) {
    if (w.audio === undefined) {
      btn?.classList.add('loading');
      try {
        w.audio = await audio.findRecording(fullGerman(w));
        if (!w.id.startsWith('ex')) persist(db.putWords([w]));
      } catch {
        /* lookup failed (network); try again next time */
      }
      btn?.classList.remove('loading');
    }
    if (w.audio) {
      try {
        speech.stop();
        await audio.play(w.audio, RECORDING_RATE[settings.rate] || 1);
        return;
      } catch {
        /* fall back to the device voice */
      }
    }
  }
  if (speech.supported && speech.hasAnyVoice()) {
    audio.stop();
    speech.speak(fullGerman(w), { voiceURI: settings.voiceURI, rate: settings.rate });
    return;
  }
  toast(navigator.onLine
    ? 'No recording for this word, and this browser has no voice. See Settings → Pronunciation.'
    : 'Recordings need internet, and this browser has no voice. See Settings → Pronunciation.',
  'Open', () => setView('settings'));
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
  if (affected.length) persist(db.putWords(affected));
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

function exampleRow(w) {
  if (!w.example) return null;
  return h('div', { class: 'sentence' },
    h('span', { lang: 'de' }, w.example),
    h('button', { class: 'icon-btn small', icon: 'play', 'aria-label': 'Play example sentence', onclick: () => say(w.example) }),
  );
}

function playButton(w) {
  const btn = h('button', { class: 'icon-btn play', icon: 'speaker', 'aria-label': `Say ${fullGerman(w)}` });
  btn.addEventListener('click', () => playWord(w, btn));
  return btn;
}

function levelSelect(w) {
  const names = categoryNames();
  const options = [...names, ...(w.level && !names.includes(w.level) ? [w.level] : [])];
  return h('select', {
    class: `badge ${colorClass(w.level)}`,
    'aria-label': `Category of ${fullGerman(w)}`,
    title: 'Move to another category',
    onchange: (e) => {
      w.level = e.target.value;
      persist(db.putWords([w]));
      refresh();
    },
  },
  ...options.map((name) => h('option', { value: name, selected: name === w.level }, name)),
  h('option', { value: '', selected: !w.level }, 'No level'));
}

function wordCard(w, isExample) {
  return h('li', { class: `card ${colorClass(w.level)}${isExample ? ' example' : ''}` },
    h('div', { class: 'card-head' },
      h('div', { class: 'text' },
        h('div', { class: 'word', lang: 'de' }, w.article ? h('span', { class: 'article' }, w.article) : null, w.german),
        h('div', { class: 'english' }, w.english),
      ),
      playButton(w),
    ),
    soundRow(w),
    exampleRow(w),
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
  persist(db.deleteWords([id]));
  refresh();
  toast(`Removed “${removed.german}”`, 'Undo', () => {
    state.words.push(removed);
    sortWords();
    persist(db.putWords([removed]));
    refresh();
  });
}

function renderVoiceBanner() {
  const banner = $('voice-banner');
  banner.hidden = !state.voicesReady || hasGermanVoice();
  if (banner.hidden) return;
  banner.replaceChildren(
    h('div', {},
      h('strong', {}, 'This browser has no German voice. '),
      'Words play real recordings from native speakers (needs internet). Example sentences need a German voice.'),
    h('button', { class: 'btn small', onclick: () => setView('settings') }, 'How to fix'),
  );
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
  if (fresh.length) persist(db.putWords(fresh));
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

function toggleReadAloud() {
  if (state.reading) {
    speech.stop();
    return;
  }
  const text = $('draft').value.trim();
  if (!text) {
    $('add-msg').textContent = 'Paste some text first.';
    return;
  }
  if (!speech.supported || !speech.hasAnyVoice()) {
    say(text);
    return;
  }
  state.reading = true;
  $('read-btn').textContent = 'Stop';
  speech.speakLong(text, { voiceURI: settings.voiceURI, rate: settings.rate }, () => {
    state.reading = false;
    $('read-btn').textContent = 'Read text aloud';
  });
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
  el.replaceChildren(
    h('div', { class: 'progress' }, `${index + 1} / ${order.length}${showingExamples() ? ' · Examples' : ''}`),
    h('span', { class: `badge ${colorClass(w.level)}` }, w.level || 'No level'),
    h('div', { class: 'word', lang: 'de' }, w.article ? h('span', { class: 'article' }, w.article) : null, w.german),
    playButton(w),
    revealed
      ? h('div', { class: 'answer' }, soundRow(w), h('div', { class: 'english' }, w.english), exampleRow(w))
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
  $('storage-msg').textContent = `${plural(state.words.length, 'word')} saved on this device${dbOk ? ' (IndexedDB)' : ''}. Each device and browser keeps its own list; use a backup file to move it. Clearing browser data deletes it.`;
  renderSegmented();
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
      if (changed.length) persist(db.putWords(changed));
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

// ---------- wiring ----------

function onKey(e) {
  if (state.view !== 'practice' || e.target.closest('input, textarea, select')) return;
  if (e.key === 'ArrowRight') stepCard(1);
  else if (e.key === 'ArrowLeft') stepCard(-1);
  else if (e.key === ' ' && !state.fc.revealed) { e.preventDefault(); reveal(); }
  else if (e.key.toLowerCase() === 'l') {
    const w = currentCard();
    if (w) playWord(w);
  }
}

async function init() {
  dbOk = await db.init();
  try {
    state.words = await db.getAllWords();
    state.categories = await db.getMeta('categories', null);
    $('draft').value = await db.getMeta('draft', '');
  } catch {
    toast('Could not open the local database.');
  }
  if (!Array.isArray(state.categories)) {
    state.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    saveCategories();
  }
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
    say('Hallo! Wie geht es dir?');
  });
  $('test-voice').addEventListener('click', () => say('Hallo! Wie geht es dir?'));
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
