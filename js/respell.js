// Rule-based English-style respelling of German, e.g. "Schwester" -> "SHVES-tuh".
// It is an approximation (compound words and loanwords will be off); the AI or
// your teacher can replace it with a checked one.

const PREFIXES = { zer: 'tser', ver: 'fer', ent: 'ent', emp: 'emp', be: 'buh', ge: 'guh', er: 'er' };
const STRESSED_ENDINGS = ['ion', 'tät', 'ei', 'ur', 'ant', 'ent', 'ist', 'ieren'];
const FIXED = {
  der: 'dair', die: 'dee', das: 'dahs', den: 'dayn', dem: 'daym', des: 'des',
  ein: 'eyen', eine: 'eye-nuh', einen: 'eye-nun', sich: 'zikh', zu: 'tsoo',
  und: 'oont', ich: 'ikh', ist: 'ist', nicht: 'nikht', mit: 'mit', es: 'es',
};
const LOWERCASE_WORDS = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'sich', 'zu']);
const SHORT_MONO = new Set(['mit', 'in', 'im', 'an', 'am', 'um', 'ab', 'ob', 'es', 'das', 'was', 'hat', 'bis', 'von', 'man', 'bin', 'hin', 'zum', 'weg', 'des', 'ins']);

const VOWELS = [
  ['ieh', 'ee', true], ['ie', 'ee', true], ['ei', 'eye', true], ['ey', 'eye', true],
  ['ai', 'eye', true], ['ay', 'eye', true], ['eu', 'oy', true], ['äu', 'oy', true],
  ['au', 'ow', true], ['aa', 'ah', true], ['ah', 'ah', true], ['ee', 'ay', true],
  ['eh', 'ay', true], ['oo', 'oh', true], ['oh', 'oh', true], ['uh', 'oo', true],
  ['ih', 'ee', true], ['äh', 'ay', true], ['öh', 'ur', true], ['üh', 'ew', true],
];
const SINGLE_VOWEL = { a: ['ah', 'ah'], e: ['ay', 'e'], i: ['ee', 'i'], o: ['oh', 'o'], u: ['oo', 'oo'], ä: ['ay', 'e'], ö: ['ur', 'ur'], ü: ['ew', 'ew'], y: ['ew', 'ew'] };
const isVowel = (c) => !!c && 'aeiouäöüy'.includes(c);
const ONSET_PAIRS = new Set(['pr', 'br', 'tr', 'dr', 'kr', 'gr', 'fr', 'pl', 'bl', 'kl', 'gl', 'fl', 'shv', 'shp', 'sht', 'shl', 'shm', 'shn', 'shr', 'kv']);

function tokenize(w) {
  const units = [];
  let i = 0;
  const C = (sound, len, weight = 1) => { units.push({ v: false, sound, weight }); i += len; };
  while (i < w.length) {
    const c = w[i];
    const rest = w.slice(i);
    const next = w[i + 1];

    if (isVowel(c)) {
      const multi = VOWELS.find(([g]) => rest.startsWith(g));
      if (multi) {
        units.push({ v: true, letter: multi[0], sound: multi[1], long: true, fixed: true });
        i += multi[0].length;
      } else {
        units.push({ v: true, letter: c, sound: null, long: null });
        i += 1;
      }
      continue;
    }

    if (rest.startsWith('tsch')) C('ch', 4, 2);
    else if (rest.startsWith('sch')) C('sh', 3, 2);
    else if (rest.startsWith('chs')) C('ks', 3, 2);
    else if (rest.startsWith('ch')) {
      const prev = units[units.length - 1];
      C(i === 0 ? 'sh' : 'kh', 2, prev && prev.v && prev.letter === 'u' ? 1 : 2);
    }
    else if (rest.startsWith('tion')) { C('tsy', 1); units.push({ v: true, letter: 'o', sound: 'oh', long: true, fixed: true }); i += 2; C('n', 1); }
    else if (rest.startsWith('ck')) C('k', 2, 2);
    else if (rest.startsWith('ph')) C('f', 2);
    else if (rest.startsWith('th')) C('t', 2);
    else if (rest.startsWith('qu')) C('kv', 2, 2);
    else if (rest.startsWith('ng')) C('ng', 2, 2);
    else if (rest.startsWith('pf')) C('pf', 2, 2);
    else if (rest.startsWith('tz')) C('ts', 2, 2);
    else if (rest.startsWith('dt')) C('t', 2);
    else if (c === 'ß') C('s', 1);
    else if (c === next && !isVowel(c)) C(devoice(c, w, i + 1) || c, 2, 2);
    else if ((c === 's') && (next === 'p' || next === 't') && i === 0) { C('sh', 1); }
    else if (c === 's') C(isVowel(next) && (i === 0 || isVowel(w[i - 1]) || 'lmnr'.includes(w[i - 1])) ? 'z' : 's', 1);
    else if (c === 'g' && w[i - 1] === 'i' && (i === w.length - 1 || (!isVowel(next) && next !== 'l' && next !== 'r'))) C('kh', 1);
    else if ('bdg'.includes(c)) C(devoice(c, w, i) || c, 1);
    else if (c === 'v') C('f', 1);
    else if (c === 'w') C('v', 1);
    else if (c === 'z') C('ts', 1);
    else if (c === 'j') C('y', 1);
    else if (c === 'x') C('ks', 1, 2);
    else if (c === 'c') C('eiä'.includes(next) ? 'ts' : 'k', 1);
    else if (c === 'h') {
      // A silent "h" after a vowel is already absorbed by VOWELS; otherwise say it.
      C('h', 1);
    }
    else if (/[a-zäöüß]/.test(c)) C(c, 1);
    else i += 1;
  }
  return units;
}

