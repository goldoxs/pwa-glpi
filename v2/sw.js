const CACHE_NAME = 'inventory-app-cache-v5-v2-p0-fixes';
const urlsToCache = [
  './',
  './index.html',
  './recherche_manuelle.html',
  './app_multi_v2.js',
  './config.js',
  './style.css',
  './manifest.json',
  './logo.png',
  './logo_picto.png',
  'https://unpkg.com/@zxing/library@0.19.1/umd/index.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Requêtes API GLPI -> toujours réseau (pas de cache)
  if (url.origin === "https://your-glpi.example.com") {
    event.respondWith(fetch(event.request));
    return;
  }

  // Sinon, cache-then-network
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
