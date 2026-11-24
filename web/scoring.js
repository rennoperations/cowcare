/* CowCare scoring (desain revisi 3 faktor terbesar, 18 Nov 2026).
 * Bobot AHP berbasis literatur (CR = 0): S = 0,571 x S_lepuh + 0,286 x S_liur + 0,143 x S_jarak (persen)
 * S_lepuh = MAX(lepuh mulut, lepuh kuku)
 * Jarak Dekat = <= 10 km dari kasus aktif (radius populasi terancam, KIAT VETINDO PMK 2022).
 * Jarak Jauh hanya membuat S_jarak = 0; lepuh dan air liur tetap dihitung.
 * H = 95 - 0,45 x S, rentang 50-95 %
 * Status: Merah bila S >= 60 %. Batas Kuning (S >= 30 %) bersifat sementara,
 * menunggu validasi bersama dokter hewan.
 */
(function (root) {
  "use strict";
  var W = { lepuh: 0.571, liur: 0.286, jarak: 0.143 };
  // Intensitas tiap derajat dinormalisasi 0-1 (skala linear; asumsi kerja, perlu validasi dokter hewan)
  var INT_LIUR = [0, 0.25, 0.5, 0.75, 1];
  var INT_LEPUH = [0, 1 / 3, 2 / 3, 1];
  var MERAH = 60, KUNING = 30;

  function hitung(inp) {
    // inp: {liur:0-4, lepuhMulut:0-3, lepuhKuku:0-3|null, jarak:'jauh'|'dekat'|'tidak_tahu'}
    var lepuh = Math.max(inp.lepuhMulut || 0, inp.lepuhKuku || 0);
    var jarakDekat = inp.jarak !== "jauh"; // "tidak tahu" dihitung Dekat (prinsip kehati-hatian)
    var gejalaTerlihat = (inp.liur || 0) >= 2 || lepuh >= 1;
    var r = {
      intensitas: { liur: INT_LIUR[inp.liur || 0], lepuh: INT_LEPUH[lepuh], jarak: jarakDekat ? 1 : 0 },
      lepuhDerajat: lepuh, aturanMutlak: false, jarakJauh: !jarakDekat, gejalaTerlihat: gejalaTerlihat
    };
    r.kontribusi = {
      liur: 100 * W.liur * r.intensitas.liur,
      lepuh: 100 * W.lepuh * r.intensitas.lepuh,
      jarak: 100 * W.jarak * r.intensitas.jarak
    };
    r.S = r.kontribusi.liur + r.kontribusi.lepuh + r.kontribusi.jarak;
    r.H = Math.max(50, Math.min(95, 95 - 0.45 * r.S));
    r.S = Math.round(r.S * 10) / 10;
    r.H = Math.round(r.H * 10) / 10;
    r.status = r.S >= MERAH ? "merah" : (r.S >= KUNING ? "kuning" : "hijau");
    r.peringatanGejala = r.jarakJauh && gejalaTerlihat && r.status === "hijau";
    r.rujuk = r.status !== "hijau" || r.peringatanGejala || lepuh >= 1;
    return r;
  }

  // K-means sederhana (deterministik) untuk kelompok risiko kandang dari riwayat [S/100, jarakDekat]
  function kmeans(points, k, iters) {
    iters = iters || 50;
    if (points.length < k) k = points.length;
    var sorted = points.slice().sort(function (a, b) { return a[0] - b[0]; });
    var C = [];
    for (var i = 0; i < k; i++) C.push(sorted[Math.floor((i + 0.5) * sorted.length / k)].slice());
    var assign = new Array(points.length).fill(0);
    for (var it = 0; it < iters; it++) {
      var changed = false;
      for (var p = 0; p < points.length; p++) {
        var best = 0, bd = Infinity;
        for (var c = 0; c < k; c++) {
          var d = 0; for (var j = 0; j < points[p].length; j++) d += Math.pow(points[p][j] - C[c][j], 2);
          if (d < bd) { bd = d; best = c; }
        }
        if (assign[p] !== best) { assign[p] = best; changed = true; }
      }
      for (var c2 = 0; c2 < k; c2++) {
        var mem = points.filter(function (_, idx) { return assign[idx] === c2; });
        if (!mem.length) continue;
        for (var j2 = 0; j2 < C[c2].length; j2++) C[c2][j2] = mem.reduce(function (s, m) { return s + m[j2]; }, 0) / mem.length;
      }
      if (!changed && it > 0) break;
    }
    return { centroids: C, assign: assign };
  }

  function labelKelompok(sPersen) {
    return sPersen >= MERAH ? "Suspek Tinggi" : (sPersen >= KUNING ? "Waspada" : "Aman");
  }

  var api = { hitung: hitung, kmeans: kmeans, labelKelompok: labelKelompok, BOBOT: W,
              INT_LIUR: INT_LIUR, INT_LEPUH: INT_LEPUH, MERAH: MERAH, KUNING: KUNING };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CowScore = api;
})(typeof self !== "undefined" ? self : this);
