/* Web Worker: loads the model once and runs predictions off the UI thread. */
importScripts("engine.js");
var model = null;

function load() {
  return Promise.all([
    fetch("model/model.json").then(function (r) { if (!r.ok) throw new Error("model.json " + r.status); return r.json(); }),
    fetch("model/weights.bin").then(function (r) { if (!r.ok) throw new Error("weights.bin " + r.status); return r.arrayBuffer(); })
  ]).then(function (res) {
    model = new self.CowEngine.Model(res[0], res[1]);
    self.postMessage({ type: "ready", version: res[0].version });
  }).catch(function (e) {
    self.postMessage({ type: "error", message: String(e && e.message || e) });
  });
}

self.onmessage = function (ev) {
  var d = ev.data;
  if (d.type === "predict") {
    if (!model) { self.postMessage({ type: "result", id: d.id, error: "model belum siap" }); return; }
    try {
      var r = model.predict(new Uint8ClampedArray(d.rgba));
      self.postMessage({ type: "result", id: d.id, result: r });
    } catch (e) {
      self.postMessage({ type: "result", id: d.id, error: String(e && e.message || e) });
    }
  }
};
load();
