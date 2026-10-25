// Offline support: the app shell is cached on install, then served cache-first
// while a fresh copy is fetched in the background (stale-while-revalidate).
// Bump VERSION whenever you change a file so phones pick up the new version.
const VERSION = 'wortschatz-v5';
// Libraries from CDNs (voice engine, Firebase), kept so they also work offline.
const CDN_CACHE = 'wortschatz-cdn-v1';
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'www.gstatic.com'];
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.json',
  'js/app.js',
  'js/audio.js',
  'js/cloud.js',
  'js/db.js',
  'js/firebase-config.js',
  'js/hd-voice.js',
  'js/parser.js',
  'js/respell.js',
  'js/speech.js',
  'js/sync.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // Only remove old app-shell caches; the voice model and CDN caches stay.
      .then((keys) => Promise.all(keys.filter((k) => /^wortschatz-v\d+$/.test(k) && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method === 'GET' && CDN_HOSTS.includes(url.hostname)) {
    // Versioned library files never change, so the cached copy is always right.
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }
  // Only same-origin GETs; never the optional AI endpoint.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const fresh = await network;
      if (fresh) return fresh;
      if (request.mode === 'navigate') return cache.match('index.html');
      return new Response('', { status: 504, statusText: 'Offline' });
    }),
  );
});
