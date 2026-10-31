/* MERCHANT VISIT ACTIVITY - LAUNCHER CACHE (v18)
   Keeps this launcher page on the phone so the next open shows the logo at once, even on a weak connection.
   - Kept: only this page's own files (below) and Telegram's script. Each open shows the kept copy at once and quietly
     fetches a fresh copy for the next open ("stale-while-revalidate").
   - Never kept: the form itself (Google Apps Script), sign-in data, staff or merchant data, the "reader" folder, anything else.
   - After changing any file on GitHub: raise VERSION by one, so every phone drops its old copy on its next open. */
'use strict';
var VERSION = 'mv-launcher-18';
var SHELL = ['./', 'index.html', 'launcher.css', 'launcher.js', 'boot.js', 'config.js', 'manifest.webmanifest',
  'icons/favicon.svg', 'icons/favicon-32.png', 'icons/apple-touch-icon.png', 'icons/icon-192.png'];
var TG = 'https://telegram.org/js/telegram-web-app.js';
var BASE = new URL('./', self.location).href;
var OWN = SHELL.map(function (p) { return new URL(p, BASE).href; });

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    // one file failing (e.g. an icon) never stops the rest
    return Promise.all(OWN.map(function (u) { return c.add(new Request(u, { cache: 'no-cache' })).catch(function () {}); }))
      .then(function () { return fetch(TG, { mode: 'no-cors' }).then(function (r) { return c.put(TG, r); }).catch(function () {}); });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('mv-launcher-') === 0 && k !== VERSION; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// which kept copy answers this request (null: not ours - the browser handles it as usual)
function keyOf(req) {
  if (req.method !== 'GET') return null;
  var u = new URL(req.url);
  if (u.href === TG) return TG;
  if (u.origin !== self.location.origin) return null;
  var clean = u.origin + u.pathname;                         // "?t=…" one-time links and Telegram's data are never part of the key
  if (req.mode === 'navigate') return clean === BASE || clean === BASE + 'index.html' ? BASE : null;
  return OWN.indexOf(clean) >= 0 ? clean : null;
}

self.addEventListener('fetch', function (e) {
  var key = keyOf(e.request);
  if (!key) return;
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(key).then(function (hit) {
      var net = fetch(key === TG ? new Request(TG, { mode: 'no-cors' }) : new Request(key, { cache: 'no-cache', credentials: 'omit' }))
        .then(function (r) {
          if (r && (r.ok || r.type === 'opaque')) { var copy = r.clone(); c.put(key, copy).catch(function () {}); }
          return r;
        });
      if (hit) { e.waitUntil(net.catch(function () {})); return hit; }    // the kept copy now, a fresh one for next time
      return net.catch(function () { return Response.error(); });
    });
  }));
});
