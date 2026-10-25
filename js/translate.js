// English → German translation without an account or key.
// Words and short phrases come from English Wiktionary's translation tables, which are
// written by people and give each noun's gender (so der/die/das is known). Sentences,
// and anything Wiktionary has no entry for, use the free MyMemory machine translation.

import { splitArticle } from './parser.js';

const WIKTIONARY = 'https://en.wiktionary.org/w/api.php';
const MYMEMORY = 'https://api.mymemory.translated.net/get';
const ARTICLE_FOR = { m: 'der', f: 'die', n: 'das', p: 'die' };

async function wikitext(page) {
  const params = new URLSearchParams({ action: 'parse', format: 'json', origin: '*', prop: 'wikitext', redirects: '1', page });
  const res = await fetch(`${WIKTIONARY}?${params}`);
  if (!res.ok) throw new Error(`Wiktionary HTTP ${res.status}`);
  const data = await res.json();
  return data.parse?.wikitext?.['*'] || '';
}

// "sich [[beschweren]]" -> "sich beschweren"
const cleanLinks = (text) => text.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,}/g, '').trim();

async function fromWiktionary(english) {
  const isVerb = /^to\s+/i.test(english);
  const wantsNoun = /^(the|a|an)\s+/i.test(english);
  const term = english.replace(/^(to|the|a|an)\s+/i, '').replace(/[.!?]+$/, '').trim();
  if (!term || term.split(/\s+/).length > 4) return [];
  let text = await wikitext(term);
  if (!text && term !== term.toLowerCase()) text = await wikitext(term.toLowerCase());
  // Big entries keep their translations on a separate "/translations" page; it lists the main meaning first.
  if (/\{\{(see translation subpage|trans-see|checktrans)/i.test(text) || /\/translations/.test(text)) {
    text = `${await wikitext(`${term}/translations`)}\n${text}`;
  }
  const seen = new Set();
  const results = [];
  for (const m of text.matchAll(/\{\{tt?\+?\|de\|([^|}]+)((?:\|[^}]*)?)\}\}/g)) {
    const german = cleanLinks(m[1]);
    const gender = (m[2].match(/\|([mfnp])(?:-p)?(?=\||$)/) || [])[1];
    const result = { german, article: gender ? ARTICLE_FOR[gender] : '', noun: !!gender };
    const key = `${result.article} ${german}`.toLowerCase();
    if (!german || seen.has(key)) continue;
    seen.add(key);
    results.push(result);
  }
  // "to dog" wants the verb, "the dog" the noun; otherwise keep Wiktionary's order.
  if (isVerb) results.sort((a, b) => a.noun - b.noun);
  if (wantsNoun) results.sort((a, b) => b.noun - a.noun);
  return results.slice(0, 6);
}

async function fromMyMemory(english, langpair = 'en|de') {
  const params = new URLSearchParams({ langpair, q: english });
  const res = await fetch(`${MYMEMORY}?${params}`);
  if (!res.ok) throw new Error(`Translation service HTTP ${res.status}`);
  const data = await res.json();
  const source = english.trim().toLowerCase();
  // The service returns several suggestions of mixed quality. Stored translations of a *similar*
  // sentence can be wrong ("…morgen nicht…"), so exact matches and its own machine translation
  // count extra; otherwise the one most suggestions agree on wins.
  const votes = new Map();
  const suggestions = [{ translation: data.responseData?.translatedText }, ...(data.matches || [])];
  for (const m of suggestions) {
    const text = (m.translation || '').trim();
    if (!text || text.toLowerCase() === source || /[<>{}]|^[A-Z]{2,}\)?$/.test(text)) continue;
    const key = text.toLowerCase().replace(/[.!?]+$/, '');
    const entry = votes.get(key) || { text, count: 0 };
    entry.count += 1 + (Number(m.match) >= 0.99 ? 3 : 0) + (m['created-by'] === 'MT!' ? 2 : 0);
    votes.set(key, entry);
  }
  return [...votes.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map(({ text }) => ({ ...splitArticle(text), noun: false }));
}

