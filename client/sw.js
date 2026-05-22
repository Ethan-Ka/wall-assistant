var CACHE = 'home-v1';
var ASSETS = ['/', '/css/main.css', '/js/main.js'];

self.addEventListener('install', function (evt) {
  evt.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', function (evt) {
  evt.respondWith(
    caches.match(evt.request).then(function (cached) {
      return cached || fetch(evt.request);
    })
  );
});
