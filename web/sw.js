/* Service worker: caches the app shell and the model so CowCare works offline after the first visit. */
var CACHE = "cowcare-v1.0.0";
var ASSETS = [
  "./", "index.html", "styles.css", "app.js", "scoring.js", "engine.js", "worker.js",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png",
  "model/model.json", "model/weights.bin",
  "samples/contoh_mulut_lesi.jpg", "samples/contoh_mulut_sehat.jpg", "samples/contoh_kuku.jpg"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(e.request).then(function (res) {
      if (res && res.ok && new URL(e.request.url).origin === self.location.origin) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    });
  }).catch(function () { return caches.match("index.html"); }));
});