// Returns { results: [{ german, article }], source: 'wiktionary' | 'machine' }.
export async function translate(english) {
  const text = english.trim();
  if (!text) return { results: [], source: '' };
  try {
    const results = await fromWiktionary(text);
    if (results.length) return { results, source: 'wiktionary' };
  } catch {
    /* Wiktionary busy or offline: fall back to machine translation */
  }
  return { results: await fromMyMemory(text), source: 'machine' };
}

// German → English for a short name (used to suggest the English name of a topic).
export async function toEnglish(german) {
  const params = new URLSearchParams({ langpair: 'de|en', q: german });
  const res = await fetch(`${MYMEMORY}?${params}`);
  if (!res.ok) throw new Error(`Translation service HTTP ${res.status}`);
  const text = ((await res.json()).responseData?.translatedText || '').trim();
  return text.toLowerCase() === german.trim().toLowerCase() || /[<>{}]/.test(text) ? '' : text;
}

// Templates in a Wiktionary definition line: {{l|en|day}} -> "day", labels like {{lb|de|colloquial}} dropped.
function cleanDefinition(line) {
  return cleanLinks(line
    .replace(/\{\{(?:l|m|w)\|[^|}]*\|([^|}]+)[^}]*\}\}/g, '$1')
    .replace(/\{\{(?:lb|lbl|q|qual|qualifier|gloss|gl|sense|tlb)\|[^}]*\}\}/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .replace(/\s+([;,.!?)])/g, '$1')
    .replace(/^[\s;:,.]+|[\s;:,]+$/g, '');
}

async function germanFromWiktionary(german) {
  const { article, german: term } = splitArticle(german.replace(/[.!?]+$/, '').trim());
  if (!term || term.split(/\s+/).length > 4) return [];
  // "sich beschweren" is listed under "beschweren".
  const base = term.replace(/^sich\s+/i, '');
  const variants = [...new Set([term, base, base[0].toUpperCase() + base.slice(1), base[0].toLowerCase() + base.slice(1)])];
  // With "der/die/das" in front it is a noun, so try the capitalised page first.
  if (article) variants.sort((a, b) => (b[0] === b[0].toUpperCase()) - (a[0] === a[0].toUpperCase()));
  for (const page of variants) {
    const text = await wikitext(page).catch(() => '');
    const start = text.indexOf('==German==');
    if (start < 0) continue;
    const rest = text.slice(start + 10);
    const end = rest.search(/\n==[^=]/);
    const section = end < 0 ? rest : rest.slice(0, end);
    const gender = (section.match(/\{\{de-noun\|([mfn])/) || [])[1];
    const seen = new Set();
    const results = [];
    const lines = [...section.matchAll(/^#\s+(?![:*])(.+)$/gm)].map((m) => m[1]);
    // For "sich …" the reflexive meanings come first.
    if (term !== base) lines.sort((a, b) => /reflexive/.test(b) - /reflexive/.test(a));
    for (const line of lines) {
      const meaning = cleanDefinition(line);
      const key = meaning.toLowerCase();
      if (!meaning || meaning.length > 80 || seen.has(key)) continue;
      seen.add(key);
      results.push({ english: meaning, german: term === base ? page : term, article: article || (gender && page[0] === page[0].toUpperCase() ? ARTICLE_FOR[gender] : '') });
    }
    if (results.length) return results.slice(0, 6);
  }
  return [];
}

// German → English. Returns { results: [{ english, german, article }], source }.
export async function translateToEnglish(german) {
  const text = german.trim();
  if (!text) return { results: [], source: '' };
  try {
    const results = await germanFromWiktionary(text);
    if (results.length) return { results, source: 'wiktionary' };
  } catch {
    /* Wiktionary busy or offline: fall back to machine translation */
  }
  const { article, german: plain } = splitArticle(text);
  // Drop suggestions that are just part of the German again, or far longer than it (unrelated sentences).
  const machine = (await fromMyMemory(text, 'de|en')).filter((r) => {
    const out = (r.article ? `${r.article} ${r.german}` : r.german).toLowerCase().replace(/[.!?]+$/, '');
    return !text.toLowerCase().includes(out) && out.length <= text.length * 2.5 + 15;
  });
  return { results: machine.map((r) => ({ english: r.article ? `${r.article} ${r.german}` : r.german, german: plain, article })), source: 'machine' };
}
