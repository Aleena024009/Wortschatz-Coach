// Free German neural voice ("Thorsten", Piper TTS, MIT/CC0) that runs inside the
// browser, so every word and sentence can be spoken even when the browser has no
// German voice (e.g. Brave or Firefox on Linux). The 63 MB model is downloaded
// once per device and kept in Cache Storage; each spoken phrase is cached too.

const MODEL = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx';
const CONFIG = `${MODEL}.json`;
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/+esm';
const ORT_WASM = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/';
const PHONEMIZE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/dist/piper-DeOu3H9E.js';
const PHONEMIZE_WASM = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const MODEL_CACHE = 'wortschatz-voice-model-v1';
const AUDIO_CACHE = 'wortschatz-voice-audio-v1';
export const MODEL_SIZE_MB = 63;

let session = null;
let config = null;
let ort = null;
let loading = null;
// Synthesis is CPU-heavy, so requests run one at a time.
let queue = Promise.resolve();

export async function isDownloaded() {
  try {
    const cache = await caches.open(MODEL_CACHE);
    return !!(await cache.match(MODEL)) && !!(await cache.match(CONFIG));
  } catch {
    return false;
  }
}

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  return new Blob(chunks);
}

export async function download(onProgress) {
  const cache = await caches.open(MODEL_CACHE);
  const [model, cfg] = await Promise.all([fetchWithProgress(MODEL, onProgress), fetchWithProgress(CONFIG)]);
  await cache.put(CONFIG, new Response(cfg, { headers: { 'content-type': 'application/json' } }));
  await cache.put(MODEL, new Response(model, { headers: { 'content-type': 'application/octet-stream' } }));
}

export async function remove() {
  session = null;
  config = null;
  await caches.delete(MODEL_CACHE);
  await caches.delete(AUDIO_CACHE);
}

// Loads the model ahead of time so the first word plays without the ~10 s start-up.
export function warmUp() {
  return load();
}

async function load() {
  if (session) return;
  loading ||= (async () => {
    const cache = await caches.open(MODEL_CACHE);
    const [modelRes, cfgRes] = await Promise.all([cache.match(MODEL), cache.match(CONFIG)]);
    if (!modelRes || !cfgRes) throw new Error('The German voice is not downloaded yet.');
    ort = await import(ORT);
    ort.env.wasm.wasmPaths = ORT_WASM;
    // Run the model in a worker so the page stays responsive while it loads and speaks.
    ort.env.wasm.proxy = true;
    config = await cfgRes.json();
    session = await ort.InferenceSession.create(await modelRes.arrayBuffer());
  })();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

// The phonemizer (espeak-ng compiled to WebAssembly) is started once and reused;
// starting it costs about two seconds.
let phonemizer = null;
let pending = null;

async function phonemeIds(text) {
  phonemizer ||= import(PHONEMIZE).then(({ createPiperPhonemize }) =>
    createPiperPhonemize({
      print: (line) => pending?.resolve(JSON.parse(line).phoneme_ids),
      printErr: (line) => pending?.reject(new Error(line)),
      locateFile: (file) => (file.endsWith('.wasm') ? `${PHONEMIZE_WASM}.wasm` : file.endsWith('.data') ? `${PHONEMIZE_WASM}.data` : file),
    }));
  const module = await phonemizer;
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    module.callMain(['-l', config.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  });
}

function toWav(samples, sampleRate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([view.buffer], { type: 'audio/wav' });
}

async function synthesize(text) {
  await load();
  const ids = await phonemeIds(text);
  const { noise_scale: noise, length_scale: length, noise_w: noiseW } = config.inference;
  const inputs = {
    input: new ort.Tensor('int64', ids, [1, ids.length]),
    input_lengths: new ort.Tensor('int64', [ids.length]),
    scales: new ort.Tensor('float32', [noise, length, noiseW]),
  };
  const { output } = await session.run(inputs);
  return toWav(output.data, config.audio.sample_rate);
}

// Returns a WAV blob for `text`, from the phrase cache when it was spoken before.
export function speakBlob(text) {
  const clean = text.trim();
  const key = `https://wortschatz.local/tts/thorsten/${encodeURIComponent(clean)}`;
  const job = queue.then(async () => {
    const cache = await caches.open(AUDIO_CACHE);
    const hit = await cache.match(key);
    if (hit) return hit.blob();
    const wav = await synthesize(clean);
    await cache.put(key, new Response(wav, { headers: { 'content-type': 'audio/wav' } }));
    return wav;
  });
  queue = job.catch(() => {});
  return job;
}
