import { CEFR, parseWordList, normalizeKey, uniqueTextWords, looksLikeProse } from './parser.js';
import { respell } from './respell.js';
import * as speech from './speech.js';
import * as db from './db.js';

const SETTINGS_KEY = 'wc.settings.v1';
const FILL_BATCH = 120;
const EXTRACT_BATCH = 80;
const POS = ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'article', 'numeral', 'interjection', 'phrase', 'other'];
const DEFAULT_CATEGORIES = ['A1', 'A2', 'B1', 'B2'].map((name, i) => ({ name, color: i + 1 }));
const COLOR_COUNT = 10;

const EXAMPLES = [
  { id: 'ex1', article: 'die', german: 'Schwester', english: 'sister', level: 'A1', pos: 'noun', ipa: 'ˈʃvɛstɐ', respelling: 'SHVES-tuh', example: 'Meine Schwester wohnt in Berlin.' },
  { id: 'ex2', article: '', german: 'gehen', english: 'to go', level: 'A1', pos: 'verb', ipa: 'ˈɡeːən', respelling: 'GAY-un', example: 'Wir gehen heute ins Kino.' },
  { id: 'ex3', article: 'das', german: 'Frühstück', english: 'breakfast', level: 'A1', pos: 'noun', ipa: 'ˈfʁyːʃtʏk', respelling: 'FREW-shtewk', example: 'Das Frühstück ist fertig.' },
  { id: 'ex4', article: 'die', german: 'Erfahrung', english: 'experience', level: 'A2', pos: 'noun', ipa: 'ɛɐ̯ˈfaːʁʊŋ', respelling: 'air-FAH-roong', example: 'Das war eine gute Erfahrung.' },
  { id: 'ex5', article: '', german: 'sich beschweren', english: 'to complain', level: 'B1', pos: 'verb', ipa: 'zɪç bəˈʃveːʁən', respelling: 'zikh buh-SHVAY-run', example: 'Er beschwert sich über den Lärm.' },
  { id: 'ex6', article: 'die', german: 'Umwelt', english: 'environment', level: 'B2', pos: 'noun', ipa: 'ˈʊmvɛlt', respelling: 'OOM-velt', example: 'Wir müssen die Umwelt schützen.' },
];