// Final devoicing: b/d/g at the end of a word or before a consonant.
function devoice(c, w, i) {
  const map = { b: 'p', d: 't', g: 'k' };
  if (!map[c]) return null;
  const after = w[i + 1];
  if (after === undefined || (!isVowel(after) && !'lrn'.includes(after))) return map[c];
  return null;
}

function syllabify(units) {
  const vowelIdx = units.map((u, i) => (u.v ? i : -1)).filter((i) => i >= 0);
  if (!vowelIdx.length) return [];
  const cuts = [];
  for (let k = 0; k < vowelIdx.length - 1; k++) {
    const a = vowelIdx[k];
    const b = vowelIdx[k + 1];
    const n = b - a - 1;
    if (n <= 1) cuts.push(a + 1);
    else {
      const lastTwo = units[b - 2].sound + units[b - 1].sound;
      cuts.push(ONSET_PAIRS.has(lastTwo) ? b - 2 : a + 2);
    }
  }
  const syls = [];
  let start = 0;
  for (const cut of cuts) { syls.push(units.slice(start, cut)); start = cut; }
  syls.push(units.slice(start));
  return syls;
}

function setVowelLengths(units, sylCount) {
  units.forEach((u, i) => {
    if (!u.v || u.fixed) return;
    let weight = 0;
    let j = i + 1;
    while (j < units.length && !units[j].v) { weight += units[j].weight; j++; }
    const final = j >= units.length;
    let long = weight === 0 || weight === 1;
    if (weight === 1 && final && sylCount > 1) long = false;
    u.long = long;
    u.sound = SINGLE_VOWEL[u.letter][long ? 0 : 1];
  });
}

function stressIndex(word, sylCount) {
  if (sylCount <= 1) return 0;
  if (word.endsWith('ieren')) return sylCount - 2;
  if (STRESSED_ENDINGS.some((e) => word.endsWith(e))) return sylCount - 1;
  return 0;
}

// Unstressed "e" in the last syllable becomes a schwa: -e/-er -> "uh", -en -> "un".
function renderSyllable(syl, stressed, isLast) {
  let out = '';
  for (let k = 0; k < syl.length; k++) {
    const u = syl[k];
    if (u.v && u.letter === 'e' && !stressed && !u.fixed && isLast) {
      const tail = syl.slice(k + 1).map((x) => x.sound).join('');
      if (tail === '' || tail === 'r') { out += 'uh'; break; }
      out += 'u';
      continue;
    }
    // "ei" after a consonant reads better as "y" (TSY-toong) than "eye" (TSEYE-toong).
    out += u.sound === 'eye' && k > 0 ? 'y' : u.sound;
  }
  return stressed ? out.toUpperCase() : out;
}

function respellPlain(word) {
  const units = tokenize(word);
  const sylCount = units.filter((u) => u.v).length;
  if (!sylCount) return '';
  setVowelLengths(units, sylCount);
  const syls = syllabify(units);
  const stress = stressIndex(word, syls.length);
  return syls.map((s, i) => renderSyllable(s, i === stress, i === syls.length - 1)).join('-');
}

function respellWord(raw) {
  const word = raw.toLowerCase().replace(/[^a-zäöüß-]/g, '');
  if (!word) return '';
  if (FIXED[word]) return LOWERCASE_WORDS.has(word) ? FIXED[word] : FIXED[word].toUpperCase();
  if (word.includes('-')) return word.split('-').filter(Boolean).map(respellWord).join(' ');

  for (const [prefix, sound] of Object.entries(PREFIXES)) {
    const rest = word.slice(prefix.length);
    if (word.startsWith(prefix) && rest.length >= 4 && tokenize(rest).some((u) => u.v)) {
      return `${sound}-${respellPlain(rest)}`;
    }
  }
  return respellPlain(word);
}

export function respell(german) {
  return german
    .split(/\s+/)
    .filter(Boolean)
    .map(respellWord)
    .filter(Boolean)
    .join(' ');
}
