// Real native-speaker recordings from Wiktionary / Wikimedia Commons (free, no key).
// Used for single words; sentences still need the device's German voice.

const API = 'https://de.wiktionary.org/w/api.php';
const AUDIO_EXT = /\.(ogg|oga|opus|wav|mp3|flac)$/i;
let current = null;

// Commons serves an MP3 copy of every recording, which plays in every browser (including iPhone).
function toMp3(url) {
  const clean = url.split('?')[0];
  if (/\.mp3$/i.test(clean)) return clean;
  const file = clean.split('/').pop();
  return `${clean.replace('/wikipedia/commons/', '/wikipedia/commons/transcoded/')}/${file}.mp3`;
}

// Returns an MP3 URL for `german` (article and "sich" removed), or '' if Wiktionary has none.
export async function findRecording(german) {
  const word = german.replace(/^(der|die|das|sich)\s+/i, '').trim();
  if (!word || /\s/.test(word)) return '';
  const variants = [...new Set([word, word[0].toUpperCase() + word.slice(1), word[0].toLowerCase() + word.slice(1)])];
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', titles: variants.join('|'),
    generator: 'images', gimlimit: '100', prop: 'imageinfo', iiprop: 'url',
  });
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`Wiktionary HTTP ${res.status}`);
  const pages = Object.values((await res.json()).query?.pages || {});
  // Prefer "De-Hund.ogg", then "De-Hund2.ogg"; skip regional ("De-at-…") and phrase recordings.
  const wanted = variants.flatMap((v) => [`de-${v}`, `de-${v}2`, `de-${v}1`]).map((s) => s.toLowerCase());
  const files = pages
    .map((p) => ({ name: p.title.replace(/^(Datei|File):/, '').replace(AUDIO_EXT, '').replace(/_/g, ' ').toLowerCase(), url: p.imageinfo?.[0]?.url }))
    .filter((f) => f.url && AUDIO_EXT.test(f.url.split('?')[0]) && wanted.includes(f.name))
    .sort((a, b) => wanted.indexOf(a.name) - wanted.indexOf(b.name));
  return files.length ? toMp3(files[0].url) : '';
}

export function play(url, rate = 1) {
  stop();
  const audio = new Audio(url);
  audio.preservesPitch = true;
  audio.playbackRate = rate;
  current = audio;
  return audio.play();
}

export function stop() {
  if (current) {
    current.pause();
    current = null;
  }
}
