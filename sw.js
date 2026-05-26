const CACHE_NAME = 'inventory-app-cache-v4';
const urlsToCache = [
  '/',
  '/index.html',
  '/app_multi.js',
  '/manifest.json',
  'https://unpkg.com/@zxing/library@0.19.1/umd/index.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Si la requete cible l'API GLPI -> on force le reseau
  if (url.origin === "https://your-glpi.example.com") {
    event.respondWith(fetch(event.request));
    return;
  }

  // Sinon, on applique cache-then-network
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
