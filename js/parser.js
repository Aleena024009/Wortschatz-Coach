// Parses a pasted word list ("der Hund - dog") into word objects.
// A word's `level` is the name of its category (A1, B2, or a custom one like "Travel").

export const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const CEFR_LINE = /^#*\s*(?:level|niveau|stufe)?\s*(A1|A2|B1|B2|C1|C2)\s*[:#]*\s*$/i;
const HEADER_LINE = /^#+\s*([^#:\t=]{1,30}?)\s*[:#]*\s*$/;
const TAG = /\s*[([]\s*([^()[\]]{1,30}?)\s*[)\]]\s*$/;
// Tab, a dash with spaces on both sides (so "E-Mail" stays whole), "=", or ": ".
const SEPARATOR = /\t+|\s+[-–—]\s+|\s*=\s*|:\s+/;
const EXAMPLE_SEP = /\s+\|\s+/;
const ARTICLE = /^(der|die|das)\s+(.+)$/i;

export function normalizeKey(article, german) {
  return `${article || ''} ${german}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function guessPos(article, german, english) {
  if (article) return 'noun';
  if (/^sich\s/i.test(german) || /^to\s/i.test(english)) return 'verb';
  return '';
}

export function splitArticle(german) {
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

// Returns { words, unparsed, newCategories }. `categories` is the list of existing category names.
export function parseWordList(text, categories = []) {
  const words = [];
  const unparsed = [];
  const known = [...categories];
  const newCategories = [];
  let level = '';

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
    const plain = line.replace(/^#+\s*/, '').replace(/[:#\s]+$/, '');
    const knownLine = !SEPARATOR.test(line) && matchCategory(plain, known);
    if (knownLine) {
      level = knownLine;
      continue;
    }
    const header = line.match(HEADER_LINE);
    if (header) {
      level = useCategory(header[1]);
      continue;
    }

    let lineLevel = level;
    const tag = line.match(TAG);
    const tagCategory = tag && matchCategory(tag[1], known);
    if (tagCategory) {
      lineLevel = useCategory(tagCategory);
      line = line.slice(0, tag.index).trim();
    }

    let example = '';
    const exParts = line.split(EXAMPLE_SEP);
    if (exParts.length > 1) {
      line = exParts[0];
      example = exParts.slice(1).join(' | ').trim();
    }

    const sep = line.match(SEPARATOR);
    if (!sep || sep.index === 0) {
      unparsed.push(rawLine.trim());
      continue;
    }
    const left = line.slice(0, sep.index).trim().replace(/^[-*•]\s+/, '');
    const english = line.slice(sep.index + sep[0].length).trim();
    if (!left || !english) {
      unparsed.push(rawLine.trim());
      continue;
    }

    const { article, german } = splitArticle(left);
    words.push({
      german,
      article,
      english,
      level: lineLevel,
      pos: guessPos(article, german, english),
      example,
    });
  }
  return { words, unparsed, newCategories };
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
