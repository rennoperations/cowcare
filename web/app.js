/* CowCare – logika antarmuka (PWA dan aplikasi Android berbasis WebView). */
(function () {
  "use strict";
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var view = $("#view");
  var Android = window.CowCareAndroid || null; // jembatan native bila berjalan di APK
  var APP_VERSION = "1.1.0";

  // ---------- penyimpanan lokal (hanya di HP) ----------
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("cowcare." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("cowcare." + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem("cowcare." + k); } catch (e) {} }
  };
  var memHistory = []; // dipakai bila pengguna tidak menyetujui penyimpanan
  function consent() { return store.get("consent", null); }
  function history() { return consent() === "setuju" ? store.get("riwayat", []) : memHistory; }
  function saveHistory(h) {
    if (consent() === "setuju") { if (!store.set("riwayat", h)) { toast("Memori HP penuh, riwayat gagal disimpan", "err"); return false; } }
    else memHistory = h;
    return true;
  }

  // ---------- model AI (Web Worker, fallback ke thread utama) ----------
  var ai = { ready: false, error: null, worker: null, pending: {}, seq: 0, model: null, waiters: [] };
  function aiReady() {
    ai.ready = true; ai.waiters.splice(0).forEach(function (f) { f(); }); refreshNet();
    var ml = $("#modelLoad"); if (ml) { ml.remove(); }
  }
  function loadMainThread() {
    Promise.all([fetch("model/model.json").then(function (r) { return r.json(); }),
                 fetch("model/weights.bin").then(function (r) { return r.arrayBuffer(); })])
      .then(function (r) { ai.model = new window.CowEngine.Model(r[0], r[1]); aiReady(); })
      .catch(function (e) { ai.error = String(e); ai.waiters.splice(0).forEach(function (f) { f(); }); refreshNet(); render(); });
  }
  try {
    ai.worker = new Worker("worker.js");
    ai.worker.onmessage = function (ev) {
      var d = ev.data;
      if (d.type === "ready") aiReady();
      else if (d.type === "error") { ai.worker = null; loadMainThread(); }
      else if (d.type === "result") { var cb = ai.pending[d.id]; delete ai.pending[d.id]; if (cb) cb(d); }
    };
    ai.worker.onerror = function () { ai.worker = null; loadMainThread(); };
  } catch (e) { loadMainThread(); }

  function predict(rgba) {
    return new Promise(function (resolve, reject) {
      function go() {
        if (ai.error) { reject(new Error("model AI tidak tersedia")); return; }
        if (ai.worker) {
          var id = ++ai.seq;
          ai.pending[id] = function (d) { d.error ? reject(new Error(d.error)) : resolve(d.result); };
          ai.worker.postMessage({ type: "predict", id: id, rgba: rgba.buffer }, [rgba.buffer]);
        } else {
          setTimeout(function () { try { resolve(ai.model.predict(rgba)); } catch (e) { reject(e); } }, 30);
        }
      }
      ai.ready || ai.error ? go() : ai.waiters.push(go);
    });
  }

  // ---------- pengolahan foto ----------
  function loadImage(src) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error("Foto tidak bisa dibuka")); };
      im.src = src;
    });
  }
  // Sama dengan Resize(256) + CenterCrop(224) saat pelatihan
  function toTensorRGBA(im) {
    var cv = document.getElementById("cv"), ctx = cv.getContext("2d", { willReadFrequently: true });
    var w = im.naturalWidth, h = im.naturalHeight, side = Math.min(w, h) * 224 / 256;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, 224, 224);
    ctx.drawImage(im, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 224, 224);
    return ctx.getImageData(0, 0, 224, 224).data;
  }
  function thumb(im, size, q) {
    var c = document.createElement("canvas"), s = Math.min(im.naturalWidth, im.naturalHeight);
    c.width = c.height = size;
    c.getContext("2d").drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL("image/jpeg", q || 0.7);
  }
  function readFile(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error("Gagal membaca berkas")); };
      fr.readAsDataURL(file);
    });
  }

  // Ambang ketidakpastian (sama dengan Laporan Bab 4.4 dan 6.4)
  var YAKIN = 0.80, RAGU = 0.60, GELAP = 35, TERANG = 225, BURAM = 15;

  function interpret(area, r) {
    var p = r.probs, other = area === "mulut" ? "kuku" : "mulut";
    var top = Object.keys(p).sort(function (a, b) { return p[b] - p[a]; })[0];
    var sakit = p[area + "_sakit"], sehat = p[area + "_sehat"];
    var kelas = sakit >= sehat ? area + "_sakit" : area + "_sehat";
    var conf = Math.max(sakit, sehat);
    var o = { area: area, kelas: kelas, conf: conf, top: top, probs: p, latency_ms: r.latency_ms, quality: r.quality,
              model_version: r.model_version, issues: [] };
    var q = r.quality;
    if (q.brightness < GELAP) o.issues.push("gelap");
    if (q.brightness > TERANG) o.issues.push("terang");
    if (q.sharpness < BURAM) o.issues.push("buram");
    if (top.indexOf(other) === 0 && p[top] >= 0.5) o.issues.push("salah_area");
    if (o.issues.length) o.band = "gagal";
    else if (conf >= YAKIN) o.band = "yakin";
    else if (conf >= RAGU) o.band = "ragu";
    else o.band = "rendah";
    o.sakit = /_sakit$/.test(kelas);
    return o;
  }

  // ---------- status sesi pemeriksaan ----------
  var S = null;
  function newSession() {
    S = { step: 1, sapi: "", mulut: null, kuku: null, liur: null, lepuhMulut: null, lepuhKuku: null,
          kukuSkip: false, kukuMode: false, jarak: null, busy: false, aiErr: null, hasil: null, saved: false };
  }

  // ---------- teks domain ----------
  var LIUR = [
    ["Normal", "Mulut lembap biasa, tidak ada liur menetes"],
    ["Sedikit berlebih", "Bibir dan dagu tampak basah"],
    ["Menetes sesekali", "Liur menetes sesekali dari mulut"],
    ["Menetes terus", "Liur menetes terus, mulai berbusa"],
    ["Sangat berlebihan", "Liur menjuntai panjang dan berbusa, sapi sering mengecap"]
  ];
  var LEPUH = [
    ["Tidak ada lepuh", "Gusi, lidah, atau kuku tampak normal"],
    ["Lepuh kecil", "Gelembung berisi cairan, kulit di atasnya masih utuh"],
    ["Lepuh pecah", "Gelembung pecah, tampak luka merah terbuka"],
    ["Luka luas", "Luka lebar atau banyak, kulit mengelupas"]
  ];
  var JARAK = [
    ["jauh", "Jauh", "Lebih dari 5 km dari kasus aktif", "pin"],
    ["dekat", "Dekat", "5 km atau kurang", "target"],
    ["tidak_tahu", "Tidak tahu", "Dihitung sebagai Dekat demi kehati-hatian", "help"]
  ];
  var STATUS = {
    hijau: { label: "Risiko rendah", kata: "Pantau sapi setiap hari", icon: "shield" },
    kuning: { label: "Waspada", kata: "Pisahkan sapi dan amati ketat", icon: "alert" },
    merah: { label: "Suspek tinggi", kata: "Segera hubungi dokter hewan", icon: "stetho" }
  };
  var SARAN = {
    hijau: ["Periksa ulang mulut dan kuku sapi besok dengan CowCare.",
            "Jaga kebersihan kandang dan batasi orang luar yang masuk."],
    kuning: ["Pisahkan sapi ini dari sapi lain.",
             "Jangan jual atau pindahkan sapi sampai diperiksa petugas.",
             "Periksa ulang dalam 24 jam. Bila gejala bertambah, hubungi dokter hewan."],
    merah: ["Segera hubungi dokter hewan atau petugas kesehatan hewan setempat.",
            "Pisahkan sapi ini dan jangan jual, pindahkan, atau potong sapi.",
            "Batasi orang dan kendaraan keluar-masuk kandang; cuci tangan, sepatu, dan alat.",
            "Jangan memberi obat tanpa arahan dokter hewan."]
  };
  var DISCLAIMER = "CowCare adalah alat bantu triase, bukan diagnosis. PMK hanya bisa dipastikan lewat pemeriksaan dokter hewan dan uji laboratorium. Bila ragu, hubungi dokter hewan atau petugas kesehatan hewan setempat.";

  // ---------- ikon (SVG garis, tanpa berkas eksternal) ----------
  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    scan: '<path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    chevR: '<path d="M9 18l6-6-6-6"/>',
    chevD: '<path d="M6 9l6 6 6-6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    phone: '<path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    offline: '<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.4-1.7M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 10.7 5M12 20h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5h.01"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    blister: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="1.5"/><circle cx="14.5" cy="13.5" r="2"/>',
    pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    hoof: '<path d="M7 4c-2 0-3 3-3 6s1 5 3 5 2.5-2 2.5-5S9 4 7 4zM17 4c2 0 3 3 3 6s-1 5-3 5-2.5-2-2.5-5S15 4 17 4z"/><path d="M5 19h4M15 19h4"/>',
    cow: '<path d="M7 7C5 7 3 6 3 4c2 0 4 1 5 2M17 7c2 0 4-1 4-3-2 0-4 1-5 2"/><path d="M7 7h10l1 7a6 6 0 0 1-12 0z"/><path d="M10 11h.01M14 11h.01"/><ellipse cx="12" cy="16.5" rx="3" ry="2"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    group: '<circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><circle cx="12" cy="17" r="3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    userx: '<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 12-5M17 15l4 4M21 15l-4 4"/>',
    save: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/>',
    stetho: '<path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v3a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="12" r="2"/>',
    arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    skip: '<path d="M5 5l9 7-9 7zM18 5v14"/>'
  };
  function ic(n) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || "") + '</svg>'; }
  $$("[data-icon]").forEach(function (el) { el.innerHTML = ic(el.dataset.icon); });
  $("#btnBack").innerHTML = ic("back");

  // ---------- umpan balik ----------
  function toast(msg, kind) {
    kind = kind || "ok";
    var box = $("#toasts"), n = document.createElement("div");
    n.className = "toast " + kind;
    n.innerHTML = ic(kind === "err" ? "alert" : kind === "info" ? "info" : "check") + "<span>" + esc(msg) + "</span>";
    box.appendChild(n);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { n.classList.add("out"); setTimeout(function () { n.remove(); }, 320); }, kind === "err" ? 5000 : 2600);
  }
  // Konfirmasi dua ketukan (tanpa dialog bawaan browser)
  function twoTap(btn, label, action) {
    if (!btn) return;
    var armed = false, orig = btn.innerHTML, timer;
    btn.onclick = function () {
      if (btn.disabled) return;
      if (!armed) {
        armed = true; btn.classList.add("armed"); btn.innerHTML = ic("alert") + label;
        timer = setTimeout(function () { armed = false; if (btn.isConnected) { btn.classList.remove("armed"); btn.innerHTML = orig; } }, 4000);
        return;
      }
      clearTimeout(timer); action();
    };
  }
  // efek riak pada semua tombol
  document.addEventListener("pointerdown", function (ev) {
    var b = ev.target.closest && ev.target.closest(".btn, .cta");
    if (!b || b.disabled) return;
    var r = b.getBoundingClientRect(), d = Math.max(r.width, r.height), s = document.createElement("span");
    s.className = "ripple"; s.style.width = s.style.height = d + "px";
    s.style.left = (ev.clientX - r.left - d / 2) + "px"; s.style.top = (ev.clientY - r.top - d / 2) + "px";
    b.appendChild(s); setTimeout(function () { s.remove(); }, 600);
  });

  // ---------- util tampilan ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pct(x, d) { return (x * 100).toFixed(d == null ? 0 : d) + "%"; }
  function num(x) { return String(x).replace(".", ","); }
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) + " " +
      d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  }
  function fmtTime(ts) { return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }); }
  function dayLabel(ts) {
    var d = new Date(ts), t = new Date(); t.setHours(0, 0, 0, 0);
    var dd = new Date(d); dd.setHours(0, 0, 0, 0);
    var diff = Math.round((t - dd) / 864e5);
    if (diff === 0) return "Hari ini";
    if (diff === 1) return "Kemarin";
    return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function relTime(ts) {
    var m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "baru saja";
    if (m < 60) return m + " menit lalu";
    var h = Math.round(m / 60); if (h < 24) return h + " jam lalu";
    var d = Math.round(h / 24); return d < 30 ? d + " hari lalu" : fmtDate(ts);
  }
  function setTitle(t, back, sub, hero) {
    $("#title").textContent = t; $("#subtitle").textContent = sub || ""; $("#btnBack").hidden = !back;
    $("#topbar").classList.toggle("hero", !!hero);
  }
  function setTab(tab) { $$(".bottomnav a").forEach(function (a) { a.classList.toggle("on", a.dataset.tab === tab); }); }
  function showNav(on) { $("#nav").hidden = !on; view.classList.toggle("no-nav", !on); $("#toasts").classList.toggle("no-nav", !on); }
  function refreshNet() {
    var b = $("#netBadge"); if (!b) return;
    var on = navigator.onLine;
    if (!ai.ready && !ai.error) { b.textContent = "Menyiapkan AI"; b.className = "net"; b.hidden = false; }
    else if (!on) { b.textContent = "Offline"; b.className = "net off"; b.hidden = false; }
    else b.hidden = true;
  }
  window.addEventListener("online", refreshNet); window.addEventListener("offline", refreshNet);
  window.addEventListener("scroll", function () { $("#topbar").classList.toggle("scrolled", window.scrollY > 4); }, { passive: true });

  // transisi antar layar: animasi hanya saat layar berganti, bukan saat isi diperbarui
  var lastKey = null, navDir = "fwd", enterTimer;
  function paint(key, html, after) {
    view.innerHTML = html;
    var entering = key !== lastKey;
    if (entering) {
      clearTimeout(enterTimer);
      view.classList.remove("enter", "back"); void view.offsetWidth;
      view.classList.add("enter"); if (navDir === "back") view.classList.add("back");
      enterTimer = setTimeout(function () { view.classList.remove("enter", "back"); }, 800);
      window.scrollTo(0, 0);
    }
    lastKey = key; navDir = "fwd";
    animateValues(entering);
    if (after) after();
  }
  function animateValues(entering) {
    var targets = $$("[data-off]").concat($$("[data-left]"));
    if (!entering) { targets.forEach(applyTarget); }
    else requestAnimationFrame(function () { requestAnimationFrame(function () { targets.forEach(applyTarget); }); });
    $$("[data-count]").forEach(function (el) {
      var to = parseFloat(el.dataset.count), dec = to % 1 ? 1 : 0;
      if (!entering) { el.textContent = num(to.toFixed(dec)); return; }
      var t0 = null;
      function stepF(ts) {
        if (!t0) t0 = ts;
        var k = Math.min(1, (ts - t0) / 1100), e = 1 - Math.pow(1 - k, 3);
        el.textContent = num((to * e).toFixed(dec));
        if (k < 1) requestAnimationFrame(stepF);
      }
      requestAnimationFrame(stepF);
    });
  }
  function applyTarget(el) {
    if (el.dataset.off != null) el.style.strokeDashoffset = el.dataset.off;
    if (el.dataset.left != null) el.style.left = el.dataset.left;
  }
  function ringHtml(s, status, cls, label) {
    var R = 42, C = 2 * Math.PI * R, off = C * (1 - Math.max(0, Math.min(100, s)) / 100);
    return '<div class="ring st-' + status + (cls ? " " + cls : "") + '"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="' + R + '" fill="none" stroke-width="9"/>' +
      '<circle class="fg" cx="50" cy="50" r="' + R + '" fill="none" stroke-width="9" stroke-dasharray="' + C.toFixed(1) + '" style="stroke-dashoffset:' + C.toFixed(1) + '" data-off="' + off.toFixed(1) + '"/></svg>' +
      '<div class="val"><div><b><span data-count="' + s + '">0</span>%</b><span class="cap">' + (label || "skor S") + '</span></div></div></div>';
  }
  function disclaimerHtml() { return '<div class="disclaimer">' + ic("info") + '<span>' + DISCLAIMER + '</span></div>'; }

  // ---------- layar: persetujuan ----------
  function viewConsent() {
    setTitle("", false); showNav(false); $("#topbar").hidden = true;
    var feats = [["lock", "Foto tidak diunggah", "Foto diproses langsung di HP ini oleh AI, tidak dikirim ke server mana pun."],
      ["db", "Riwayat hanya di HP", "Tanggal, skor, jawaban, dan foto kecil tersimpan di HP ini dan bisa dihapus kapan saja."],
      ["userx", "Tanpa data pribadi", "Tidak ada login, tidak meminta nama, NIK, atau lokasi GPS."],
      ["offline", "Jalan tanpa sinyal", "Setelah dibuka sekali, CowCare tetap bisa dipakai di kandang tanpa internet."]];
    paint("consent",
      '<div class="consent-hero"><img class="logo" src="icon.svg" alt="Logo CowCare"><h2>CowCare</h2>' +
      '<p class="muted">Triase dini penyakit mulut dan kuku (PMK) pada sapi, langsung di HP.</p></div>' +
      '<div class="card"><h3>' + ic("shield") + 'Sebelum mulai</h3>' +
      feats.map(function (f) { return '<div class="feature"><div class="fi">' + ic(f[0]) + '</div><div><b>' + f[1] + '</b><span>' + f[2] + '</span></div></div>'; }).join("") + '</div>' +
      '<div class="notice warn">' + ic("alert") + '<span>' + DISCLAIMER + '</span></div>' +
      '<div class="stack" style="margin-top:16px"><button class="btn primary big" id="cSetuju">' + ic("check") + 'Saya setuju, lanjut</button>' +
      '<button class="btn" id="cTolak">Pakai tanpa menyimpan riwayat</button></div>' +
      '<p class="xs center" style="margin-top:10px">Tanpa simpan: riwayat hanya di memori dan hilang saat aplikasi ditutup.</p>',
      function () {
        $("#cSetuju").onclick = function () { store.set("consent", "setuju"); store.set("consentAt", Date.now()); enterApp(); };
        $("#cTolak").onclick = function () { store.set("consent", "tolak"); enterApp(); };
      });
  }
  function enterApp() { $("#topbar").hidden = false; go("#beranda"); }

  // ---------- layar: beranda ----------
  function greet() { var h = new Date().getHours(); return h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 19 ? "Selamat sore" : "Selamat malam"; }
  function viewHome() {
    setTitle("CowCare", false, "Triase dini PMK", true); setTab("beranda");
    var h = history(), last = h[0];
    var html = '<section class="home-hero"><div class="greet">' + greet() + ',</div><div class="big">Pantau kesehatan sapi Anda hari ini</div></section>';
    if (last) {
      html += '<div class="card last-card st-' + last.status + '" data-i="' + last.t + '" role="button" tabindex="0">' + ringHtml(last.S, last.status, "sm") +
        '<div class="grow"><div class="lbl">Pemeriksaan terakhir</div><div class="ttl">' + STATUS[last.status].label + '</div>' +
        '<div class="xs">' + esc(last.sapi || "Sapi tanpa nama") + ' · ' + relTime(last.t) + '</div></div><span class="chev">' + ic("chevR") + '</span></div>';
    } else {
      html += '<div class="card last-card empty-last" style="cursor:default"><div class="ei">' + ic("cow") + '</div><div><div class="lbl">Status pemeriksaan terakhir</div>' +
        '<div class="small" style="margin-top:2px">Belum ada pemeriksaan. Mulai dengan menekan tombol di bawah.</div></div></div>';
    }
    html += '<button class="cta" id="goPeriksa"><span class="ci">' + ic("scan") + '</span><span><b>Periksa Sapi</b><span class="s">Foto mulut, kuku bila pincang, 1 pertanyaan</span></span><span class="arrow">' + ic("arrowR") + '</span></button>';
    html += '<div class="chips"><span class="chip">' + ic("clock") + '± 1 menit</span><span class="chip">' + ic("offline") + 'Bisa offline</span><span class="chip">' + ic("lock") + 'Foto tetap di HP</span></div>';
    html += '<div class="section-h"><h2>Riwayat terbaru</h2>' + (h.length > 3 ? '<a class="link" href="#riwayat">Lihat semua</a>' : "") + '</div>';
    if (!h.length) html += '<div class="card center"><p class="muted small" style="margin:0">Riwayat akan muncul di sini setelah Anda menyimpan hasil pemeriksaan.</p></div>';
    else html += '<div class="list">' + h.slice(0, 3).map(itemHtml).join("") + '</div>';
    if (consent() !== "setuju") html += '<div class="notice info small">' + ic("info") + '<span>Mode tanpa simpan: riwayat hilang saat aplikasi ditutup. <a class="link" href="#info" style="padding:0">Ubah di Info</a></span></div>';
    html += disclaimerHtml();
    paint("home", html, function () {
      $("#goPeriksa").onclick = function () { newSession(); go("#periksa"); };
      bindItems();
    });
  }
  function itemHtml(e) {
    return '<div class="item st-' + e.status + '" data-i="' + e.t + '" role="button" tabindex="0">' +
      (e.foto ? '<img class="th" src="' + e.foto + '" alt="">' : '<span class="th">' + ic("cow") + '</span>') +
      '<div class="grow"><b>' + esc(e.sapi || "Sapi tanpa nama") + '</b><div class="meta">' + fmtDate(e.t) + '</div>' +
      '<span class="pill st-' + e.status + '" style="margin-top:4px">' + STATUS[e.status].label + '</span></div>' +
      '<div class="score"><b>' + num(e.S) + '%</b><span class="xs">skor S</span></div><span class="chev">' + ic("chevR") + '</span></div>';
  }
  function bindItems() {
    $$("[data-i]").forEach(function (el) {
      el.onclick = function () { go("#detail-" + el.dataset.i); };
      el.onkeydown = function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); el.click(); } };
    });
  }

  // ---------- layar: periksa (3 langkah) ----------
  function stepper(n) {
    var names = ["Mulut", "Kuku", "Jarak"], h = '<div class="stepper" aria-label="Langkah ' + n + ' dari 3">';
    for (var i = 1; i <= 3; i++) {
      h += '<div class="st' + (i === n ? " on" : i < n ? " done" : "") + '"><span class="dot">' + (i < n ? ic("check") : i) + '</span>' + names[i - 1] + '</div>';
      if (i < 3) h += '<div class="bar' + (i < n ? " full" : "") + '"><i></i></div>';
    }
    return h + '</div>';
  }
  function badgeTone(o) {
    if (o.band === "gagal" || o.band === "rendah") return "abu";
    return o.sakit ? (o.band === "yakin" ? "merah" : "kuning") : (o.band === "yakin" ? "hijau" : "kuning");
  }
  function badgeHtml(o, fresh) {
    var st = badgeTone(o), t, msg, act, icon;
    var nama = o.area === "mulut" ? "mulut" : "kuku";
    if (o.band === "gagal") {
      icon = "alert";
      var why = [];
      if (o.issues.indexOf("gelap") >= 0) why.push("terlalu gelap");
      if (o.issues.indexOf("terang") >= 0) why.push("terlalu terang");
      if (o.issues.indexOf("buram") >= 0) why.push("buram");
      if (o.issues.indexOf("salah_area") >= 0) {
        t = "Foto ini tampak seperti " + (o.area === "mulut" ? "kuku" : "mulut") + ", bukan " + nama;
        msg = "Pastikan Anda memotret " + nama + " sapi. Hasil AI untuk foto ini tidak dipakai.";
      } else {
        t = "Foto kurang jelas (" + why.join(", ") + ")";
        msg = "Ulangi foto di tempat terang, dekatkan kamera ke " + nama + " sapi, dan tahan HP agar tidak goyang.";
      }
      act = "Foto ulang, atau isi derajat di bawah sendiri.";
    } else if (o.band === "rendah") {
      icon = "help"; t = "AI tidak yakin";
      msg = "Foto mungkin terlalu jauh atau terhalang.";
      act = "Foto ulang lebih dekat, atau isi derajat di bawah sendiri.";
    } else {
      icon = o.sakit ? "alert" : "check";
      t = o.sakit ? "Tampak tanda luka/lepuh di " + nama : "Tidak tampak luka di " + nama;
      msg = o.band === "yakin" ? "AI cukup yakin. Tetap cocokkan dengan kondisi sapi." :
        "AI ragu-ragu. Lihat langsung " + nama + " sapi sebelum memilih derajat.";
      act = o.sakit ? "Pilih derajat yang paling sesuai di bawah." : "Bila Anda melihat luka, ganti pilihan di bawah.";
      if (o.sakit) msg += " Catatan: AI versi uji coba sering menandai " + nama + " sapi sehat sebagai luka, jadi pastikan dengan mata sendiri.";
    }
    var bandTxt = { yakin: "yakin", ragu: "ragu", rendah: "tidak yakin", gagal: "foto ditolak" }[o.band];
    return '<div class="badge st-' + st + (fresh ? " pop" : "") + '" id="badge"><div class="hd"><span class="bi">' + ic(icon) + '</span><div>' +
      '<div class="t">' + esc(t) + '</div><div class="cf">Hasil AI · ' + bandTxt + (o.band !== "gagal" ? " · keyakinan " + pct(o.conf) : "") + '</div></div></div>' +
      (o.band !== "gagal" ? '<div class="conf"><i style="width:' + Math.round(o.conf * 100) + '%"></i><span class="mk" style="left:60%"></span><span class="mk" style="left:80%"></span></div>' +
        '<div class="conf-l"><span>tidak yakin</span><span style="margin-left:auto;margin-right:9%">ragu</span><span>yakin</span></div>' : "") +
      '<div class="msg">' + esc(msg) + '</div><div class="act">' + esc(act) + '</div>' +
      '<div class="xs" style="margin-top:6px">' + ic("clock") + ' Dianalisis di HP dalam ' + o.latency_ms + ' ms</div></div>';
  }
  function optsHtml(name, list, val, tone) {
    return '<div class="opts" role="radiogroup" data-name="' + name + '">' + list.map(function (x, i) {
      var lv = ""; for (var k = 1; k < list.length; k++) lv += '<i' + (k <= i ? ' class="f"' : "") + '></i>';
      return '<button type="button" role="radio" aria-checked="' + (val === i) + '" class="opt' + (val === i ? " sel" : "") + '" data-v="' + i + '">' +
        '<span class="n">' + i + '</span><span class="tx"><b>' + x[0] + '</b><small>' + x[1] + '</small>' +
        (i ? '<span class="lv" style="--lvc:' + (i >= list.length - 1 ? "var(--r600)" : i >= (list.length - 1) / 2 ? "var(--y600)" : "var(--g600)") + '">' + lv + '</span>' : "") +
        '</span><span class="ck">' + ic("check") + '</span></button>';
    }).join("") + '</div>';
  }
  // pilihan diperbarui langsung di tempat (tanpa render ulang layar) supaya transisinya terlihat
  function bindOpts(onSel) {
    $$(".opts").forEach(function (g) {
      $$(".opt", g).forEach(function (b) {
        b.onclick = function () {
          $$(".opt", g).forEach(function (o) { o.classList.toggle("sel", o === b); o.setAttribute("aria-checked", o === b); });
          onSel(g.dataset.name, b.dataset.v);
        };
      });
    });
  }
  function photoBlock(area, data) {
    var label = area === "mulut" ? "mulut" : "kuku", h = '<div class="preview' + (data ? " has" : "") + '" id="prev">';
    if (data) {
      h += '<img src="' + data.preview + '" alt="Foto ' + label + ' sapi"' + (data._seen ? ' style="animation:none"' : "") + '>';
      data._seen = true;
      if (S.busy) h += '<div class="scan"></div><div class="scan-l"><span class="spinner"></span>' + (ai.ready ? "AI menganalisis foto di HP…" : "Menunggu model AI siap…") + '</div>';
      else if (data.ai) {
        var st = badgeTone(data.ai);
        h += '<span class="ai-tag st-' + st + '">' + ic("spark") + ' ' + (data.ai.band === "gagal" ? "Foto ditolak" : (data.ai.sakit ? "Tanda luka" : "Tidak tampak luka") + " · " + pct(data.ai.conf)) + '</span>';
      }
    } else {
      h += '<span class="pi">' + ic(area === "mulut" ? "cow" : "hoof") + '</span><b style="color:var(--ink2)">Pratinjau foto ' + label + ' sapi</b>' +
        '<span class="xs" style="max-width:240px">' + (area === "mulut" ? "Gusi, lidah, dan liur harus terlihat jelas" : "Sela kuku dan pinggiran atas kuku, bersih dari lumpur") + '</span>';
    }
    h += '<span class="frame"></span></div>';
    h += '<div class="row photo-actions"><button class="btn ' + (data ? "" : "primary") + '" id="bCam"' + (S.busy ? " disabled" : "") + '>' + ic("scan") + (data ? "Foto ulang" : "Ambil foto") + '</button>' +
      '<button class="btn" id="bGal"' + (S.busy ? " disabled" : "") + '>' + ic("image") + 'Galeri</button></div>';
    if (!ai.ready && !ai.error) h += '<div class="model-load" id="modelLoad"><span class="spinner dark"></span><span>Menyiapkan model AI (sekali saja)</span><span class="track"><i></i></span></div>';
    if (ai.error) h += '<div class="notice err">' + ic("alert") + '<span>Model AI gagal dimuat. Anda tetap bisa mengisi derajat sendiri.</span></div>';
    if (S.aiErr) h += '<div class="notice err">' + ic("alert") + '<span>' + esc(S.aiErr) + '</span></div>';
    return h;
  }
  function sampleBlock(area) {
    var list = area === "mulut" ?
      [["contoh_mulut_lesi.jpg", "Mulut berlesi"], ["contoh_mulut_sehat.jpg", "Mulut sehat"], ["contoh_kuku.jpg", "Foto kuku"]] :
      [["contoh_kuku.jpg", "Kuku"], ["contoh_mulut_lesi.jpg", "Foto mulut"]];
    return '<div class="samples"><div class="samples-t">' + ic("spark") + 'Coba dengan foto contoh (demo)</div><div class="sample-row">' +
      list.map(function (s) { return '<button type="button" data-sample="samples/' + s[0] + '"' + (S.busy ? " disabled" : "") + '><img src="samples/' + s[0] + '" alt="">' + s[1] + '</button>'; }).join("") +
      '</div><p class="xs" style="margin-top:4px">Sumber: EuFMD Lesion Library dan Zenodo FMD Cattle.</p></div>';
  }
  var pickArea = "mulut";
  function bindPhoto(area) {
    pickArea = area;
    $("#bCam").onclick = function () { $("#fileCam").value = ""; $("#fileCam").click(); };
    $("#bGal").onclick = function () { $("#fileGal").value = ""; $("#fileGal").click(); };
    $$("[data-sample]").forEach(function (b) { b.onclick = function () { analyze(area, b.dataset.sample); }; });
  }
  function onFile(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type || "image/")) { toast("Berkas bukan gambar", "err"); return; }
    readFile(f).then(function (url) { analyze(pickArea, url); }).catch(function (e) { toast(e.message, "err"); });
  }
  $("#fileCam").addEventListener("change", onFile);
  $("#fileGal").addEventListener("change", onFile);

  function analyze(area, src) {
    // foto baru: derajat lama untuk area ini dikosongkan agar dipilih ulang
    if (area === "mulut") { S.liur = null; S.lepuhMulut = null; } else S.lepuhKuku = null;
    S.busy = true; S.aiErr = null;
    var sess = S;
    loadImage(src).then(function (im) {
      var rgba = toTensorRGBA(im);
      var data = { preview: thumb(im, 480, 0.8), foto: thumb(im, 96, 0.6) };
      sess[area] = data; if (S === sess) renderPeriksa();
      return predict(new Uint8ClampedArray(rgba)).then(function (r) {
        data.ai = interpret(area, r); data.aiFresh = true;
        // saran awal: bila AI yakin/ragu "sehat" -> derajat 0. Bila "sakit", pengguna memilih derajat sendiri.
        if (data.ai.band === "yakin" || data.ai.band === "ragu") {
          if (!data.ai.sakit) { if (area === "mulut") { sess.liur = 0; sess.lepuhMulut = 0; } else sess.lepuhKuku = 0; data.aiPrefill = true; }
          else { if (area === "mulut") { sess.liur = null; sess.lepuhMulut = null; } else sess.lepuhKuku = null; }
        }
      }).catch(function (e) { sess.aiErr = "AI tidak dapat menganalisis foto (" + e.message + "). Isi derajat sendiri."; });
    }).catch(function (e) {
      toast("Foto tidak dapat dibuka: " + e.message, "err");
    }).then(function () {
      sess.busy = false;
      if (S !== sess || location.hash !== "#periksa") return;
      renderPeriksa();
      var b = $("#badge") || $("#qLiur") || $("#qKuku");
      if (b && b.scrollIntoView) setTimeout(function () { b.scrollIntoView({ behavior: "smooth", block: "start" }); }, 250);
    });
    renderPeriksa();
  }

  function reqHtml(items) {
    return '<div class="req">' + items.map(function (x) { return '<span class="' + (x[1] ? "ok" : "") + '">' + (x[1] ? ic("check") : "○") + " " + x[0] + '</span>'; }).join("") + '</div>';
  }
  function step1Ready() { return !!(S.mulut && S.liur != null && S.lepuhMulut != null && !S.busy); }
  function step1Action() {
    return '<button class="btn primary big" id="next1"' + (step1Ready() ? "" : " disabled") + '>Lanjut ' + ic("arrowR") + '</button>' +
      reqHtml([["Foto", !!S.mulut], ["Analisis AI", !!(S.mulut && !S.busy)], ["Air liur", S.liur != null], ["Lepuh", S.lepuhMulut != null]]);
  }
  function step2Ready() { return !!(S.kuku && S.lepuhKuku != null && !S.busy); }
  function step2Action() {
    return '<button class="btn primary big" id="next2"' + (step2Ready() ? "" : " disabled") + '>Lanjut ' + ic("arrowR") + '</button>' +
      '<button class="btn ghost" id="skip2" style="margin-top:4px"' + (S.busy ? " disabled" : "") + '>' + ic("skip") + 'Lewati foto kuku</button>';
  }
  function step3Action() {
    return '<button class="btn primary big" id="hitung"' + (S.jarak ? "" : " disabled") + '>' + ic("chart") + 'Lihat hasil</button>' +
      (S.jarak ? "" : '<div class="req"><span>Pilih jarak kandang dulu</span></div>');
  }
  function bindAction() {
    var n1 = $("#next1"), n2 = $("#next2"), sk = $("#skip2"), hi = $("#hitung");
    if (n1) n1.onclick = function () { if (!step1Ready()) return; S.step = 2; renderPeriksa(); };
    if (n2) n2.onclick = function () { if (!step2Ready()) return; S.step = 3; renderPeriksa(); };
    if (sk) sk.onclick = function () { S.kuku = null; S.lepuhKuku = null; S.kukuSkip = true; S.kukuMode = false; S.step = 3; renderPeriksa(); toast("Foto kuku dilewati", "info"); };
    if (hi) hi.onclick = function () {
      if (!S.jarak) return;
      S.sapi = $("#sapi").value.trim();
      var t0 = performance.now();
      S.hasil = window.CowScore.hitung({ liur: S.liur, lepuhMulut: S.lepuhMulut, lepuhKuku: S.lepuhKuku, jarak: S.jarak });
      S.hasil.scoreMs = Math.round((performance.now() - t0) * 100) / 100;
      S.saved = false;
      go("#hasil");
    };
  }
  function refreshAction(fn) { var a = $("#actionbar"); if (a) { a.innerHTML = fn(); bindAction(); } }

  function renderPeriksa() {
    if (!S) newSession();
    setTitle("Periksa Sapi", S.step > 1 || S.kukuMode, "Langkah " + S.step + " dari 3"); setTab("periksa");
    var h = stepper(S.step), key = "periksa-" + S.step;
    if (S.step === 1) {
      h += '<div><h2 class="step-h">Foto mulut sapi <span class="tag">Wajib</span></h2>' +
        '<p class="muted small">Buka sedikit mulut sapi, foto dari dekat di tempat terang.</p></div>';
      h += '<div>' + photoBlock("mulut", S.mulut) + (S.mulut ? "" : sampleBlock("mulut")) + '</div>';
      if (S.mulut && S.mulut.ai) { h += badgeHtml(S.mulut.ai, S.mulut.aiFresh); S.mulut.aiFresh = false; }
      if (S.mulut && !S.busy) {
        var hintSakit = S.mulut.ai && S.mulut.ai.sakit && S.mulut.ai.band !== "gagal" && S.mulut.ai.band !== "rendah";
        h += '<div class="q" id="qLiur"><div class="q-h"><h3>' + ic("drop") + ' Seberapa banyak air liurnya?</h3><span class="xs">bobot 61,2%</span></div>' + optsHtml("liur", LIUR, S.liur) + '</div>';
        h += '<div class="q"><div class="q-h"><h3>' + ic("blister") + ' Lepuh di gusi atau lidah?</h3><span class="xs">bobot 25,6%</span></div>' + optsHtml("lepuhMulut", LEPUH, S.lepuhMulut) + '</div>';
        if (S.mulut.aiPrefill) h += '<div class="notice ok small">' + ic("spark") + '<span>AI tidak melihat luka, jadi derajat 0 diisi sebagai saran awal. Ganti bila kondisi sapi berbeda.</span></div>';
        if (hintSakit) h += '<div class="notice warn small">' + ic("alert") + '<span>AI melihat tanda luka di mulut. Pilih derajat yang Anda lihat langsung; pilih 0 bila ternyata tidak ada.</span></div>';
        if (S.mulut) h += sampleBlock("mulut");
      }
      h += '<div class="actionbar" id="actionbar">' + step1Action() + '</div>';
      paint(key, h, function () {
        bindPhoto("mulut"); bindAction();
        bindOpts(function (n, v) { S[n] = parseInt(v, 10); if (S.mulut) S.mulut.aiPrefill = false; refreshAction(step1Action); });
      });
    } else if (S.step === 2) {
      if (!S.kukuMode && !S.kuku) {
        h += '<div><h2 class="step-h">Foto kuku <span class="tag opt">Bila pincang</span></h2><p class="muted small">Lepuh di sela kuku sering muncul bersama lepuh di mulut.</p></div>';
        h += '<div class="lame-art"><span class="ai">' + ic("hoof") + '</span><div><b>Apakah sapi pincang?</b><div class="small muted">Sering mengangkat kaki, enggan berjalan, atau ada luka di sela kuku.</div></div></div>';
        h += '<div class="choice"><button class="yes" id="kYa"><span class="ci">' + ic("scan") + '</span><b>Ya, pincang</b><small>Lanjut foto kuku</small></button>' +
          '<button class="no" id="kTidak"><span class="ci">' + ic("check") + '</span><b>Tidak</b><small>Langsung ke langkah 3</small></button></div>';
        paint(key + "-tanya", h, function () {
          $("#kYa").onclick = function () { S.kukuMode = true; S.kukuSkip = false; S.kuku = null; renderPeriksa(); };
          $("#kTidak").onclick = function () { S.kukuSkip = true; S.kukuMode = false; S.kuku = null; S.lepuhKuku = null; S.step = 3; renderPeriksa(); };
        });
        return;
      }
      h += '<div><h2 class="step-h">Foto kuku <span class="tag opt">Opsional</span></h2>' +
        '<p class="muted small">Bersihkan lumpur dulu. Foto sela kuku dan pinggiran atas kuku dari dekat.</p></div>';
      h += '<div>' + photoBlock("kuku", S.kuku) + sampleBlock("kuku") + '</div>';
      if (S.kuku && S.kuku.ai) { h += badgeHtml(S.kuku.ai, S.kuku.aiFresh); S.kuku.aiFresh = false; }
      if (S.kuku && !S.busy) h += '<div class="q" id="qKuku"><div class="q-h"><h3>' + ic("blister") + ' Lepuh di kuku?</h3><span class="xs">digabung ke lepuh terparah</span></div>' + optsHtml("lepuhKuku", LEPUH, S.lepuhKuku) + '</div>';
      h += '<div class="actionbar" id="actionbar">' + step2Action() + '</div>';
      paint(key + "-kuku", h, function () {
        bindPhoto("kuku"); bindAction();
        bindOpts(function (n, v) { S[n] = parseInt(v, 10); refreshAction(step2Action); });
      });
    } else {
      h += '<div><h2 class="step-h">Satu pertanyaan</h2><p class="muted small">Seberapa jauh kandang Anda dari kasus PMK aktif terdekat? Tanyakan ke petugas Dinas atau grup peternak bila belum tahu.</p></div>';
      h += '<div class="opts dist" role="radiogroup" data-name="jarak">' + JARAK.map(function (x) {
        return '<button type="button" role="radio" aria-checked="' + (S.jarak === x[0]) + '" class="opt' + (S.jarak === x[0] ? " sel" : "") + '" data-v="' + x[0] + '">' +
          '<span class="n">' + ic(x[3]) + '</span><span class="tx"><b>' + x[1] + '</b><small>' + x[2] + '</small></span><span class="ck">' + ic("check") + '</span></button>';
      }).join("") + '</div>';
      h += '<div><label class="f" for="sapi">Nama atau nomor sapi <span class="xs">(opsional)</span></label><div class="input">' + ic("tag") +
        '<input type="text" id="sapi" maxlength="30" placeholder="mis. Sapi 3 / Belang" value="' + esc(S.sapi) + '" autocomplete="off"></div>' +
        '<div class="hint">Membantu membedakan sapi di riwayat. Tidak perlu nama pemilik.</div></div>';
      var ring = [["Air liur", "derajat " + S.liur], ["Lepuh mulut", "derajat " + S.lepuhMulut], ["Kuku", S.lepuhKuku == null ? "tidak difoto" : "derajat " + S.lepuhKuku]];
      h += '<div class="card" style="margin-top:16px"><h3>' + ic("list") + 'Ringkasan isian</h3><table class="t">' +
        ring.map(function (r) { return '<tr><td>' + r[0] + '</td><td><b>' + r[1] + '</b></td></tr>'; }).join("") + '</table></div>';
      h += '<div class="actionbar" id="actionbar">' + step3Action() + '</div>';
      paint(key, h, function () {
        bindAction();
        $("#sapi").oninput = function () { S.sapi = this.value; };
        bindOpts(function (n, v) { S.jarak = v; refreshAction(step3Action); });
      });
    }
  }

  // ---------- layar: hasil ----------
  function aiSummary(d) {
    if (!d || !d.ai) return "tidak ada";
    var a = d.ai;
    return (a.band === "gagal" ? "foto ditolak (" + a.issues.join(", ") + ")" :
      (a.sakit ? "tanda luka" : "tidak tampak luka") + " " + pct(a.conf) + (a.band === "ragu" ? " (ragu)" : a.band === "rendah" ? " (tidak yakin)" : ""));
  }
  function dikoreksi() {
    var c = false;
    if (S.mulut && S.mulut.ai && S.mulut.ai.band !== "gagal") c = c || (S.mulut.ai.sakit !== ((S.lepuhMulut || 0) > 0 || (S.liur || 0) >= 2));
    if (S.kuku && S.kuku.ai && S.kuku.ai.band !== "gagal") c = c || (S.kuku.ai.sakit !== ((S.lepuhKuku || 0) > 0));
    return c;
  }
  function jarakTxt(j) { return j === "jauh" ? "Jauh (> 5 km)" : j === "dekat" ? "Dekat (≤ 5 km)" : "Tidak tahu (dihitung Dekat)"; }
  function viewHasil(entry) {
    var r, ctx;
    if (entry) { r = entry.hasil; ctx = entry; }
    else {
      if (!S || !S.hasil) { go("#periksa"); return; }
      r = S.hasil; ctx = { sapi: S.sapi, jarak: S.jarak, liur: S.liur, lepuhMulut: S.lepuhMulut, lepuhKuku: S.lepuhKuku,
        aiMulut: aiSummary(S.mulut), aiKuku: S.kuku ? aiSummary(S.kuku) : "tidak difoto", dikoreksi: dikoreksi() };
    }
    setTitle(entry ? "Detail pemeriksaan" : "Hasil Pemeriksaan", true, entry ? fmtDate(entry.t) : "Triase PMK, bukan diagnosis");
    setTab(entry ? "riwayat" : "periksa");
    var st = STATUS[r.status];
    var h = '<div class="result-hero st-' + r.status + '"><div class="top">' + ringHtml(r.S, r.status) +
      '<div><div class="lbl">Hasil triase</div><div class="ttl">' + st.label + '</div><div class="kata">' +
      (r.peringatanGejala ? "Gejala terlihat: tetap minta dokter hewan memeriksa" : st.kata) + '</div></div></div>' +
      '<span class="sapi">' + ic("cow") + esc(ctx.sapi || "Sapi tanpa nama") + '</span>' +
      '<div class="scale"><div class="tr"><span class="mk" style="left:0" data-left="' + Math.min(100, r.S) + '%"></span></div>' +
      '<div class="lb"><span style="left:0;transform:none">0</span><span style="left:30%">30 Waspada</span><span style="left:60%">60 Suspek</span><span style="right:0;left:auto;transform:none">100</span></div></div></div>';
    if (r.aturanMutlak) h += '<div class="notice info small">' + ic("pin") + '<span><b>Aturan Mutlak jarak:</b> kandang lebih dari 5 km dari kasus aktif, sehingga skor dihitung 0% (Aman).</span></div>';
    if (r.peringatanGejala) h += '<div class="notice err">' + ic("alert") + '<span><b>Perhatian:</b> walau jarak jauh, gejala terlihat pada sapi. Hubungi dokter hewan untuk memastikan.</span></div>';
    else if (r.status === "hijau" && r.lepuhDerajat >= 1) h += '<div class="notice warn">' + ic("alert") + '<span><b>Ada lepuh.</b> PMK wajib dilaporkan; minta petugas kesehatan hewan memeriksa sapi ini.</span></div>';
    h += '<div class="kpis"><div class="kpi st-' + r.status + '"><div class="kl">' + ic("chart") + 'Skor suspek (S)</div><b style="color:var(--cd)"><span data-count="' + r.S + '">0</span>%</b><div class="ks">Merah ≥ 60% · Kuning ≥ 30%</div></div>' +
      '<div class="kpi"><div class="kl">' + ic("trend") + 'Estimasi H</div><b><span data-count="' + r.H + '">0</span>%</b><div class="ks">harapan hidup, rentang 50–95%</div></div></div>';
    if (r.rujuk) h += contactBlock();
    h += '<div class="card st-' + r.status + '"><h3>' + ic("list") + 'Saran tindakan</h3><ol class="saran">' + SARAN[r.status].map(function (s) { return "<li><span>" + s + "</span></li>"; }).join("") + '</ol></div>';
    var k = r.kontribusi;
    h += '<div class="card"><h3>' + ic("chart") + 'Mengapa hasilnya begini?</h3><div class="bars">' +
      [["Air liur", k.liur, 61.2, "derajat " + ctx.liur], ["Lepuh terparah", k.lepuh, 25.6, "derajat " + r.lepuhDerajat + (ctx.lepuhKuku != null && ctx.lepuhKuku >= ctx.lepuhMulut && r.lepuhDerajat ? " (kuku)" : r.lepuhDerajat ? " (mulut)" : "")],
       ["Jarak kasus", k.jarak, 13.2, ctx.jarak === "jauh" ? "Jauh" : ctx.jarak === "dekat" ? "Dekat" : "Tidak tahu"]].map(function (b) {
        return '<div class="b"><div class="bl"><span><b>' + b[0] + '</b> · ' + b[3] + '</span><span><span class="val">' + num(b[1].toFixed(1)) + '</span> / ' + num(b[2]) + '</span></div>' +
          '<div class="track"><span class="max"></span><i style="width:' + (b[1] / b[2] * 100) + '%"></i></div></div>';
      }).join("") + '</div>' +
      '<div class="formula">S = 0,612·liur + 0,256·lepuh + 0,132·jarak = ' + num(r.S) + '%</div>' +
      '<p class="xs" style="margin:0">Angka = sumbangan ke skor S. Batas Kuning masih sementara, menunggu validasi dokter hewan.</p></div>';
    h += '<div class="card"><h3>' + ic("spark") + 'Ringkasan AI dan isian</h3><table class="t">' +
      '<tr><td>AI foto mulut</td><td>' + esc(ctx.aiMulut) + '</td></tr><tr><td>AI foto kuku</td><td>' + esc(ctx.aiKuku) + '</td></tr>' +
      '<tr><td>Jarak kasus</td><td>' + jarakTxt(ctx.jarak) + '</td></tr>' +
      '<tr><td>Derajat dikoreksi peternak</td><td>' + (ctx.dikoreksi ? "Ya, berbeda dari tebakan AI" : "Tidak") + '</td></tr>' +
      (entry && entry.model ? '<tr><td>Model</td><td>' + esc(entry.model) + '</td></tr>' : "") + '</table>' +
      '<p class="xs" style="margin:8px 0 0">Skor selalu memakai derajat yang dipilih peternak, bukan tebakan AI.</p></div>';
    if (!entry) {
      h += '<div class="row" style="margin-top:4px"><button class="btn primary' + (S.saved ? " done" : "") + '" id="simpan"' + (S.saved ? " disabled" : "") + '>' +
        (S.saved ? ic("check") + "Tersimpan" : ic("save") + "Simpan") + '</button><button class="btn" id="lagi">' + ic("refresh") + 'Periksa lagi</button></div>';
    } else {
      h += '<button class="btn danger" id="hapusSatu">' + ic("trash") + 'Hapus pemeriksaan ini</button>';
    }
    h += disclaimerHtml();
    paint(entry ? "detail-" + entry.t : "hasil", h, function () {
      bindContact(r, ctx);
      if (!entry) {
        $("#simpan").onclick = function () {
          if (S.saved) return;
          var e = { t: Date.now(), sapi: S.sapi, S: r.S, H: r.H, status: r.status, jarak: S.jarak, liur: S.liur,
            lepuhMulut: S.lepuhMulut, lepuhKuku: S.lepuhKuku, aiMulut: ctx.aiMulut, aiKuku: ctx.aiKuku,
            aiKelasMulut: S.mulut && S.mulut.ai ? S.mulut.ai.kelas : "", aiConfMulut: S.mulut && S.mulut.ai ? S.mulut.ai.conf : null,
            aiMs: S.mulut && S.mulut.ai ? S.mulut.ai.latency_ms : null, dikoreksi: dikoreksi(),
            foto: S.mulut ? S.mulut.foto : null, hasil: r, model: S.mulut && S.mulut.ai ? S.mulut.ai.model_version : "" };
          var hh = history(); hh.unshift(e);
          if (!saveHistory(hh)) return;
          S.saved = true;
          var b = $("#simpan"); b.disabled = true; b.classList.add("done"); b.innerHTML = ic("check") + "Tersimpan";
          toast(consent() === "setuju" ? "Hasil tersimpan di riwayat" : "Tersimpan sementara (mode tanpa simpan)");
        };
        $("#lagi").onclick = function () { newSession(); go("#periksa"); };
      } else {
        twoTap($("#hapusSatu"), "Tekan sekali lagi untuk menghapus", function () {
          saveHistory(history().filter(function (x) { return x.t !== entry.t; }));
          toast("Pemeriksaan dihapus"); navDir = "back"; go("#riwayat");
        });
      }
    });
  }
  function summaryText(r, ctx) {
    return "CowCare – hasil triase PMK\nSapi: " + (ctx.sapi || "-") + "\nStatus: " + STATUS[r.status].label +
      "\nSkor suspek S: " + num(r.S) + "% | H: " + num(r.H) + "%\nAir liur derajat " + ctx.liur + ", lepuh terparah derajat " + r.lepuhDerajat +
      ", jarak kasus: " + (ctx.jarak === "jauh" ? "> 5 km" : ctx.jarak === "dekat" ? "≤ 5 km" : "tidak tahu") +
      "\nAI foto mulut: " + ctx.aiMulut + "\n(Hasil triase, bukan diagnosis. Mohon pemeriksaan dokter hewan.)";
  }
  function contactBlock() {
    var tel = store.get("vetTel", "");
    return '<div class="card contact"><h3>' + ic("stetho") + 'Hubungi dokter hewan</h3>' +
      (tel ? '<p class="small muted">Nomor tersimpan: <b>' + esc(tel) + '</b></p>' : '<p class="small muted">Belum ada nomor dokter hewan. Simpan nomornya agar bisa langsung menelepon.</p>') +
      '<div class="row">' + (tel ? '<button class="btn primary" id="callVet">' + ic("phone") + 'Telepon</button>' : '<button class="btn" id="setVet">' + ic("phone") + 'Atur nomor</button>') +
      '<button class="btn" id="shareVet">' + ic("share") + 'Kirim hasil</button></div></div>';
  }
  function bindContact(r, ctx) {
    var c = $("#callVet"), s = $("#shareVet"), sv = $("#setVet");
    if (c) c.onclick = function () {
      var tel = store.get("vetTel", "");
      if (Android && Android.dial) Android.dial(tel); else location.href = "tel:" + tel.replace(/[^0-9+]/g, "");
    };
    if (sv) sv.onclick = function () { focusTel = true; telReturn = location.hash === "#hasil" ? "#hasil" : null; go("#info"); };
    if (s) s.onclick = function () {
      var txt = summaryText(r, ctx);
      if (Android && Android.shareText) Android.shareText(txt);
      else if (navigator.share) navigator.share({ text: txt }).catch(function () {});
      else window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank");
    };
  }

  // ---------- layar: riwayat ----------
  var histFilter = "semua";
  function viewRiwayat() {
    var h = history();
    setTitle("Riwayat", false, h.length ? h.length + " pemeriksaan" + (consent() === "setuju" ? " tersimpan di HP" : " (sementara)") : ""); setTab("riwayat");
    if (!h.length) {
      paint("riwayat-kosong", '<div class="empty"><div class="art">' + ic("list") + '</div><h3>Belum ada pemeriksaan</h3>' +
        '<p class="muted small">Simpan hasil pemeriksaan untuk melihat tren skor dan kelompok risiko kandang di sini.</p>' +
        '<button class="btn primary" id="emptyGo" style="margin-top:14px">' + ic("scan") + 'Periksa Sapi</button></div>',
        function () { $("#emptyGo").onclick = function () { newSession(); go("#periksa"); }; });
      return;
    }
    var html = "";
    var cnt = { merah: 0, kuning: 0, hijau: 0 }; h.forEach(function (e) { cnt[e.status]++; });
    // kelompok risiko kandang (K-means)
    if (h.length >= 5) {
      var pts = h.map(function (e) { return [e.S / 100, e.jarak === "jauh" ? 0 : 1]; });
      var km = window.CowScore.kmeans(pts, 3);
      var lastC = km.assign[0], cS = km.centroids[lastC][0] * 100;
      var lab = window.CowScore.labelKelompok(cS);
      var stc = lab === "Aman" ? "hijau" : lab === "Waspada" ? "kuning" : "merah";
      var n = km.assign.filter(function (a) { return a === lastC; }).length;
      html += '<div class="card st-' + stc + '"><div class="cluster"><span class="cv">' + ic("group") + '</span><div><div class="xs">Kelompok risiko kandang</div>' +
        '<div style="font-size:19px;font-weight:750;color:var(--cd)">' + lab + '</div><div class="xs">Pemeriksaan terakhir masuk kelompok rata-rata S ' + num(cS.toFixed(1)) + '% (' + n + ' dari ' + h.length + ')</div></div></div>';
    } else {
      html += '<div class="card"><div class="cluster"><span class="cv" style="background:var(--g50);color:var(--g700)">' + ic("group") + '</span><div><div class="xs">Kelompok risiko kandang</div>' +
        '<div style="font-weight:700">Butuh ' + (5 - h.length) + ' pemeriksaan lagi</div><div class="conf" style="margin-top:6px"><i style="width:' + (h.length / 5 * 100) + '%;background:var(--g700)"></i></div>' +
        '<div class="xs">Minimal 5 data (sekarang ' + h.length + ')</div></div></div>';
    }
    html += '<div class="stats3"><div class="st-merah"><b>' + cnt.merah + '</b><span>Suspek tinggi</span></div><div class="st-kuning"><b>' + cnt.kuning + '</b><span>Waspada</span></div>' +
      '<div class="st-hijau"><b>' + cnt.hijau + '</b><span>Risiko rendah</span></div></div>' +
      (h.length >= 5 ? '<p class="xs" style="margin:10px 0 0">Dihitung dengan K-means (K = 3) dari skor S dan kategori jarak.</p>' : "") + '</div>';
    // tren
    var last = h.slice(0, 12).reverse();
    html += '<div class="card"><h3>' + ic("trend") + 'Tren skor S <span class="xs" style="margin-left:auto;font-weight:500">' + last.length + ' terakhir</span></h3>';
    if (last.length >= 2) {
      var W = 320, Hh = 140, px = 10, py = 12;
      var xs = function (i) { return px + i * (W - 2 * px) / (last.length - 1); }, ys = function (s) { return Hh - py - s / 100 * (Hh - 2 * py); };
      var pl = last.map(function (e, i) { return xs(i).toFixed(1) + "," + ys(e.S).toFixed(1); }).join(" ");
      var area = "M" + xs(0).toFixed(1) + "," + (Hh - py) + " L" + pl.replace(/ /g, " L") + " L" + xs(last.length - 1).toFixed(1) + "," + (Hh - py) + " Z";
      var col = { hijau: "#2e6b34", kuning: "#d0880f", merah: "#d13a2b" };
      html += '<svg class="trend" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Tren skor S">' +
        '<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d8445" stop-opacity=".28"/><stop offset="1" stop-color="#3d8445" stop-opacity="0"/></linearGradient></defs>' +
        '<rect x="0" y="' + ys(100) + '" width="' + W + '" height="' + (ys(60) - ys(100)) + '" fill="#d13a2b" opacity=".05"/>' +
        '<rect x="0" y="' + ys(60) + '" width="' + W + '" height="' + (ys(30) - ys(60)) + '" fill="#d0880f" opacity=".05"/>' +
        '<line x1="0" x2="' + W + '" y1="' + ys(60) + '" y2="' + ys(60) + '" stroke="#d13a2b" stroke-dasharray="4 4" opacity=".7"/>' +
        '<line x1="0" x2="' + W + '" y1="' + ys(30) + '" y2="' + ys(30) + '" stroke="#d0880f" stroke-dasharray="4 4" opacity=".7"/>' +
        '<path class="area" d="' + area + '" fill="url(#ga)"/>' +
        '<polyline class="line" fill="none" stroke="#2e6b34" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="' + pl + '"/>' +
        last.map(function (e, i) { return '<circle cx="' + xs(i).toFixed(1) + '" cy="' + ys(e.S).toFixed(1) + '" r="5" fill="#fff" stroke="' + col[e.status] + '" stroke-width="3" style="animation-delay:' + (0.3 + i * 0.06) + 's"/>'; }).join("") +
        '</svg><div class="legend"><span><i style="color:#d13a2b"></i>Batas Suspek 60%</span><span><i style="color:#d0880f"></i>Batas Waspada 30%</span></div>';
    } else html += '<p class="xs" style="margin:0">Grafik muncul setelah ada minimal 2 pemeriksaan.</p>';
    html += '</div>';
    html += '<button class="btn" id="csv" style="margin-bottom:16px">' + ic("download") + 'Ekspor CSV</button>';
    html += '<div class="filters" role="tablist">' + [["semua", "Semua", h.length], ["merah", "Suspek", cnt.merah], ["kuning", "Waspada", cnt.kuning], ["hijau", "Rendah", cnt.hijau]].map(function (f) {
      return '<button role="tab" data-f="' + f[0] + '" class="' + (histFilter === f[0] ? "on" : "") + '">' + f[1] + ' · ' + f[2] + '</button>';
    }).join("") + '</div><div id="histList">' + listGrouped(h) + '</div>';
    paint("riwayat", html, function () {
      bindItems();
      $("#csv").onclick = exportCsv;
      $$("[data-f]").forEach(function (b) {
        b.onclick = function () {
          histFilter = b.dataset.f;
          $$("[data-f]").forEach(function (x) { x.classList.toggle("on", x === b); });
          $("#histList").innerHTML = listGrouped(history()); bindItems();
        };
      });
    });
  }
  function listGrouped(h) {
    var list = h.filter(function (e) { return histFilter === "semua" || e.status === histFilter; });
    if (!list.length) return '<p class="muted small center" style="padding:16px 0">Tidak ada pemeriksaan dengan status ini.</p>';
    var out = "", cur = null;
    list.forEach(function (e) {
      var d = dayLabel(e.t);
      if (d !== cur) { if (cur !== null) out += '</div>'; out += '<div class="day">' + d + '</div><div class="list">'; cur = d; }
      out += itemHtml(e);
    });
    return out + '</div>';
  }
  function exportCsv() {
    var rows = [["tanggal", "sapi", "S_persen", "H_persen", "status", "kategori_jarak", "derajat_liur", "lepuh_mulut", "lepuh_kuku", "ai_mulut", "ai_kuku", "dikoreksi_pengguna"]];
    history().forEach(function (e) {
      rows.push([new Date(e.t).toISOString(), e.sapi || "", e.S, e.H, e.status, e.jarak, e.liur, e.lepuhMulut, e.lepuhKuku == null ? "" : e.lepuhKuku, e.aiMulut, e.aiKuku, e.dikoreksi ? "ya" : "tidak"]);
    });
    var csv = rows.map(function (r) { return r.map(function (v) { v = String(v == null ? "" : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
    var name = "cowcare_riwayat_" + new Date().toISOString().slice(0, 10) + ".csv";
    if (Android && Android.saveCsv) { Android.saveCsv(name, csv); toast("Menyimpan " + name); return; }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    toast("Diunduh: " + name);
  }

  // ---------- layar: info & pengaturan ----------
  var focusTel = false, telReturn = null, openAcc = { panduan: true };
  function acc(id, icon, title, body) {
    return '<div class="acc' + (openAcc[id] ? " open" : "") + '" data-acc="' + id + '"><button type="button" aria-expanded="' + !!openAcc[id] + '"><span class="ai">' + ic(icon) + '</span>' + title +
      '<span class="chev">' + ic("chevD") + '</span></button><div class="body"><div><div class="inner">' + body + '</div></div></div></div>';
  }
  function viewInfo() {
    setTitle("Info & Pengaturan", false, "Panduan, cara skor, dan data Anda"); setTab("info");
    var c = consent(), n = history().length, tel = store.get("vetTel", "");
    var h = acc("panduan", "scan", "Panduan foto", '<ol><li>Foto di tempat terang (siang hari, bukan di bawah bayangan).</li><li>Dekatkan kamera ke mulut sapi; gusi, lidah, dan liur harus terlihat.</li>' +
      '<li>Untuk kuku: bersihkan lumpur, foto sela kuku dan pinggiran atas kuku.</li><li>Tahan HP agar tidak goyang. Satu sapi per foto.</li></ol>');
    h += acc("skor", "chart", "Cara skor dihitung", '<p>CowCare memakai 3 faktor terbesar penentu status PMK:</p>' +
      '<table class="t"><tr><td>Air liur (derajat 0–4)</td><td><b>61,2%</b></td></tr><tr><td>Lepuh terparah, mulut atau kuku (0–3)</td><td><b>25,6%</b></td></tr><tr><td>Jarak ke kasus aktif</td><td><b>13,2%</b></td></tr></table>' +
      '<div class="formula">S = 0,612·liur + 0,256·lepuh + 0,132·jarak<br>H = 95 − 0,45·S (50–95%)</div>' +
      '<p>Merah bila S ≥ 60%, Kuning bila S ≥ 30% (batas sementara, menunggu validasi dokter hewan). Bila kandang lebih dari 5 km dari kasus aktif, S = 0% dan H = 95% (Aturan Mutlak), tetapi CowCare tetap memberi peringatan bila gejala terlihat.</p>');
    h += acc("ai", "spark", "Peran AI dan batasnya", '<p>AI (MobileNetV2, 4 kelas: mulut/kuku sakit atau sehat) membaca foto langsung di HP. Keyakinan ≥ 80% disebut yakin, 60–80% ragu, di bawahnya tidak yakin. Foto ditolak bila terlalu gelap, terlalu terang, buram, atau salah area.</p>' +
      '<p><b>Keterbatasan:</b> model uji coba dilatih dari 1.138 foto (akurasi uji 96,8%, recall kelas sakit 96,6%). Pada foto sapi sehat dari sumber lain, AI sering keliru menandainya sebagai luka. Karena itu skor selalu memakai derajat yang Anda pilih.</p>');
    h += acc("sop", "book", "SOP PMK", '<p>' + DISCLAIMER + '</p><ul><li>Tanda PMK: demam, air liur berlebihan, lepuh di mulut, lidah, gusi, sela kuku, atau puting, sapi pincang dan enggan makan.</li>' +
      '<li>PMK menular cepat lewat kontak langsung, orang, kendaraan, dan peralatan.</li><li>Pisahkan sapi bergejala, jangan menjual atau memindahkan sapi.</li><li>Laporkan ke petugas kesehatan hewan setempat.</li></ul>');
    h += '<div class="card" style="margin-top:14px"><h3>' + ic("stetho") + 'Nomor dokter hewan / petugas</h3><div class="input">' + ic("phone") +
      '<input type="tel" id="vetTel" inputmode="tel" placeholder="mis. 0812xxxxxxx" value="' + esc(tel) + '"></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn primary" id="saveTel">' + ic("save") + 'Simpan nomor</button>' +
      (tel ? '<button class="btn" id="testTel">' + ic("phone") + 'Telepon</button>' : "") + '</div><div class="hint">Disimpan hanya di HP ini. Dipakai tombol Telepon di layar hasil.</div></div>';
    h += '<div class="card"><h3>' + ic("db") + 'Riwayat pemeriksaan</h3><div class="toggle" id="tgWrap"><div class="tx"><b>Simpan riwayat di HP</b><div class="small muted">' +
      (c === "setuju" ? "Tersimpan di HP ini saja" + (n ? " (" + n + " data)" : "") + ". Foto tidak dikirim ke mana pun." : "Mati: riwayat hanya di memori" + (n ? " (" + n + " data)" : "") + " dan hilang saat aplikasi ditutup.") +
      '</div></div><button class="switch" id="tgSimpan" role="switch" aria-checked="' + (c === "setuju") + '" aria-label="Simpan riwayat di HP"></button></div>' +
      '<button class="btn danger" id="hapus" style="margin-top:14px"' + (n ? "" : " disabled") + '>' + ic("trash") + 'Hapus seluruh riwayat</button></div>';
    h += '<p class="ver">CowCare ' + APP_VERSION + ' · Kelompok 13 PPKBP<br>Tanpa login · Tanpa GPS · Foto tidak diunggah</p>';
    paint("info", h, function () {
      $$("[data-acc] > button").forEach(function (b) {
        b.onclick = function () {
          var el = b.parentNode, id = el.dataset.acc; openAcc[id] = !openAcc[id];
          el.classList.toggle("open", openAcc[id]); b.setAttribute("aria-expanded", openAcc[id]);
        };
      });
      var inp = $("#vetTel"), sb = $("#saveTel");
      inp.oninput = function () { sb.classList.remove("done"); sb.innerHTML = ic("save") + "Simpan nomor"; };
      sb.onclick = function () {
        var v = inp.value.trim();
        if (v && !/^\+?[0-9(][0-9\s()-]{5,}$/.test(v)) { toast("Nomor tidak valid. Gunakan angka, mis. 0812…", "err"); inp.focus(); return; }
        store.set("vetTel", v); sb.classList.add("done"); sb.innerHTML = ic("check") + "Tersimpan";
        toast(v ? "Nomor dokter hewan tersimpan" : "Nomor dihapus");
        var back = v && telReturn === "#hasil" && S && S.hasil ? "#hasil" : null; telReturn = null;
        setTimeout(function () { if (location.hash !== "#info") return; if (back) { navDir = "back"; window.history.back(); } else viewInfo(); }, 900);
      };
      var tt = $("#testTel");
      if (tt) tt.onclick = function () { var t = store.get("vetTel", ""); if (Android && Android.dial) Android.dial(t); else location.href = "tel:" + t.replace(/[^0-9+]/g, ""); };
      if (focusTel) { focusTel = false; setTimeout(function () { inp.scrollIntoView({ behavior: "smooth", block: "center" }); inp.focus(); }, 350); }
      function toggleSimpan() {
        if (consent() === "setuju") { memHistory = store.get("riwayat", []); store.del("riwayat"); store.set("consent", "tolak"); toast("Riwayat dipindah ke memori saja", "info"); }
        else { store.set("consent", "setuju"); if (!store.set("riwayat", memHistory)) toast("Memori HP penuh", "err"); else toast("Riwayat kini disimpan di HP"); }
        var sw = $("#tgSimpan"); sw.setAttribute("aria-checked", consent() === "setuju");
        setTimeout(function () { if (location.hash === "#info") viewInfo(); }, 280);
      }
      $("#tgSimpan").onclick = function (ev) { ev.stopPropagation(); toggleSimpan(); };
      $("#tgWrap").onclick = toggleSimpan;
      twoTap($("#hapus"), "Tekan lagi untuk menghapus semua", function () { store.del("riwayat"); memHistory = []; toast("Seluruh riwayat dihapus"); viewInfo(); });
    });
  }

  // ---------- router ----------
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function render() {
    refreshNet();
    var hash = location.hash || "#beranda";
    if (!consent()) { viewConsent(); return; }
    $("#topbar").hidden = false; showNav(true);
    if (hash === "#periksa") { if (!S || S.hasil) newSession(); renderPeriksa(); }
    else if (hash === "#hasil") viewHasil();
    else if (hash === "#riwayat") viewRiwayat();
    else if (hash.indexOf("#detail-") === 0) {
      var t = parseInt(hash.slice(8), 10), e = history().filter(function (x) { return x.t === t; })[0];
      e ? viewHasil(e) : go("#riwayat");
    }
    else if (hash === "#info") viewInfo();
    else viewHome();
    view.focus({ preventScroll: true });
  }
  $("#btnBack").onclick = function () {
    var hash = location.hash;
    navDir = "back";
    if (hash === "#periksa" && S && S.step > 1 && !S.busy) {
      S.step--;
      if (S.step === 2) { S.kukuSkip = false; S.kukuMode = !!S.kuku; }
      renderPeriksa();
    }
    else if (hash === "#hasil") { S.hasil = null; S.step = 3; location.hash = "#periksa"; }
    else if (window.history.length > 1) window.history.back(); else go("#beranda");
  };
  window.addEventListener("hashchange", function () {
    if (location.hash === "#periksa" && S && S.hasil && !S.saved) { S.hasil = null; }
    render();
  });
  window.CowCareApp = { back: function () { $("#btnBack").hidden ? go("#beranda") : $("#btnBack").click(); return !$("#btnBack").hidden || location.hash !== "#beranda"; } };

  // Service worker hanya untuk versi web (APK sudah membawa semua berkas di dalamnya)
  if ("serviceWorker" in navigator && !Android && (location.protocol === "https:" || location.hostname === "localhost")) {
    try { navigator.serviceWorker.register("sw.js").catch(function () {}); } catch (e) {}
  }
  render();
})();
