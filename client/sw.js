var CACHE = 'home-v2';
var ASSETS = ['/', '/css/main.css', '/js/main.js'];

self.addEventListener('install', function (evt) {
  evt.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (evt) {
  evt.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (evt) {
  evt.respondWith(
    caches.match(evt.request).then(function (cached) {
      return cached || fetch(evt.request);
    })
  );
});
