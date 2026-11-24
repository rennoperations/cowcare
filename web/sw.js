/* Service worker: menyimpan aplikasi dan model AI supaya CowCare tetap jalan tanpa sinyal.
   File aplikasi (html/js/css) diambil dari internet dulu bila ada sinyal, supaya pembaruan langsung terlihat;
   bila tidak ada sinyal, dipakai salinan yang tersimpan. Model dan gambar langsung dari simpanan. */
var PREFIX = "cowcare-", CACHE = PREFIX + "v1.2.0";
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
    return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function simpan(req, res) {
  if (res && res.ok && new URL(req.url).origin === self.location.origin) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copy); });
  }
  return res;
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  var kodeApp = req.mode === "navigate" || /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.slice(-1) === "/";
  if (kodeApp && url.origin === self.location.origin) {
    // internet dulu, simpanan bila offline
    e.respondWith(fetch(req, { cache: "no-cache" }).then(function (res) { return simpan(req, res); }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()); });
    }));
    return;
  }
  // model dan gambar: simpanan dulu
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(req).then(function (res) { return simpan(req, res); });
  }).catch(function () { return Response.error(); }));
});
