// Thin wrapper around the browser's on-device speechSynthesis (free, works offline
// once a German voice is installed).

export const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
const synth = supported ? window.speechSynthesis : null;

export function germanVoices() {
  if (!synth) return [];
  return synth
    .getVoices()
    .filter((v) => /^de([-_]|$)/i.test(v.lang))
    .sort((a, b) => (a.lang === 'de-DE' ? -1 : 0) - (b.lang === 'de-DE' ? -1 : 0) || a.name.localeCompare(b.name));
}

export function onVoicesChanged(fn) {
  if (!synth) return;
  synth.addEventListener?.('voiceschanged', fn);
  fn();
}

function makeUtterance(text, { voiceURI, rate }) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  u.rate = rate || 0.85;
  const voice = germanVoices().find((v) => v.voiceURI === voiceURI);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
  return u;
}

export function speak(text, opts = {}) {
  if (!synth || !text) return;
  synth.cancel();
  synth.speak(makeUtterance(text, opts));
}

// Long text is split into sentence-sized chunks: some browsers (Chrome) silently
// stop a single utterance after ~15 seconds.
export function speakLong(text, opts = {}, onDone = () => {}) {
  if (!synth) return onDone();
  synth.cancel();
  const chunks = (text.match(/[^.!?\n]+[.!?]*|\n+/g) || [])
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => (s.length > 220 ? s.match(/.{1,220}(\s|$)/g) : [s]));
  if (!chunks.length) return onDone();
  chunks.forEach((chunk, i) => {
    const u = makeUtterance(chunk, opts);
    if (i === chunks.length - 1) {
      u.onend = onDone;
      u.onerror = onDone;
    }
    synth.speak(u);
  });
}

export function stop() {
  synth?.cancel();
}