const ICONS = {
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

// ---------- state ----------

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

const settings = Object.assign({ voiceURI: '', rate: 0.85, filter: 'all', aiEndpoint: '', aiPasscode: '' }, loadSettings());
const state = {
  words: [],
  categories: [],
  view: 'list',
  reading: false,
  busy: false,
  fc: { order: [], index: 0, revealed: false },
};

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
const voiceOpts = () => ({ voiceURI: settings.voiceURI, rate: settings.rate });
const say = (text) => speech.speak(text, voiceOpts());
const formatIpa = (ipa) => (/^[/[]/.test(ipa) ? ipa : `/${ipa}/`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const categoryNames = () => state.categories.map((c) => c.name);

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

// ---------- categories ----------

function colorClass(level) {
  const cat = state.categories.find((c) => c.name === level);
  if (cat) return `cat${cat.color}`;
  const cefr = CEFR.indexOf(level);
  return cefr >= 0 ? `cat${cefr + 1}` : '';
}

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
    // Keep CEFR levels in order first, custom categories after in the order they were made.
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
  saveSettings();
  refresh();
}

function renderCategoryPanel() {
  $('cat-list').replaceChildren(
    ...state.categories.map((c) =>
      h('li', {},
        h('span', { class: `badge cat${c.color}` }, c.name),
        h('span', { class: 'count' }, plural(state.words.filter((w) => w.level === c.name).length, 'word')),
        h('button', { class: 'icon-btn small remove', icon: 'close', 'aria-label': `Delete category ${c.name}`, onclick: () => deleteCategory(c.name) }),
      ),
    ),
  );
}

// ---------- filtering ----------

const showingExamples = () => state.words.length === 0;
const visibleSource = () => (showingExamples() ? EXAMPLES : state.words);

function filtered() {
  const list = visibleSource();
  if (settings.filter === 'all') return list;
  if (settings.filter === 'none') return list.filter((w) => !w.level);
  return list.filter((w) => w.level === settings.filter);
}

function renderChips(container) {
  const list = visibleSource();
  const noLevel = list.filter((w) => !w.level).length;
  const names = categoryNames();
  if ((settings.filter === 'none' && !noLevel) || (!['all', 'none'].includes(settings.filter) && !names.includes(settings.filter))) {
    settings.filter = 'all';
  }
  const chips = [['all', 'All', list.length, ''], ...state.categories.map((c) => [c.name, c.name, list.filter((w) => w.level === c.name).length, `cat${c.color}`])];
  if (noLevel) chips.push(['none', 'No level', noLevel, '']);
  container.replaceChildren(
    ...chips.map(([value, label, count, color]) =>
      h('button', {
        class: 'chip',
        'aria-pressed': String(settings.filter === value),
        onclick: () => {
          settings.filter = value;
          saveSettings();
          buildDeck();
          render();
        },
      },
      color ? h('span', { class: 'dot', style: `background: var(--${color}-fg)` }) : null,
      label,
      h('span', { class: 'count' }, String(count))),
    ),
  );
}

// ---------- word cards ----------

function respellingEl(w) {
  if (w.respelling) return h('span', { class: 'respell', title: 'Stressed syllable in capitals' }, w.respelling);
  const guess = respell(fullGerman(w));
  if (!guess) return null;
  return h('span', { class: 'respell auto', title: 'Automatic guess, may be wrong. Use the AI helper or ask your teacher to check it.' }, guess);
}

function soundRow(w) {
  const parts = [w.ipa ? h('span', { class: 'ipa' }, formatIpa(w.ipa)) : null, respellingEl(w)].filter(Boolean);
  return parts.length ? h('div', { class: 'sound' }, parts) : null;
}

function exampleRow(w) {
  if (!w.example) return null;
  return h('div', { class: 'sentence' },
    h('span', { lang: 'de' }, w.example),
    h('button', { class: 'icon-btn small', icon: 'play', 'aria-label': 'Play example sentence', onclick: () => say(w.example) }),
  );
}

function levelBadge(w, editable) {
  if (!editable) return h('span', { class: `badge ${colorClass(w.level)}` }, w.level || 'No level');
  const names = categoryNames();
  const options = [...names, ...(w.level && !names.includes(w.level) ? [w.level] : [])];
  return h('select', {
    class: `badge ${colorClass(w.level)}`,
    'aria-label': `Category of ${fullGerman(w)}`,
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
  return h('li', { class: `card${isExample ? ' example' : ''}` },
    h('div', { class: 'meta' },
      levelBadge(w, !isExample),
      w.pos ? h('span', { class: 'pos' }, w.pos) : null,
      isExample ? h('span', { class: 'tag' }, 'Example') : null,
    ),
    h('div', { class: 'word', lang: 'de' }, w.article ? h('span', { class: 'article' }, w.article) : null, w.german),
    h('div', { class: 'english' }, w.english),
    soundRow(w),
    h('div', { class: 'actions' },
      h('button', { class: 'icon-btn speak', icon: 'speaker', 'aria-label': `Say ${fullGerman(w)}`, onclick: () => say(fullGerman(w)) }),
      isExample ? null : h('button', { class: 'icon-btn remove', icon: 'close', 'aria-label': `Remove ${fullGerman(w)}`, onclick: () => removeWord(w.id) }),
    ),
    exampleRow(w),
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

function renderList() {
  renderChips($('chips'));
  $('examples-note').hidden = !showingExamples();
  const list = filtered();
  $('word-list').replaceChildren(
    ...(list.length
      ? list.map((w) => wordCard(w, showingExamples()))
      : [h('li', { class: 'empty' }, 'No words in this category yet.')]),
  );
  renderCategoryPanel();
  $('storage-msg').textContent = `${plural(state.words.length, 'word')} saved on this device${dbOk ? ' (IndexedDB)' : ''}. Export a backup now and then; clearing browser data deletes it.`;
}

// ---------- flashcards ----------

function buildDeck() {
  const ids = filtered().map((w) => w.id);
  const keep = state.fc.order.filter((id) => ids.includes(id));
  state.fc.order = keep.length === ids.length ? keep : ids;
  state.fc.index = Math.min(state.fc.index, Math.max(0, state.fc.order.length - 1));
  state.fc.revealed = false;
}

function renderCards() {
  renderChips($('chips-cards'));
  const el = $('flashcard');
  const { order, index, revealed } = state.fc;
  const w = visibleSource().find((x) => x.id === order[index]);
  ['fc-prev', 'fc-next', 'fc-shuffle'].forEach((id) => { $(id).disabled = order.length < 2; });
  if (!w) {
    el.replaceChildren(h('p', { class: 'empty' }, 'No words in this category yet.'));
    return;
  }
  el.replaceChildren(
    h('div', { class: 'progress' }, `${index + 1} / ${order.length}${showingExamples() ? ' · Examples' : ''}`),
    levelBadge(w, false),
    h('div', { class: 'word', lang: 'de' }, w.article ? h('span', { class: 'article' }, w.article) : null, w.german),
    h('button', { class: 'btn primary', onclick: () => say(fullGerman(w)) }, 'Listen'),
    revealed
      ? h('div', { class: 'answer' }, soundRow(w), h('div', { class: 'english' }, w.english), exampleRow(w))
      : h('button', { class: 'btn', onclick: () => { state.fc.revealed = true; renderCards(); } }, 'Show answer'),
  );
}

function stepCard(delta) {
  const n = state.fc.order.length;
  if (!n) return;
  state.fc.index = (state.fc.index + delta + n) % n;
  state.fc.revealed = false;
  renderCards();
}

function shuffleDeck() {
  const a = state.fc.order;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  state.fc.index = 0;
  state.fc.revealed = false;
  renderCards();
}

function render() {
  if (state.view === 'list') renderList();
  else renderCards();
}

function refresh() {
  buildDeck();
  render();
}

function setView(view) {
  state.view = view;
  speech.stop();
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  $('view-list').hidden = view !== 'list';
  $('view-cards').hidden = view !== 'cards';
  refresh();
  window.scrollTo(0, 0);
}

// ---------- adding words ----------

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

function addFromDraft() {
  const text = $('draft').value;
  const parsed = parseWordList(text, categoryNames());
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
  state.reading = true;
  $('read-btn').textContent = 'Stop';
  speech.speakLong(text, voiceOpts(), () => {
    state.reading = false;
    $('read-btn').textContent = 'Read text aloud';
  });
}

// ---------- backup ----------

function exportBackup() {
  const data = { app: 'wortschatz-coach', version: 1, exported: new Date().toISOString(), categories: state.categories, words: state.words };
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
      .map(({ id, added, ...w }) => w);
    const { added, duplicates } = addWords(items);
    toast(`Imported ${plural(added, 'word')}${duplicates ? `, skipped ${duplicates} duplicates` : ''}.`);
  } catch {
    toast('That file is not a Wortschatz Coach backup.');
  }
}

// ---------- voice & speed ----------

function renderVoices() {
  const select = $('voice-select');
  const voices = speech.germanVoices();
  const options = [h('option', { value: '' }, voices.length ? 'Automatic (German)' : 'No German voice found, using default')];
  for (const v of voices) {
    options.push(h('option', { value: v.voiceURI, selected: v.voiceURI === settings.voiceURI }, `${v.name} (${v.lang})${v.localService ? '' : ' · online'}`));
  }
  select.replaceChildren(...options);
  if (!voices.some((v) => v.voiceURI === settings.voiceURI)) select.value = '';
}

function renderSpeed() {
  document.querySelectorAll('#speed-group button').forEach((b) => {
    b.setAttribute('aria-checked', String(Number(b.dataset.rate) === settings.rate));
  });
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
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;
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

let dbOk = false;

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

  const draft = $('draft');
  draft.addEventListener('input', saveDraftSoon);
  if (!state.words.length || draft.value) $('add-panel').open = true;

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
  $('fill-btn').addEventListener('click', fillMissing);

  $('cat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('cat-name');
    const raw = input.value.trim();
    if (!raw) return;
    const name = CEFR.find((c) => c.toLowerCase() === raw.toLowerCase()) || raw;
    const added = ensureCategories([name]);
    toast(added.length ? `Added category “${name}”.` : `“${name}” already exists.`);
    input.value = '';
    refresh();
  });
  $('export-btn').addEventListener('click', exportBackup);
  $('import-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importBackup(file);
  });

  $('voice-select').addEventListener('change', (e) => {
    settings.voiceURI = e.target.value;
    saveSettings();
    say('Hallo! Wie geht es dir?');
  });
  document.querySelectorAll('#speed-group button').forEach((b) =>
    b.addEventListener('click', () => {
      settings.rate = Number(b.dataset.rate);
      saveSettings();
      renderSpeed();
    }),
  );

  const aiEndpoint = $('ai-endpoint');
  const aiPasscode = $('ai-passcode');
  aiEndpoint.value = settings.aiEndpoint;
  aiPasscode.value = settings.aiPasscode;
  aiEndpoint.addEventListener('change', () => { settings.aiEndpoint = aiEndpoint.value.trim(); saveSettings(); });
  aiPasscode.addEventListener('change', () => { settings.aiPasscode = aiPasscode.value; saveSettings(); });

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('fc-prev').addEventListener('click', () => stepCard(-1));
  $('fc-next').addEventListener('click', () => stepCard(1));
  $('fc-shuffle').addEventListener('click', shuffleDeck);

  if (!speech.supported) {
    $('voice-panel').open = true;
    $('voice-select').disabled = true;
    toast('This browser cannot speak text. Try Chrome, Edge or Safari.');
  }
  speech.onVoicesChanged(renderVoices);
  renderSpeed();
  setupInstall();
  refresh();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
