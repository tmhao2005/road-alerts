// Offline support. The page is fetched fresh whenever there is a network, so a push shows
// up on the next open, and comes from the cache when there is none. Map tiles are kept
// once loaded: a drive passes through places with no signal, and a tile that fails to
// load there leaves the app with no road to match. They are dropped together when the
// map data is rebuilt, so old and new tiles never mix.
const SHELL = 'shell';
const TILES = 'tiles';
const FONTS = 'fonts';
const VOICE = 'voice';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('/tiles/index.json')) e.respondWith(tileIndex(e.request));
    else if (url.pathname.includes('/tiles/')) e.respondWith(cacheFirst(TILES, e.request));
    // The spoken lines never change without the manifest changing with them, so refetching
    // them on every load only costs a driver several seconds of the phone's own voice while
    // they arrive. Kept like tiles, and dropped together when the voice is re-rendered.
    else if (url.pathname.endsWith('/voice/manifest.json')) e.respondWith(voiceManifest(e.request));
    else if (url.pathname.includes('/voice/')) e.respondWith(cacheFirst(VOICE, e.request));
    else e.respondWith(networkFirst(SHELL, e.request));
  } else if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(cacheFirst(FONTS, e.request));
  }
});

// A mobile connection that is technically up but not answering should not hold the app
// on a white screen, so the network gets a few seconds before the cache answers.
async function networkFirst(name, req, wait = 4000) {
  const cache = await caches.open(name);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), wait)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(name, req) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Fonts arrive as opaque cross-origin responses (status 0); those are fine to keep.
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

// A re-render changes "built", which is the signal that every clip held is now the wrong
// voice - so they go together rather than leaving a drive half in one voice and half in
// another.
async function voiceManifest(req) {
  const shell = await caches.open(SHELL);
  const before = await shell.match(req);
  const res = await networkFirst(SHELL, req);
  try {
    if (before && res.ok) {
      const [a, b] = await Promise.all([before.clone().json(), res.clone().json()]);
      if (a.built !== b.built || a.default !== b.default) await caches.delete(VOICE);
    }
  } catch {}
  return res;
}

async function tileIndex(req) {
  const shell = await caches.open(SHELL);
  const before = await shell.match(req);
  const res = await networkFirst(SHELL, req);
  try {
    if (before && res.ok) {
      const [a, b] = await Promise.all([before.clone().json(), res.clone().json()]);
      if (a.built !== b.built) await caches.delete(TILES);
    }
  } catch {}
  return res;
}
