// familiaMU — service worker.
// Red primero (para que los cambios lleguen al instante) y caché solo como
// respaldo sin conexión. Nunca guarda llamadas a Supabase ni a otros sitios.
var CACHE = 'familiamu-v2';
var BASICOS = [
  './',
  './index.html',
  './tiendita/',
  './tiendita/index.html',
  './manifest.webmanifest',
  './assets/estilo.css',
  './assets/supabase.js',
  './assets/app.js',
  './assets/tiendita.js',
  './assets/descarga-app.js',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/img/favicon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(BASICOS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (claves) {
      return Promise.all(claves.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res.ok) {
        var copia = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copia); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true });
    })
  );
});
