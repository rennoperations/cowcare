/* CowCare on-device inference engine.
 * MobileNetV2 (BN folded, float16 weights) implemented in plain JavaScript,
 * so the model runs fully offline in the browser without any server or WASM runtime.
 * Tensor layout: HWC (height, width, channel), Float32Array.
 */
(function (root) {
  "use strict";

  function f16ToF32(u16) {
    var out = new Float32Array(u16.length);
    for (var i = 0; i < u16.length; i++) {
      var h = u16[i];
      var s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff, v;
      if (e === 0) v = f * 5.960464477539063e-8;            // subnormal: f * 2^-24
      else if (e === 31) v = f ? NaN : Infinity;
      else v = (1 + f / 1024) * Math.pow(2, e - 15);
      out[i] = s ? -v : v;
    }
    return out;
  }

  function Model(meta, buffer) {
    this.meta = meta;
    var all = f16ToF32(new Uint16Array(buffer));
    function bind(l) {
      var c = Object.assign({}, l);
      c.W = all.subarray(l.w[0], l.w[0] + l.w[1]);
      c.B = all.subarray(l.b[0], l.b[0] + l.b[1]);
      return c;
    }
    this.layers = meta.layers.map(function (l) {
      if (l.type === "block") return { type: "block", res: l.res, layers: l.layers.map(bind) };
      return bind(l);
    });
  }

  // 3x3 full conv, pad 1 (first layer, cin = 3)
  function convFull(x, H, W, cin, L) {
    var s = L.s, cout = L.cout, Ho = Math.floor((H - 1) / s) + 1, Wo = Math.floor((W - 1) / s) + 1;
    var out = new Float32Array(Ho * Wo * cout), Wt = L.W, B = L.B;
    for (var oy = 0; oy < Ho; oy++) for (var ox = 0; ox < Wo; ox++) {
      var o = (oy * Wo + ox) * cout;
      for (var co = 0; co < cout; co++) out[o + co] = B[co];
      for (var ky = 0; ky < 3; ky++) {
        var iy = oy * s + ky - 1; if (iy < 0 || iy >= H) continue;
        for (var kx = 0; kx < 3; kx++) {
          var ix = ox * s + kx - 1; if (ix < 0 || ix >= W) continue;
          var ib = (iy * W + ix) * cin, wb = (ky * 3 + kx) * cin * cout;
          for (var ci = 0; ci < cin; ci++) {
            var v = x[ib + ci], wr = wb + ci * cout;
            for (var co2 = 0; co2 < cout; co2++) out[o + co2] += v * Wt[wr + co2];
          }
        }
      }
      if (L.relu) for (var k = 0; k < cout; k++) { var t = out[o + k]; out[o + k] = t < 0 ? 0 : (t > 6 ? 6 : t); }
    }
    return { x: out, H: Ho, W: Wo, C: cout };
  }

  // depthwise 3x3, pad 1
  function convDW(x, H, W, C, L) {
    var s = L.s, Ho = Math.floor((H - 1) / s) + 1, Wo = Math.floor((W - 1) / s) + 1;
    var out = new Float32Array(Ho * Wo * C), Wt = L.W, B = L.B;
    for (var oy = 0; oy < Ho; oy++) for (var ox = 0; ox < Wo; ox++) {
      var o = (oy * Wo + ox) * C;
      for (var c = 0; c < C; c++) out[o + c] = B[c];
      for (var ky = 0; ky < 3; ky++) {
        var iy = oy * s + ky - 1; if (iy < 0 || iy >= H) continue;
        for (var kx = 0; kx < 3; kx++) {
          var ix = ox * s + kx - 1; if (ix < 0 || ix >= W) continue;
          var ib = (iy * W + ix) * C, wb = (ky * 3 + kx) * C;
          for (var c2 = 0; c2 < C; c2++) out[o + c2] += x[ib + c2] * Wt[wb + c2];
        }
      }
      if (L.relu) for (var k = 0; k < C; k++) { var t = out[o + k]; out[o + k] = t < 0 ? 0 : (t > 6 ? 6 : t); }
    }
    return { x: out, H: Ho, W: Wo, C: C };
  }

  // pointwise 1x1: [P x cin] * [cin x cout]; skips zero activations (ReLU sparsity)
  function convPW(x, H, W, cin, L) {
    var cout = L.cout, P = H * W, out = new Float32Array(P * cout), Wt = L.W, B = L.B;
    for (var p = 0; p < P; p++) {
      var o = p * cout, ib = p * cin;
      for (var co = 0; co < cout; co++) out[o + co] = B[co];
      for (var ci = 0; ci < cin; ci++) {
        var v = x[ib + ci];
        if (v === 0) continue;
        var wr = ci * cout;
        for (var co2 = 0; co2 < cout; co2++) out[o + co2] += v * Wt[wr + co2];
      }
      if (L.relu) for (var k = 0; k < cout; k++) { var t = out[o + k]; out[o + k] = t < 0 ? 0 : (t > 6 ? 6 : t); }
    }
    return { x: out, H: H, W: W, C: cout };
  }

  function runLayer(L, t) {
    if (L.type === "conv") return convFull(t.x, t.H, t.W, t.C, L);
    if (L.type === "dw") return convDW(t.x, t.H, t.W, t.C, L);
    if (L.type === "pw") return convPW(t.x, t.H, t.W, t.C, L);
    throw new Error("layer " + L.type);
  }

  Model.prototype.logits = function (input) {
    var t = { x: input, H: 224, W: 224, C: 3 };
    for (var i = 0; i < this.layers.length; i++) {
      var L = this.layers[i];
      if (L.type === "block") {
        var inp = t;
        for (var j = 0; j < L.layers.length; j++) t = runLayer(L.layers[j], t);
        if (L.res) { var a = t.x, b = inp.x; for (var k = 0; k < a.length; k++) a[k] += b[k]; }
      } else if (L.type === "fc") {
        var P = t.H * t.W, C = t.C, g = new Float32Array(C);
        for (var p = 0; p < P; p++) for (var c = 0; c < C; c++) g[c] += t.x[p * C + c];
        for (var c2 = 0; c2 < C; c2++) g[c2] /= P;
        var out = new Float32Array(L.cout);
        for (var co = 0; co < L.cout; co++) out[co] = L.B[co];
        for (var ci = 0; ci < C; ci++) for (var co3 = 0; co3 < L.cout; co3++) out[co3] += g[ci] * L.W[ci * L.cout + co3];
        return out;
      } else t = runLayer(L, t);
    }
  };

  // rgba: Uint8ClampedArray 224*224*4 (already resized + center cropped)
  Model.prototype.preprocess = function (rgba) {
    var m = this.meta.mean, s = this.meta.std, n = 224 * 224, x = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      x[i * 3] = (rgba[i * 4] / 255 - m[0]) / s[0];
      x[i * 3 + 1] = (rgba[i * 4 + 1] / 255 - m[1]) / s[1];
      x[i * 3 + 2] = (rgba[i * 4 + 2] / 255 - m[2]) / s[2];
    }
    return x;
  };

  // Simple photo-quality metrics: mean brightness and variance of Laplacian (sharpness)
  function quality(rgba) {
    var N = 224, g = new Float32Array(N * N), sum = 0;
    for (var i = 0; i < N * N; i++) {
      g[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
      sum += g[i];
    }
    var mean = sum / (N * N), ls = 0, ls2 = 0, cnt = 0;
    for (var y = 1; y < N - 1; y++) for (var x = 1; x < N - 1; x++) {
      var k = y * N + x, l = g[k - N] + g[k + N] + g[k - 1] + g[k + 1] - 4 * g[k];
      ls += l; ls2 += l * l; cnt++;
    }
    var lm = ls / cnt;
    return { brightness: mean, sharpness: ls2 / cnt - lm * lm };
  }

  Model.prototype.predict = function (rgba) {
    var t0 = (typeof performance !== "undefined" ? performance : Date).now();
    var lg = this.logits(this.preprocess(rgba));
    var mx = -Infinity, i;
    for (i = 0; i < lg.length; i++) mx = Math.max(mx, lg[i]);
    var e = [], z = 0;
    for (i = 0; i < lg.length; i++) { e.push(Math.exp(lg[i] - mx)); z += e[i]; }
    var probs = {}, cls = this.meta.classes;
    for (i = 0; i < cls.length; i++) probs[cls[i]] = e[i] / z;
    var t1 = (typeof performance !== "undefined" ? performance : Date).now();
    return { probs: probs, logits: Array.from(lg), latency_ms: Math.round(t1 - t0), quality: quality(rgba),
             model_version: this.meta.version };
  };

  var api = { Model: Model, f16ToF32: f16ToF32, quality: quality };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CowEngine = api;
})(typeof self !== "undefined" ? self : this);
