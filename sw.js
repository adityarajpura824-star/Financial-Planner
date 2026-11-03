/*!
 * sw.js - makes the app work offline once it has been opened.
 *
 * Strategy: network first, with a 2.5 s timeout, then the saved copy. Online you always get the
 * latest files (so a redeploy or a new data/rates.json shows up on the next open); offline, or on a
 * bad connection, you get the last copy that loaded. Everything in PRECACHE is saved at install time,
 * so the very first visit already works offline afterwards. No version number needs bumping.
 */
'use strict';

var CACHE = 'fp-cache-v1';
var PRECACHE = [
  './', 'index.html', 'css/styles.css',
  'js/calc.js', 'js/rates.js', 'js/app.js',
  'data/rates.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];
var WAIT_MS = 2500;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function networkFirst(req) {
  return caches.open(CACHE).then(function (cache) {
    var fresh = fetch(req).then(function (res) {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    });
    var timeout = new Promise(function (_, reject) { setTimeout(reject, WAIT_MS); });
    return Promise.race([fresh, timeout]).catch(function () {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || fresh; /* nothing saved yet: keep waiting for the network */
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(networkFirst(req));
});
