/* StreetAlert service worker: makes the app installable and lets the app shell open offline. */
const VERSION = 'streetalert-v4';
const SHELL = ['/', '/css/style.css', '/js/app.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/favicon.png'];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API calls always go to the network (fault data must be fresh)
  if (url.pathname.startsWith('/api/')) return;

  // Map tiles are not cached (large); Leaflet, fonts and app files are
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !CDN_HOSTS.includes(url.hostname)) return;

  // Network first for pages/scripts so updates arrive, cache as fallback for offline use
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error())))
  );
});
