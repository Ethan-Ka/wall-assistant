var CACHE = 'home-v4';
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
  var url = new URL(evt.request.url);
  var isPageRequest = evt.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
  var isHotAsset = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

  if (isPageRequest || isHotAsset) {
    evt.respondWith(
      fetch(evt.request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(evt.request, copy); });
        return response;
      }).catch(function () {
        return caches.match(evt.request);
      })
    );
    return;
  }

  evt.respondWith(
    caches.match(evt.request).then(function (cached) {
      return cached || fetch(evt.request);
    })
  );
});
