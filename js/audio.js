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
  // "7. Der Juli" -> "Juli", "sich beschweren" -> "beschweren", "die 12 Monate" -> "Monate".
  const word = german.replace(/^\s*\d+\s*[.)]\s+/, '').replace(/^(der|die|das|sich)\s+/i, '').replace(/^\d+\s+/, '').trim();
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

// The Wikimedia Commons page of a recording: who recorded it and its licence.
export function recordingPage(mp3Url) {
  const parts = mp3Url.split('/');
  // Transcoded copies live at .../transcoded/a/aa/De-Hund.ogg/De-Hund.ogg.mp3
  const file = mp3Url.includes('/transcoded/') ? parts.at(-2) : parts.at(-1);
  return `https://commons.wikimedia.org/wiki/File:${file}`;
}

// One shared player. Browsers (Brave, Safari) only allow sound that starts from a tap;
// fetching a recording or generating speech takes a moment, so the player is
// "unlocked" with a silent clip during the tap and then reused for the real sound.
const player = typeof Audio !== 'undefined' ? new Audio() : null;
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let token = 0;
let objectUrl = null;

// Call synchronously inside a click/tap handler, before any await.
export function unlock() {
  if (!player || !player.paused) return;
  player.src = SILENT;
  player.play().catch(() => {});
}

// Plays a URL or Blob; resolves once playback has started.
export function play(src, rate = 1) {
  return start(src, rate).started;
}

// Plays a URL or Blob; resolves when it has finished (or was stopped).
export function playUntilEnd(src, rate = 1) {
  const { started, ended } = start(src, rate);
  return started.then(() => ended);
}

function start(src, rate) {
  stop();
  const my = ++token;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = src instanceof Blob ? URL.createObjectURL(src) : null;
  player.src = objectUrl || src;
  player.preservesPitch = true;
  player.playbackRate = rate;
  current = player;
  const ended = new Promise((resolve) => {
    const done = () => {
      ['ended', 'pause', 'error'].forEach((e) => player.removeEventListener(e, done));
      resolve();
    };
    ['ended', 'pause', 'error'].forEach((e) => player.addEventListener(e, done));
  });
  const started = player.play().then(() => watchdog(my));
  return { started, ended };
}

// Some browsers report "playing" but keep the sound muted or stalled. If the clip has
// not moved after a moment, report it so the app can explain instead of staying silent.
export let onStalled = () => {};
export function setStalledHandler(fn) {
  onStalled = fn;
}
function watchdog(my) {
  setTimeout(() => {
    if (my === token && current && !player.ended && player.currentTime === 0) onStalled();
  }, 2500);
}

export function stop() {
  token++;
  if (current) {
    current.pause();
    current = null;
  }
}
