// Rule-based English-style respelling of German, e.g. "Schwester" -> "SHVES-tuh".
// It is an approximation (compound words and loanwords will be off); the AI or
// your teacher can replace it with a checked one.

const PREFIXES = { zer: 'tser', ver: 'fer', ent: 'ent', emp: 'emp', be: 'buh', ge: 'guh', er: 'er' };
// Common words that start like an unstressed prefix but are stressed on the first syllable.
const NOT_PREFIXED = ['gestern', 'gegen', 'gegend', 'gerne', 'besser', 'beste', 'besten', 'erste', 'ersten', 'erster', 'ernst'];
const STRESSED_ENDINGS = ['ion', 'tät', 'ei', 'ur', 'ant', 'ent', 'ist', 'ieren'];
const FIXED = {
  der: 'dair', die: 'dee', das: 'dahs', den: 'dayn', dem: 'daym', des: 'des',
  ein: 'eyen', eine: 'eye-nuh', einen: 'eye-nun', sich: 'zikh', zu: 'tsoo',
  und: 'oont', ich: 'ikh', ist: 'ist', nicht: 'nikht', mit: 'mit', es: 'es',
};
// German names of single letters, for things like "W-Fragen" or "U-Bahn".
const LETTERS = {
  a: 'ah', b: 'bay', c: 'tsay', d: 'day', e: 'ay', f: 'ef', g: 'gay', h: 'hah', i: 'ee', j: 'yot', k: 'kah', l: 'el', m: 'em',
  n: 'en', o: 'oh', p: 'pay', q: 'koo', r: 'er', s: 'es', t: 'tay', u: 'oo', v: 'fow', w: 'vay', x: 'iks', y: 'IP-see-lon', z: 'tset',
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
    // "ng" never starts a German syllable: Zei-tung-en, not Zei-tu-ngen.
    if (n === 1 && units[a + 1].sound === 'ng') cuts.push(a + 2);
    else if (n <= 1) cuts.push(a + 1);
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
    // At the start, "ei" before a consonant reads better as "ey" (EYNS) than "eye" (EYENS).
    if (u.sound === 'eye' && k > 0) out += 'y';
    else if (u.sound === 'eye' && syl[k + 1] && !syl[k + 1].v) out += 'ey';
    else out += u.sound;
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
  if (word.length === 1 && LETTERS[word]) return LETTERS[word].toUpperCase();
  if (word.includes('-')) return word.split('-').filter(Boolean).map(respellWord).join(' ');

  for (const [prefix, sound] of Object.entries(PREFIXES)) {
    const rest = word.slice(prefix.length);
    if (NOT_PREFIXED.some((stem) => word.startsWith(stem))) break;
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

// ---------- German pronunciation in Malayalam letters, e.g. "Schwester" -> "ഷ്വെസ്റ്റെർ" ----------
// Uses the same sound units as the respelling. Approximate: ö, ü and the "ch" sounds have no
// Malayalam letter, so the nearest one is used (ö → ഓ/ഒ, ü → ഊ/ഉ, ach → ഖ, ich → ഷ).

const ML_CONSONANT = {
  b: 'ബ', p: 'പ', d: 'ഡ', t: 'ട', g: 'ഗ', k: 'ക', f: 'ഫ', v: 'വ', s: 'സ', z: 'സ', sh: 'ഷ', ch: 'ച്ച',
  ks: 'ക്സ', tsy: 'ത്സ്യ', kv: 'ക്വ', ng: 'ങ്ങ', pf: 'പ്ഫ', ts: 'ത്സ', y: 'യ', h: 'ഹ', l: 'ല', m: 'മ', n: 'ന', r: 'റ',
};
// Final or before another consonant: chillu letters where Malayalam has them.
const ML_FINAL = { n: 'ൻ', l: 'ൽ', r: 'ർ', m: 'ം', ng: 'ങ്' };
// [vowel letter, vowel sign] for each vowel sound.
const ML_VOWEL = {
  'a+': ['ആ', 'ാ'], 'a-': ['അ', ''], 'e+': ['ഏ', 'േ'], 'e-': ['എ', 'െ'], 'ä+': ['ഏ', 'േ'], 'ä-': ['എ', 'െ'],
  'i+': ['ഈ', 'ീ'], 'i-': ['ഇ', 'ി'], 'o+': ['ഓ', 'ോ'], 'o-': ['ഒ', 'ൊ'], 'ö+': ['ഓ', 'ോ'], 'ö-': ['ഒ', 'ൊ'],
  'u+': ['ഊ', 'ൂ'], 'u-': ['ഉ', 'ു'], 'ü+': ['ഊ', 'ൂ'], 'ü-': ['ഉ', 'ു'], 'y+': ['ഊ', 'ൂ'], 'y-': ['ഉ', 'ു'],
  ah: ['ആ', 'ാ'], ay: ['ഏ', 'േ'], ee: ['ഈ', 'ീ'], oh: ['ഓ', 'ോ'], oo: ['ഊ', 'ൂ'], ur: ['ഓ', 'ോ'], ew: ['ഊ', 'ൂ'],
  eye: ['ഐ', 'ൈ'], ow: ['ഔ', 'ൗ'], oy: ['ഓയ്', 'ോയ്'],
};
const ML_FIXED = {
  der: 'ഡേർ', die: 'ഡീ', das: 'ഡാസ്', den: 'ഡേൻ', dem: 'ഡേം', des: 'ഡെസ്', ein: 'ഐൻ', eine: 'ഐനെ', einen: 'ഐനെൻ',
  sich: 'സിഷ്', zu: 'ത്സൂ', und: 'ഉണ്ട്', ich: 'ഇഷ്', ist: 'ഇസ്റ്റ്', nicht: 'നിഷ്റ്റ്', mit: 'മിറ്റ്', es: 'എസ്',
};
const ML_PREFIXES = { zer: 'ത്സെർ', ver: 'ഫെർ', ent: 'എന്റ്', emp: 'എംപ്', be: 'ബെ', ge: 'ഗെ', er: 'എർ' };
const ML_LETTERS = {
  a: 'ആ', b: 'ബേ', c: 'ത്സേ', d: 'ഡേ', e: 'ഏ', f: 'എഫ്', g: 'ഗേ', h: 'ഹാ', i: 'ഈ', j: 'യോട്ട്', k: 'കാ', l: 'എൽ', m: 'എം',
  n: 'എൻ', o: 'ഓ', p: 'പേ', q: 'കൂ', r: 'എർ', s: 'എസ്', t: 'ടേ', u: 'ഊ', v: 'ഫൗ', w: 'വേ', x: 'ഇക്സ്', y: 'ഉപ്സിലോൺ', z: 'ത്സെറ്റ്',
};

function malayalamPlain(word) {
  const units = tokenize(word);
  if (!units.some((u) => u.v)) return '';
  setVowelLengths(units, units.filter((u) => u.v).length);
  const lastVowel = units.map((u) => u.v).lastIndexOf(true);
  let out = '';
  units.forEach((u, i) => {
    const prev = units[i - 1];
    const next = units[i + 1];
    if (u.v) {
      // An "e" in the last syllable of a longer word is short (lerne, Hause, sehen).
      const short = u.letter === 'e' && !u.fixed && i === lastVowel && units.some((x, j) => x.v && j < i);
      const key = u.fixed ? u.sound : `${u.letter}${u.long && !short ? '+' : '-'}`;
      const [letter, sign] = ML_VOWEL[key] || ML_VOWEL[u.sound] || ['അ', ''];
      if (!prev) out += letter;
      else if (!prev.v) out += sign;
      else out += `യ${sign}`; // two vowels in a row: glide with ya (sehen → സേയെൻ)
      return;
    }
    // "ch" after a, o, u, au is the throat sound (Bach); otherwise the soft one (ich).
    let sound = u.sound;
    if (sound === 'kh') sound = prev && prev.v && (/[aou]/.test(prev.letter) || prev.sound === 'ow') ? 'kh-hard' : 'sh';
    let letter = sound === 'kh-hard' ? 'ഖ' : ML_CONSONANT[sound] || '';
    if (!letter) return;
    // Spellings Malayalam readers know: nt → ന്റ, st → സ്റ്റ, nk / ng+k → ങ്ക.
    if (sound === 't' && out.endsWith('ൻ')) { out = out.slice(0, -1); letter = 'ന്റ'; }
    else if (sound === 't' && prev?.sound === 's') letter = 'റ്റ';
    if (sound === 'n' && next && (next.sound === 'k' || next.sound === 'g')) { out += 'ങ്'; return; }
    if (next && next.v) out += letter;
    else out += ML_FINAL[sound] || `${letter}്`;
  });
  return out;
}

function malayalamWord(raw) {
  const word = raw.toLowerCase().replace(/[^a-zäöüß-]/g, '');
  if (!word) return /\d/.test(raw) ? raw.replace(/[^\d]/g, '') : '';
  if (ML_FIXED[word]) return ML_FIXED[word];
  if (word.length === 1 && ML_LETTERS[word]) return ML_LETTERS[word];
  if (word.includes('-')) return word.split('-').filter(Boolean).map(malayalamWord).join(' ');
  for (const [prefix, sound] of Object.entries(ML_PREFIXES)) {
    const rest = word.slice(prefix.length);
    if (NOT_PREFIXED.some((stem) => word.startsWith(stem))) break;
    if (word.startsWith(prefix) && rest.length >= 4 && tokenize(rest).some((u) => u.v)) return sound + malayalamPlain(rest);
  }
  return malayalamPlain(word);
}

export function malayalam(german) {
  return german.split(/\s+/).filter(Boolean).map(malayalamWord).filter(Boolean).join(' ');
}
