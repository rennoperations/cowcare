/* CowCare – logika antarmuka (PWA dan aplikasi Android berbasis WebView). */
(function () {
  "use strict";
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var view = $("#view");
  var Android = window.CowCareAndroid || null; // jembatan native bila berjalan di APK
  var APP_VERSION = "1.0.0";

  // ---------- penyimpanan lokal (hanya di HP) ----------
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("cowcare." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("cowcare." + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem("cowcare." + k); } catch (e) {} }
  };
  var memHistory = []; // dipakai bila pengguna tidak menyetujui penyimpanan
  function consent() { return store.get("consent", null); }
  function history() { return consent() === "setuju" ? store.get("riwayat", []) : memHistory; }
  function saveHistory(h) { if (consent() === "setuju") store.set("riwayat", h); else memHistory = h; }

  // ---------- model AI (Web Worker, fallback ke thread utama) ----------
  var ai = { ready: false, error: null, worker: null, pending: {}, seq: 0, model: null, waiters: [] };
  function aiReady() { ai.ready = true; ai.waiters.splice(0).forEach(function (f) { f(); }); refreshNet(); }
  function loadMainThread() {
    Promise.all([fetch("model/model.json").then(function (r) { return r.json(); }),
                 fetch("model/weights.bin").then(function (r) { return r.arrayBuffer(); })])
      .then(function (r) { ai.model = new window.CowEngine.Model(r[0], r[1]); aiReady(); })
      .catch(function (e) { ai.error = String(e); render(); });
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
        if (ai.worker) {
          var id = ++ai.seq;
          ai.pending[id] = function (d) { d.error ? reject(new Error(d.error)) : resolve(d.result); };
          ai.worker.postMessage({ type: "predict", id: id, rgba: rgba.buffer }, [rgba.buffer]);
        } else {
          setTimeout(function () { try { resolve(ai.model.predict(rgba)); } catch (e) { reject(e); } }, 30);
        }
      }
      ai.ready ? go() : ai.waiters.push(go);
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
          kukuSkip: false, jarak: null, busy: false, hasil: null, saved: false };
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
  var STATUS = {
    hijau: { label: "Risiko rendah", kata: "Pantau sapi setiap hari" },
    kuning: { label: "Waspada", kata: "Pisahkan sapi dan amati ketat" },
    merah: { label: "Suspek tinggi", kata: "Segera hubungi dokter hewan" }
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

  // Konfirmasi dua ketukan (tanpa dialog bawaan browser)
  function twoTap(btn, label, action) {
    var armed = false, orig = btn.textContent;
    btn.onclick = function () {
      if (!armed) { armed = true; btn.textContent = label; setTimeout(function () { armed = false; if (btn.isConnected && btn.textContent === label) btn.textContent = orig; }, 4000); return; }
      action();
    };
  }
  function toast(msg) {
    var n = document.createElement("p"); n.className = "notice err"; n.textContent = msg;
    view.insertBefore(n, view.firstChild); setTimeout(function () { n.remove(); }, 6000);
  }

  // ---------- util tampilan ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pct(x, d) { return (x * 100).toFixed(d == null ? 0 : d) + "%"; }
  function num(x) { return String(x).replace(".", ","); }
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) + " " +
      d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  }
  function setTitle(t, back) { $("#title").textContent = t; $("#btnBack").hidden = !back; }
  function setTab(tab) {
    Array.prototype.forEach.call(document.querySelectorAll(".bottomnav a"), function (a) { a.classList.toggle("on", a.dataset.tab === tab); });
  }
  function refreshNet() {
    var b = $("#netBadge"); if (!b) return;
    var on = navigator.onLine;
       b.textContent = !ai.ready ? "Menyiapkan…" : (on ? "" : "Mode offline");
    b.hidden = ai.ready && on;
    b.className = "net" + (on ? "" : " off");
  }
  window.addEventListener("online", refreshNet); window.addEventListener("offline", refreshNet);

  // ---------- layar: persetujuan ----------
  function viewConsent() {
    setTitle("Selamat datang", false); $("#nav").hidden = true;
    view.innerHTML =
      '<div class="consent">' +
      '<img class="logo" src="icon.svg" alt="">' +
      '<h2 style="text-align:center;margin-top:0">CowCare</h2>' +
      '<p style="text-align:center" class="muted">Triase dini penyakit mulut dan kuku (PMK) pada sapi, langsung di HP.</p>' +
      '<div class="card"><h3>Sebelum mulai</h3>' +
      '<p>Foto sapi diproses langsung di HP ini dan <b>tidak dikirim ke server</b>.</p>' +
      '<p>Riwayat pemeriksaan (tanggal, skor, jawaban, foto kecil) hanya disimpan di HP ini dan bisa dihapus kapan saja di menu Info.</p>' +
      '<p>CowCare tidak meminta nama, NIK, atau lokasi GPS.</p>' +
      '<p class="notice warn" style="margin-bottom:0">' + DISCLAIMER + '</p></div>' +
      '<div class="stack"><button class="btn primary big" id="cSetuju">Saya setuju, lanjut</button>' +
      '<button class="btn" id="cTolak">Pakai tanpa menyimpan riwayat</button></div></div>';
    $("#cSetuju").onclick = function () { store.set("consent", "setuju"); store.set("consentAt", Date.now()); go("#beranda"); };
    $("#cTolak").onclick = function () { store.set("consent", "tolak"); go("#beranda"); };
  }

  // ---------- layar: beranda ----------
  function viewHome() {
    setTitle("CowCare", false); setTab("beranda");
    var h = history(), last = h[0];
    var html = '<div class="card"><div class="muted">Status pemeriksaan terakhir</div>';
    if (last) {
      html += '<div style="margin:8px 0"><span class="pill st-' + last.status + '">' + STATUS[last.status].label + '</span></div>' +
        '<div class="small">' + esc(last.sapi || "Sapi tanpa nama") + ' · S ' + num(last.S) + '% · ' + fmtDate(last.t) + '</div>';
    } else html += '<p style="margin:8px 0 0">Belum ada pemeriksaan. Mulai dengan menekan tombol di bawah.</p>';
    html += '</div>';
    html += '<a class="btn primary big" href="#periksa" id="goPeriksa">Periksa Sapi</a>';
    html += '<p class="muted small" style="text-align:center">Butuh sekitar 1 menit: 1 foto mulut, foto kuku bila pincang, dan 1 pertanyaan.</p>';
    html += '<h2>Riwayat terbaru</h2>';
    if (!h.length) html += '<p class="muted">Riwayat akan muncul di sini.</p>';
    else html += '<div class="list">' + h.slice(0, 3).map(itemHtml).join("") + '</div>';
    if (consent() !== "setuju") html += '<p class="notice info small">Mode tanpa simpan: riwayat hilang saat aplikasi ditutup. Ubah di menu Info.</p>';
    html += '<p class="disclaimer">' + DISCLAIMER + '</p>';
    view.innerHTML = html;
    $("#goPeriksa").onclick = function () { newSession(); };
    bindItems();
  }
  function itemHtml(e, i) {
    return '<div class="item" data-i="' + e.t + '">' + (e.foto ? '<img src="' + e.foto + '" alt="">' : '<img alt="">') +
      '<div class="grow"><b>' + esc(e.sapi || "Sapi tanpa nama") + '</b><div class="small muted">' + fmtDate(e.t) + ' · S ' + num(e.S) + '%</div></div>' +
      '<span class="pill st-' + e.status + '">' + STATUS[e.status].label + '</span></div>';
  }
  function bindItems() {
    Array.prototype.forEach.call(document.querySelectorAll(".item[data-i]"), function (el) {
      el.onclick = function () { go("#detail-" + el.dataset.i); };
    });
  }

  // ---------- layar: periksa (3 langkah) ----------
  function steps(n) {
    var s = '<div class="steps" aria-label="Langkah ' + n + ' dari 3">';
    for (var i = 1; i <= 3; i++) s += '<i class="' + (i <= n ? "on" : "") + '"></i>';
    return s + '</div>';
  }
  function badgeHtml(o) {
    var st, t, msg, act;
    var nama = o.area === "mulut" ? "mulut" : "kuku";
    if (o.band === "gagal") {
      st = "abu";
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
      st = "abu"; t = "AI tidak yakin (" + pct(o.conf) + ")";
      msg = "Foto mungkin terlalu jauh atau terhalang.";
      act = "Foto ulang lebih dekat, atau isi derajat di bawah sendiri.";
    } else {
      st = o.sakit ? (o.band === "yakin" ? "merah" : "kuning") : (o.band === "yakin" ? "hijau" : "kuning");
      t = (o.sakit ? "Tampak tanda luka/lepuh di " + nama : "Tidak tampak luka di " + nama) + " · keyakinan " + pct(o.conf);
      msg = o.band === "yakin" ? "AI cukup yakin. Tetap cocokkan dengan kondisi sapi." :
        "AI ragu-ragu. Lihat langsung " + nama + " sapi sebelum memilih derajat.";
      act = o.sakit ? "Pilih derajat yang paling sesuai di bawah." : "Bila Anda melihat luka, ganti pilihan di bawah.";
      if (o.sakit) msg += " Catatan: AI versi uji coba sering menandai " + nama + " sapi sehat sebagai luka, jadi pastikan dengan mata sendiri.";
    }
    return '<div class="badge st-' + st + '" id="badge"><div class="t">Hasil AI: ' + esc(t) + '</div>' +
      (o.band !== "gagal" ? '<div class="conf" style="color:' + (st === "merah" ? "#c0392b" : st === "hijau" ? "#2e6b34" : st === "kuning" ? "#b7791f" : "#888") +
        '"><i style="width:' + Math.round(o.conf * 100) + '%"></i></div>' : "") +
      '<div class="small" style="margin-top:6px">' + esc(msg) + '</div><div class="small"><b>' + esc(act) + '</b></div>' +
      '<div class="small muted">Waktu analisis di HP: ' + o.latency_ms + ' ms</div></div>';
  }
  function optsHtml(name, list, val, aiHint) {
    return '<div class="opts" role="radiogroup" data-name="' + name + '">' + list.map(function (x, i) {
      return '<button type="button" role="radio" aria-checked="' + (val === i) + '" class="opt' + (val === i ? " sel" : "") +
        (aiHint === i ? " ai" : "") + '" data-v="' + i + '"><span class="n">' + i + '</span><span><b>' + x[0] + '</b><small>' + x[1] +
        (aiHint === i ? " · saran AI" : "") + '</small></span></button>';
    }).join("") + '</div>';
  }
  function bindOpts(onSel) {
    Array.prototype.forEach.call(document.querySelectorAll(".opts"), function (g) {
      Array.prototype.forEach.call(g.querySelectorAll(".opt"), function (b) {
        b.onclick = function () { onSel(g.dataset.name, parseInt(b.dataset.v, 10)); };
      });
    });
  }
  function photoBlock(area, data) {
    var label = area === "mulut" ? "mulut" : "kuku";
    var h = '<div class="preview" id="prev" style="' + (data ? "background-image:url(" + data.preview + ")" : "") + '">' +
      (data ? "" : "Pratinjau foto " + label + " sapi") + '</div>';
    h += '<div class="row"><button class="btn primary" id="bCam">Ambil foto</button><button class="btn" id="bGal">Pilih dari galeri</button></div>';
    if (S.busy) h += '<p class="notice info"><span class="spinner"></span>AI sedang menganalisis foto di HP…</p>';
    if (!ai.ready && !ai.error) h += '<p class="muted small"><span class="spinner"></span>Model AI sedang dimuat (sekali saja)…</p>';
    if (ai.error) h += '<p class="notice err">Model AI gagal dimuat. Anda tetap bisa mengisi derajat sendiri.</p>';
    return h;
  }
  function sampleBlock(area) {
    var list = area === "mulut" ?
      [["contoh_mulut_lesi.jpg", "Mulut berlesi"], ["contoh_mulut_sehat.jpg", "Mulut sehat"], ["contoh_kuku.jpg", "Foto kuku"]] :
      [["contoh_kuku.jpg", "Kuku"], ["contoh_mulut_lesi.jpg", "Foto mulut"]];
    return '<details><summary>Coba dengan foto contoh (untuk demo)</summary><div class="sample-row" style="margin-top:10px">' +
      list.map(function (s) { return '<button type="button" data-sample="samples/' + s[0] + '"><img src="samples/' + s[0] + '" alt="">' + s[1] + '</button>'; }).join("") +
      '</div><p class="muted small">Sumber foto contoh: EuFMD Lesion Library dan Zenodo FMD Cattle (dataset kurasi kelompok).</p></details>';
  }
  var pickArea = "mulut";
  function bindPhoto(area) {
    pickArea = area;
    $("#bCam").onclick = function () { $("#fileCam").value = ""; $("#fileCam").click(); };
    $("#bGal").onclick = function () { $("#fileGal").value = ""; $("#fileGal").click(); };
    Array.prototype.forEach.call(document.querySelectorAll("[data-sample]"), function (b) {
      b.onclick = function () { analyze(area, b.dataset.sample); };
    });
  }
  function onFile(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    readFile(f).then(function (url) { analyze(pickArea, url); }).catch(function (e) { toast(e.message); });
  }
  $("#fileCam").addEventListener("change", onFile);
  $("#fileGal").addEventListener("change", onFile);

  function analyze(area, src) {
    // foto baru: derajat lama untuk area ini dikosongkan agar dipilih ulang
    if (area === "mulut") { S.liur = null; S.lepuhMulut = null; } else S.lepuhKuku = null;
    S.busy = true; renderPeriksa();
    loadImage(src).then(function (im) {
      var rgba = toTensorRGBA(im);
      var data = { preview: thumb(im, 480, 0.8), foto: thumb(im, 96, 0.6) };
      S[area] = data; renderPeriksa();
      return predict(new Uint8ClampedArray(rgba)).then(function (r) {
        data.ai = interpret(area, r);
        // saran awal: bila AI yakin/ragu "sehat" -> derajat 0. Bila "sakit", pengguna memilih derajat sendiri.
        if (data.ai.band === "yakin" || data.ai.band === "ragu") {
          if (!data.ai.sakit) { if (area === "mulut") { S.liur = 0; S.lepuhMulut = 0; } else S.lepuhKuku = 0; }
          else { if (area === "mulut") { S.liur = null; S.lepuhMulut = null; } else S.lepuhKuku = null; }
        }
      });
    }).catch(function (e) {
      setTimeout(function () { toast("Foto tidak dapat dianalisis: " + e.message); }, 0);
    }).then(function () { S.busy = false; renderPeriksa(); });
  }

  function renderPeriksa() {
    if (!S) newSession();
    setTitle("Periksa Sapi", S.step > 1); setTab("periksa");
    var h = steps(S.step);
    if (S.step === 1) {
      h += '<h2 style="margin-top:0">1. Foto mulut sapi <span class="muted small">(wajib)</span></h2>';
      h += '<p class="muted small">Buka sedikit mulut sapi, foto dari dekat di tempat terang. Gusi, lidah, dan liur harus terlihat.</p>';
      h += photoBlock("mulut", S.mulut) + sampleBlock("mulut");
      if (S.mulut && S.mulut.ai) h += badgeHtml(S.mulut.ai);
      if (S.mulut && !S.busy) {
        var hintSakit = S.mulut.ai && S.mulut.ai.sakit && S.mulut.ai.band !== "gagal" && S.mulut.ai.band !== "rendah";
        h += '<h3 style="margin-top:14px">Seberapa banyak air liurnya?</h3>' + optsHtml("liur", LIUR, S.liur, null);
        h += '<h3 style="margin-top:14px">Lepuh di gusi atau lidah?</h3>' + optsHtml("lepuhMulut", LEPUH, S.lepuhMulut, null);
        if (hintSakit) h += '<p class="notice warn small">AI melihat tanda luka di mulut. Pilih derajat yang Anda lihat langsung; pilih 0 bila ternyata tidak ada.</p>';
      }
      h += '<div style="margin-top:14px"><button class="btn primary" id="next1" ' + (S.mulut && S.liur != null && S.lepuhMulut != null && !S.busy ? "" : "disabled") + '>Lanjut</button></div>';
      view.innerHTML = h; bindPhoto("mulut");
      bindOpts(function (n, v) { S[n] = v; renderPeriksa(); });
      $("#next1").onclick = function () { S.step = 2; renderPeriksa(); window.scrollTo(0, 0); };
    } else if (S.step === 2) {
      h += '<h2 style="margin-top:0">2. Foto kuku <span class="muted small">(bila sapi pincang)</span></h2>';
      if (!S.kuku && !S.busy) {
        h += '<p>Apakah sapi pincang, sering mengangkat kaki, atau ada luka di sela kuku?</p>';
        h += '<div class="stack"><button class="btn primary" id="kYa">Ya, foto kuku</button><button class="btn" id="kTidak">Tidak, lewati</button></div>';
        if (S.kukuMode) { renderPeriksaKuku(); return; }
        view.innerHTML = h;
        $("#kYa").onclick = function () { S.kukuMode = true; S.kuku = null; renderPeriksaKuku(); };
        $("#kTidak").onclick = function () { S.kukuSkip = true; S.lepuhKuku = null; S.step = 3; renderPeriksa(); };
        return;
      }
      renderPeriksaKuku(); return;
    } else if (S.step === 3) {
      h += '<h2 style="margin-top:0">3. Satu pertanyaan</h2>';
      h += '<p>Seberapa jauh kandang Anda dari kasus PMK aktif terdekat?</p><p class="muted small">Tanyakan ke petugas Dinas atau grup peternak bila belum tahu.</p>';
      h += '<div class="opts" data-name="jarak">' +
        [["jauh", "Jauh", "Lebih dari 5 km"], ["dekat", "Dekat", "5 km atau kurang"], ["tidak_tahu", "Tidak tahu", "Dihitung sebagai Dekat demi keamanan"]].map(function (x) {
          return '<button type="button" class="opt' + (S.jarak === x[0] ? " sel" : "") + '" data-j="' + x[0] + '"><span class="n">' + x[1][0] + '</span><span><b>' + x[1] + '</b><small>' + x[2] + '</small></span></button>';
        }).join("") + '</div>';
      h += '<label class="f" for="sapi">Nama atau nomor sapi <span class="muted small">(opsional)</span></label><input type="text" id="sapi" maxlength="30" placeholder="mis. Sapi 3 / Belang" value="' + esc(S.sapi) + '">';
      h += '<div style="margin-top:14px"><button class="btn primary big" id="hitung" ' + (S.jarak ? "" : "disabled") + '>Lihat hasil</button></div>';
      view.innerHTML = h;
      Array.prototype.forEach.call(document.querySelectorAll("[data-j]"), function (b) {
        b.onclick = function () { S.jarak = b.dataset.j; S.sapi = $("#sapi").value; renderPeriksa(); };
      });
      $("#hitung").onclick = function () {
        S.sapi = $("#sapi").value.trim();
        var t0 = performance.now();
        S.hasil = window.CowScore.hitung({ liur: S.liur, lepuhMulut: S.lepuhMulut, lepuhKuku: S.lepuhKuku, jarak: S.jarak });
        S.hasil.scoreMs = Math.round((performance.now() - t0) * 100) / 100;
        S.saved = false;
        go("#hasil");
      };
    }
  }
  function renderPeriksaKuku() {
    var h = steps(2) + '<h2 style="margin-top:0">2. Foto kuku</h2>' +
      '<p class="muted small">Bersihkan lumpur dari kuku lebih dulu. Foto sela kuku dan pinggiran atas kuku dari dekat.</p>';
    h += photoBlock("kuku", S.kuku) + sampleBlock("kuku");
    if (S.kuku && S.kuku.ai) h += badgeHtml(S.kuku.ai);
    if (S.kuku && !S.busy) h += '<h3 style="margin-top:14px">Lepuh di kuku?</h3>' + optsHtml("lepuhKuku", LEPUH, S.lepuhKuku, null);
    h += '<div class="stack" style="margin-top:14px"><button class="btn primary" id="next2" ' + (S.kuku && S.lepuhKuku != null && !S.busy ? "" : "disabled") + '>Lanjut</button>' +
      '<button class="btn" id="skip2">Lewati foto kuku</button></div>';
    view.innerHTML = h; bindPhoto("kuku");
    bindOpts(function (n, v) { S[n] = v; renderPeriksaKuku(); });
    $("#next2").onclick = function () { S.step = 3; renderPeriksa(); window.scrollTo(0, 0); };
    $("#skip2").onclick = function () { S.kuku = null; S.lepuhKuku = null; S.kukuSkip = true; S.step = 3; renderPeriksa(); };
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
  function viewHasil(entry) {
    var r, ctx;
    if (entry) { r = entry.hasil; ctx = entry; }
    else {
      if (!S || !S.hasil) { go("#periksa"); return; }
      r = S.hasil; ctx = { sapi: S.sapi, jarak: S.jarak, liur: S.liur, lepuhMulut: S.lepuhMulut, lepuhKuku: S.lepuhKuku,
        aiMulut: aiSummary(S.mulut), aiKuku: S.kuku ? aiSummary(S.kuku) : "tidak difoto" };
    }
    setTitle(entry ? "Detail pemeriksaan" : "Hasil Pemeriksaan", true); setTab(entry ? "riwayat" : "periksa");
    var st = STATUS[r.status];
    var h = '<div class="status-card st-' + r.status + '"><div class="big">' + st.label + '</div><div>' + (r.peringatanGejala ? "Gejala terlihat: tetap minta dokter hewan memeriksa" : st.kata) + '</div></div>';
    if (r.aturanMutlak) h += '<p class="notice info small">Aturan jarak: kandang lebih dari 5 km dari kasus aktif, sehingga skor dihitung 0% (Aman).</p>';
    if (r.peringatanGejala) h += '<p class="notice err"><b>Perhatian:</b> walau jarak jauh, gejala terlihat pada sapi. Hubungi dokter hewan untuk memastikan.</p>';
    else if (r.status === "hijau" && r.lepuhDerajat >= 1) h += '<p class="notice warn"><b>Ada lepuh.</b> PMK wajib dilaporkan; minta petugas kesehatan hewan memeriksa sapi ini.</p>';
    h += '<div class="kpis"><div class="kpi">Skor suspek (S)<b>' + num(r.S) + '%</b><span class="small muted">Merah bila ≥ 60%</span></div>' +
      '<div class="kpi">Estimasi harapan hidup (H)<b>' + num(r.H) + '%</b><span class="small muted">rentang 50–95%</span></div></div>';
    h += '<div class="card"><h3>Saran tindakan</h3><ol style="margin:0;padding-left:20px">' + SARAN[r.status].map(function (s) { return "<li>" + s + "</li>"; }).join("") + '</ol></div>';
    if (r.rujuk) h += contactBlock(r);
    h += '<div class="card"><h3>Mengapa hasilnya begini?</h3><div class="bars">' +
      [["Air liur", r.kontribusi.liur, 61.2, "derajat " + ctx.liur], ["Lepuh terparah", r.kontribusi.lepuh, 25.6, "derajat " + r.lepuhDerajat],
       ["Jarak kasus", r.kontribusi.jarak, 13.2, ctx.jarak === "jauh" ? "Jauh" : ctx.jarak === "dekat" ? "Dekat" : "Tidak tahu"]].map(function (b) {
        return '<div class="b"><span>' + b[0] + '<br><span class="muted small">' + b[3] + '</span></span><span class="track"><i style="width:' + (b[1] / b[2] * 100) + '%"></i></span><span>' + num(b[1].toFixed(1)) + '</span></div>';
      }).join("") + '</div><p class="muted small">Angka = sumbangan ke skor S (maksimum: liur 61,2; lepuh 25,6; jarak 13,2).</p>' +
      '<table class="t"><tr><td>AI foto mulut</td><td>' + esc(ctx.aiMulut) + '</td></tr><tr><td>AI foto kuku</td><td>' + esc(ctx.aiKuku) + '</td></tr></table></div>';
    if (!entry) {
      h += '<div class="row"><button class="btn primary" id="simpan">' + (S.saved ? "Tersimpan ✓" : "Simpan") + '</button><a class="btn" href="#periksa" id="lagi">Periksa lagi</a></div>';
    } else {
      h += '<button class="btn danger" id="hapusSatu">Hapus pemeriksaan ini</button>';
    }
    h += '<p class="disclaimer">' + DISCLAIMER + '</p>';
    view.innerHTML = h;
    bindContact(r, ctx);
    if (!entry) {
      $("#simpan").disabled = S.saved;
      $("#simpan").onclick = function () {
        var e = { t: Date.now(), sapi: S.sapi, S: r.S, H: r.H, status: r.status, jarak: S.jarak, liur: S.liur,
          lepuhMulut: S.lepuhMulut, lepuhKuku: S.lepuhKuku, aiMulut: ctx.aiMulut, aiKuku: ctx.aiKuku,
          aiKelasMulut: S.mulut && S.mulut.ai ? S.mulut.ai.kelas : "", aiConfMulut: S.mulut && S.mulut.ai ? S.mulut.ai.conf : null,
          aiMs: S.mulut && S.mulut.ai ? S.mulut.ai.latency_ms : null, dikoreksi: dikoreksi(),
          foto: S.mulut ? S.mulut.foto : null, hasil: r, model: S.mulut && S.mulut.ai ? S.mulut.ai.model_version : "" };
        var hh = history(); hh.unshift(e);
        saveHistory(hh); S.saved = true; viewHasil();
      };
      $("#lagi").onclick = function () { newSession(); };
    } else {
      twoTap($("#hapusSatu"), "Tekan sekali lagi untuk menghapus", function () {
        saveHistory(history().filter(function (x) { return x.t !== entry.t; })); go("#riwayat");
      });
    }
  }
  function summaryText(r, ctx) {
    return "CowCare – hasil triase PMK\nSapi: " + (ctx.sapi || "-") + "\nStatus: " + STATUS[r.status].label +
      "\nSkor suspek S: " + num(r.S) + "% | H: " + num(r.H) + "%\nAir liur derajat " + ctx.liur + ", lepuh terparah derajat " + r.lepuhDerajat +
      ", jarak kasus: " + (ctx.jarak === "jauh" ? "> 5 km" : ctx.jarak === "dekat" ? "≤ 5 km" : "tidak tahu") +
      "\nAI foto mulut: " + ctx.aiMulut + "\n(Hasil triase, bukan diagnosis. Mohon pemeriksaan dokter hewan.)";
  }
  function contactBlock(r) {
    var tel = store.get("vetTel", "");
    return '<div class="card"><h3>Hubungi dokter hewan</h3>' +
      (tel ? '<p class="small muted">Nomor tersimpan: ' + esc(tel) + '</p>' : '<p class="small muted">Simpan nomor dokter hewan/petugas di menu Info agar bisa langsung menelepon.</p>') +
      '<div class="row">' + (tel ? '<button class="btn primary" id="callVet">Telepon</button>' : "") +
      '<button class="btn" id="shareVet">Kirim hasil (WhatsApp/SMS)</button></div></div>';
  }
  function bindContact(r, ctx) {
    var c = $("#callVet"), s = $("#shareVet");
    if (c) c.onclick = function () {
      var tel = store.get("vetTel", "");
      if (Android && Android.dial) Android.dial(tel); else location.href = "tel:" + tel.replace(/[^0-9+]/g, "");
    };
    if (s) s.onclick = function () {
      var txt = summaryText(r, ctx);
      if (Android && Android.shareText) Android.shareText(txt);
      else if (navigator.share) navigator.share({ text: txt }).catch(function () {});
      else window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank");
    };
  }

  // ---------- layar: riwayat ----------
  function viewRiwayat() {
    setTitle("Riwayat", false); setTab("riwayat");
    var h = history();
    var html = "";
    if (!h.length) {
      view.innerHTML = '<p class="muted">Belum ada pemeriksaan tersimpan.</p><a class="btn primary" href="#periksa">Periksa Sapi</a>';
      return;
    }
    // kelompok risiko kandang (K-means)
    html += '<div class="card"><h3>Kelompok risiko kandang</h3>';
    if (h.length >= 5) {
      var pts = h.map(function (e) { return [e.S / 100, e.jarak === "jauh" ? 0 : 1]; });
      var km = window.CowScore.kmeans(pts, 3);
      var lastC = km.assign[0], cS = km.centroids[lastC][0] * 100;
      var lab = window.CowScore.labelKelompok(cS);
      var stc = lab === "Aman" ? "hijau" : lab === "Waspada" ? "kuning" : "merah";
      var n = km.assign.filter(function (a) { return a === lastC; }).length;
      html += '<p style="margin:4px 0"><span class="pill st-' + stc + '">' + lab + '</span></p><p class="small">Pemeriksaan terakhir masuk kelompok dengan rata-rata S ' +
        num(cS.toFixed(1)) + '% (' + n + ' dari ' + h.length + ' pemeriksaan). Dihitung dengan K-means (K = 3) dari skor S dan kategori jarak.</p>';
    } else html += '<p class="small muted">Butuh minimal 5 pemeriksaan tersimpan (sekarang ' + h.length + ').</p>';
    html += '</div>';
    // tren
    var last = h.slice(0, 12).reverse();
    if (last.length >= 2) {
      var W = 320, Hh = 110, pad = 8;
      var xs = function (i) { return pad + i * (W - 2 * pad) / (last.length - 1); }, ys = function (s) { return Hh - pad - s / 100 * (Hh - 2 * pad); };
      var pl = last.map(function (e, i) { return xs(i).toFixed(1) + "," + ys(e.S).toFixed(1); }).join(" ");
      html += '<div class="card"><h3>Tren skor S</h3><svg class="trend" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Tren skor S">' +
        '<line x1="0" x2="' + W + '" y1="' + ys(60) + '" y2="' + ys(60) + '" stroke="#c0392b" stroke-dasharray="4 4"/>' +
        '<line x1="0" x2="' + W + '" y1="' + ys(30) + '" y2="' + ys(30) + '" stroke="#b7791f" stroke-dasharray="4 4"/>' +
        '<polyline fill="none" stroke="#2e6b34" stroke-width="3" points="' + pl + '"/>' +
        last.map(function (e, i) { return '<circle cx="' + xs(i) + '" cy="' + ys(e.S) + '" r="4" fill="#2e6b34"/>'; }).join("") +
        '</svg><p class="muted small">Garis merah: batas Merah 60%. Garis kuning: batas Waspada 30%.</p></div>';
    }
    html += '<div class="row" style="margin-bottom:12px"><button class="btn" id="csv">Ekspor CSV</button></div>';
    html += '<div class="list">' + h.map(itemHtml).join("") + '</div>';
    view.innerHTML = html; bindItems();
    $("#csv").onclick = exportCsv;
  }
  function exportCsv() {
    var rows = [["tanggal", "sapi", "S_persen", "H_persen", "status", "kategori_jarak", "derajat_liur", "lepuh_mulut", "lepuh_kuku", "ai_mulut", "ai_kuku", "dikoreksi_pengguna"]];
    history().forEach(function (e) {
      rows.push([new Date(e.t).toISOString(), e.sapi || "", e.S, e.H, e.status, e.jarak, e.liur, e.lepuhMulut, e.lepuhKuku == null ? "" : e.lepuhKuku, e.aiMulut, e.aiKuku, e.dikoreksi ? "ya" : "tidak"]);
    });
    var csv = rows.map(function (r) { return r.map(function (v) { v = String(v == null ? "" : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
    var name = "cowcare_riwayat_" + new Date().toISOString().slice(0, 10) + ".csv";
    if (Android && Android.saveCsv) { Android.saveCsv(name, csv); return; }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- layar: info & pengaturan ----------
  function viewInfo() {
    setTitle("Info & Pengaturan", false); setTab("info");
    var c = consent();
    var h = '<details open><summary>Panduan foto</summary><ol class="small" style="padding-left:18px">' +
      '<li>Foto di tempat terang (siang hari, bukan di bawah bayangan).</li><li>Dekatkan kamera ke mulut sapi; gusi, lidah, dan liur harus terlihat.</li>' +
      '<li>Untuk kuku: bersihkan lumpur, foto sela kuku dan pinggiran atas kuku.</li><li>Tahan HP agar tidak goyang. Satu sapi per foto.</li></ol></details>';
    h += '<details><summary>Cara skor dihitung</summary><p class="small">CowCare memakai 3 faktor terbesar penentu status PMK:</p>' +
      '<table class="t"><tr><th>Faktor</th><th>Bobot</th></tr><tr><td>Air liur (derajat 0–4)</td><td>61,2%</td></tr><tr><td>Lepuh terparah, mulut atau kuku (0–3)</td><td>25,6%</td></tr><tr><td>Jarak ke kasus aktif</td><td>13,2%</td></tr></table>' +
      '<p class="small">S = 0,612 × liur + 0,256 × lepuh + 0,132 × jarak. Merah bila S ≥ 60%, Waspada bila S ≥ 30% (batas sementara, menunggu validasi dokter hewan). H = 95 − 0,45 × S. Bila kandang lebih dari 5 km dari kasus aktif, S = 0% dan H = 95% (Aturan Mutlak), tetapi CowCare tetap memberi peringatan bila gejala terlihat.</p>' +
      '<p class="small">AI (MobileNetV2) membaca foto untuk melihat ada atau tidaknya tanda luka. Derajat liur dan lepuh selalu dipastikan oleh Anda.</p>' +
      '<p class="small"><b>Keterbatasan AI versi ini:</b> model uji coba dilatih dari 1.138 foto. Pada uji dengan foto sapi sehat dari sumber lain, AI sering keliru menandainya sebagai luka. Karena itu skor CowCare selalu memakai derajat yang Anda pilih, bukan tebakan AI saja.</p></details>';
    h += '<details><summary>Tentang triase dan SOP PMK</summary><p class="small">' + DISCLAIMER + '</p><p class="small">Tanda PMK: demam, air liur berlebihan, lepuh di mulut, lidah, gusi, sela kuku, atau puting, sapi pincang dan enggan makan. PMK menular cepat lewat kontak langsung, orang, kendaraan, dan peralatan. Pisahkan sapi bergejala, jangan menjual atau memindahkan sapi, dan laporkan ke petugas kesehatan hewan.</p></details>';
    h += '<div class="card"><h3>Nomor dokter hewan / petugas</h3><input type="tel" id="vetTel" placeholder="mis. 0812xxxxxxx" value="' + esc(store.get("vetTel", "")) + '"><button class="btn" id="saveTel" style="margin-top:8px">Simpan nomor</button><p class="muted small">Disimpan hanya di HP ini.</p></div>';
    h += '<div class="card"><h3>Data dan persetujuan</h3><p class="small">Status: <b>' + (c === "setuju" ? "riwayat disimpan di HP ini" : "riwayat tidak disimpan") + '</b>. Foto tidak pernah dikirim ke server.</p>' +
      '<div class="stack">' + (c === "setuju" ? '<button class="btn" id="tolak">Berhenti menyimpan riwayat</button>' : '<button class="btn" id="setuju">Izinkan simpan riwayat di HP</button>') +
      '<button class="btn danger" id="hapus">Hapus semua riwayat</button></div></div>';
    h += '<p class="muted small">CowCare v' + APP_VERSION + ' · model ' + (ai.ready ? "MobileNetV2 PoC 4 kelas (siap)" : "sedang dimuat") + ' · Kelompok 13 PPKBP.</p>';
    view.innerHTML = h;
    $("#saveTel").onclick = function () { store.set("vetTel", $("#vetTel").value.trim()); $("#saveTel").textContent = "Tersimpan ✓"; };
    var t = $("#tolak"), s = $("#setuju");
    if (t) t.onclick = function () { memHistory = store.get("riwayat", []); store.del("riwayat"); store.set("consent", "tolak"); viewInfo(); };
    if (s) s.onclick = function () { store.set("consent", "setuju"); store.set("riwayat", memHistory); viewInfo(); };
    twoTap($("#hapus"), "Tekan sekali lagi untuk menghapus semua", function () {
      store.del("riwayat"); memHistory = []; $("#hapus").textContent = "Riwayat terhapus ✓"; $("#hapus").disabled = true;
    });
  }

  // ---------- router ----------
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function render() {
    refreshNet();
    var hash = location.hash || "#beranda";
    if (!consent()) { viewConsent(); return; }
    $("#nav").hidden = false;
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
    if (hash === "#periksa" && S && S.step > 1) { S.step--; if (S.step === 2) { S.kukuSkip = false; } renderPeriksa(); }
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
