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

async function fromMyMemory(english) {
  const params = new URLSearchParams({ langpair: 'en|de', q: english });
  const res = await fetch(`${MYMEMORY}?${params}`);
  if (!res.ok) throw new Error(`Translation service HTTP ${res.status}`);
  const data = await res.json();
  const source = english.trim().toLowerCase();
  // The service returns several suggestions of mixed quality; take the one most of them agree on.
  const votes = new Map();
  for (const t of [data.responseData?.translatedText, ...(data.matches || []).map((m) => m.translation)]) {
    const text = (t || '').trim();
    if (!text || text.toLowerCase() === source || /[<>{}]|^[A-Z]{2,}\)?$/.test(text)) continue;
    const key = text.toLowerCase().replace(/[.!?]+$/, '');
    const entry = votes.get(key) || { text, count: 0 };
    entry.count++;
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
