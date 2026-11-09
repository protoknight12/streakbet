// Offline support: network first, saved copy only when offline.
const CACHE = 'streakbet-v2';
const FILES = ['./', 'index.html', 'style.css', 'shell.css', 'config.js', 'core.js', 'belot.js', 'svara.js', 'app.js', 'online.js', 'casino.js', 'table.js', 'svaratable.js', 'nav.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.oninstall = e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
self.onactivate = e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
self.onfetch = e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request)
    .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
};
