// Parses a pasted word list ("der Hund - dog") into word objects.
// A word's `level` is the name of its category (A1, B2, or a custom one like "Travel");
// its `topic` is the heading it was listed under ("Time Expressions – Zeitangaben").

export const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const CEFR_LINE = /^#*\s*(?:level|niveau|stufe)?\s*(A1|A2|B1|B2|C1|C2)\s*[:#]*\s*$/i;
// "## 1. Time Expressions – Zeitangaben": a Markdown heading is never a word.
const HEADING = /^#{1,6}\s*(.+?)\s*#*\s*$/;
// "Time Expressions:" on its own line also starts a topic.
const COLON_HEADING = /^([^:=\t|]{2,80}):$/;
const TAG = /\s*[([]\s*([^()[\]]{1,30}?)\s*[)\]]\s*$/;
// Tab, a dash with spaces on both sides (so "E-Mail" stays whole), "=", or ": ".
const SEPARATOR = /\t+|\s+[-–—]\s+|\s*=\s*|:\s+/;
const EXAMPLE_SEP = /\s+\|\s+/;
const ARTICLE = /^(der|die|das)\s+(.+)$/i;

// Identity of a word for spotting duplicates. The English meaning is part of it, so
// "Morgen = morning" and "Morgen = tomorrow" are kept as two words.
export function normalizeKey(article, german, english = '') {
  return `${article || ''} ${german} | ${english}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

// "1. Time Expressions – Zeitangaben" -> "Time Expressions – Zeitangaben"
export function cleanTopic(text) {
  return stripNumbering(text.replace(/[*_]+/g, '').trim()).replace(/^\d+\s*[.)]?\s*/, '').trim().slice(0, 80);
}

export function guessPos(article, german, english) {
  if (article) return 'noun';
  if (/^sich\s/i.test(german) || /^to\s/i.test(english)) return 'verb';
  return '';
}

// Removes list numbering such as "7. " or "7) " (but keeps "12 Monate").
export function stripNumbering(text) {
  return text.replace(/^\s*\d+\s*[.)]\s+/, '');
}

export function splitArticle(german) {
  german = stripNumbering(german);
  const m = german.match(ARTICLE);
  return m ? { article: m[1].toLowerCase(), german: m[2].trim() } : { article: '', german: german.trim() };
}

// Returns the canonical category name for `name`, or '' if it is not a CEFR level or a known category.
export function matchCategory(name, categories) {
  const n = name.trim().toLowerCase();
  const cefr = CEFR.find((c) => c.toLowerCase() === n);
  if (cefr) return cefr;
  return categories.find((c) => c.toLowerCase() === n) || '';
}

// Returns { words, unparsed, newCategories, topics }. `categories` is the list of existing
// category names; words before any level line go to `defaultLevel`. `order` says which language
// comes first on a line: 'de-en' ("der Hund - dog") or 'en-de' ("dog - der Hund").
export function parseWordList(text, categories = [], defaultLevel = '', order = 'de-en', defaultTopic = '') {
  const words = [];
  const unparsed = [];
  const known = [...categories];
  const newCategories = [];
  const topics = [];
  let level = defaultLevel;
  let topic = defaultTopic;

  const useCategory = (name) => {
    if (!known.some((c) => c.toLowerCase() === name.toLowerCase())) {
      known.push(name);
      newCategories.push(name);
    }
    return name;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    const cefrLine = line.match(CEFR_LINE);
    if (cefrLine) {
      level = useCategory(cefrLine[1].toUpperCase());
      continue;
    }
    const heading = line.match(HEADING) || (!SEPARATOR.test(line) && line.match(COLON_HEADING));
    const plain = (heading ? heading[1] : line).replace(/[:#\s]+$/, '');
    // A heading or bare line naming one of your categories ("Travel", "# A2") sets the category.
    const knownLine = (heading || !SEPARATOR.test(line)) && matchCategory(plain, known);
    if (knownLine) {
      level = knownLine;
      continue;
    }
    // Any other heading starts a topic; the words below it belong to that topic.
    if (heading) {
      topic = cleanTopic(heading[1]);
      if (topic && !topics.includes(topic)) topics.push(topic);
      continue;
    }

    let example = '';
    const exParts = line.split(EXAMPLE_SEP);
    if (exParts.length > 1) {
      line = exParts[0];
      example = exParts.slice(1).join(' | ').trim();
    }

    // "(B1)" may sit at the end of the word part or at the very end after the example.
    let lineLevel = level;
    for (const part of ['line', 'example']) {
      const text = part === 'line' ? line : example;
      const tag = text.match(TAG);
      const tagCategory = tag && matchCategory(tag[1], known);
      if (!tagCategory) continue;
      lineLevel = useCategory(tagCategory);
      if (part === 'line') line = text.slice(0, tag.index).trim();
      else example = text.slice(0, tag.index).trim();
    }

    const sep = line.match(SEPARATOR);
    if (!sep || sep.index === 0) {
      unparsed.push(rawLine.trim());
      continue;
    }
    const left = stripNumbering(line.slice(0, sep.index).trim().replace(/^[-*•]\s+/, ''));
    const right = line.slice(sep.index + sep[0].length).trim();
    if (!left || !right) {
      unparsed.push(rawLine.trim());
      continue;
    }

    const [germanSide, english] = order === 'en-de' ? [right, left] : [left, right];
    const { article, german } = splitArticle(germanSide);
    words.push({
      german,
      article,
      english,
      level: lineLevel,
      topic,
      pos: guessPos(article, german, english),
      example,
    });
  }
  return { words, unparsed, newCategories, topics };
}

// Unique German-looking words in free text, in order of appearance.
export function uniqueTextWords(text) {
  const seen = new Set();
  const out = [];
  for (const w of text.match(/[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*/g) || []) {
    if (w.length < 2) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

// True when the text looks like ordinary sentences rather than a word list.
export function looksLikeProse(parsed) {
  const letters = parsed.unparsed.join(' ').replace(/[^A-Za-zÄÖÜäöüß]/g, '').length;
  return letters >= 12 && parsed.unparsed.length >= parsed.words.length;
}
