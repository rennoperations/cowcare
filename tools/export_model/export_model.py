"""Export torchvision MobileNetV2 state_dict -> BN-folded float16 binary + JSON manifest
for the CowCare in-browser engine, plus a numpy reference forward pass."""
import json, sys, os
import numpy as np
from load_pt import load_state_dict

EPS = 1e-5
CFG = [(1, 16, 1, 1), (6, 24, 2, 2), (6, 32, 3, 2), (6, 64, 4, 2),
       (6, 96, 3, 1), (6, 160, 3, 2), (6, 320, 1, 1)]
CLASSES = ["kuku_sakit", "kuku_sehat", "mulut_sakit", "mulut_sehat"]


def fold(sd, conv, bn):
    w = sd[conv + ".weight"].astype(np.float64)
    g, b = sd[bn + ".weight"], sd[bn + ".bias"]
    m, v = sd[bn + ".running_mean"], sd[bn + ".running_var"]
    scale = g / np.sqrt(v + EPS)
    w = w * scale[:, None, None, None]
    bias = b - m * scale
    return w.astype(np.float32), bias.astype(np.float32)


def build_layers(sd):
    """Returns list of layer dicts with numpy weights."""
    L = []
    w, b = fold(sd, "features.0.0", "features.0.1")
    L.append(dict(type="conv", k=3, s=2, cin=3, cout=32, relu=True, w=w, b=b))
    idx, cin = 1, 32
    for t, c, n, s in CFG:
        for i in range(n):
            stride = s if i == 0 else 1
            hid = cin * t
            res = stride == 1 and cin == c
            p = f"features.{idx}.conv"
            blk = []
            if t != 1:
                w, b = fold(sd, f"{p}.0.0", f"{p}.0.1")
                blk.append(dict(type="pw", cin=cin, cout=hid, relu=True, w=w, b=b))
                w, b = fold(sd, f"{p}.1.0", f"{p}.1.1")
                blk.append(dict(type="dw", k=3, s=stride, c=hid, relu=True, w=w, b=b))
                w, b = fold(sd, f"{p}.2", f"{p}.3")
                blk.append(dict(type="pw", cin=hid, cout=c, relu=False, w=w, b=b))
            else:
                w, b = fold(sd, f"{p}.0.0", f"{p}.0.1")
                blk.append(dict(type="dw", k=3, s=stride, c=hid, relu=True, w=w, b=b))
                w, b = fold(sd, f"{p}.1", f"{p}.2")
                blk.append(dict(type="pw", cin=hid, cout=c, relu=False, w=w, b=b))
            L.append(dict(type="block", res=res, layers=blk))
            cin = c
            idx += 1
    w, b = fold(sd, "features.18.0", "features.18.1")
    L.append(dict(type="pw", cin=320, cout=1280, relu=True, w=w, b=b))
    L.append(dict(type="fc", cin=1280, cout=4,
                  w=sd["classifier.1.weight"].astype(np.float32),
                  b=sd["classifier.1.bias"].astype(np.float32)))
    return L


# ---------------- numpy reference (HWC) ----------------
def conv_full(x, w, b, s):  # x HWC, w [O,I,3,3]
    H, W, C = x.shape
    xp = np.pad(x, ((1, 1), (1, 1), (0, 0)))
    Ho, Wo = (H + 2 - 3) // s + 1, (W + 2 - 3) // s + 1
    out = np.zeros((Ho, Wo, w.shape[0]), np.float32)
    for ky in range(3):
        for kx in range(3):
            patch = xp[ky:ky + s * Ho:s, kx:kx + s * Wo:s, :]
            out += patch @ w[:, :, ky, kx].T
    return out + b


def conv_dw(x, w, b, s):  # w [C,1,3,3]
    H, W, C = x.shape
    xp = np.pad(x, ((1, 1), (1, 1), (0, 0)))
    Ho, Wo = (H + 2 - 3) // s + 1, (W + 2 - 3) // s + 1
    out = np.zeros((Ho, Wo, C), np.float32)
    for ky in range(3):
        for kx in range(3):
            out += xp[ky:ky + s * Ho:s, kx:kx + s * Wo:s, :] * w[:, 0, ky, kx]
    return out + b


def relu6(x):
    return np.clip(x, 0, 6)


def run_layer(l, x):
    t = l["type"]
    if t == "conv":
        y = conv_full(x, l["w"], l["b"], l["s"])
    elif t == "dw":
        y = conv_dw(x, l["w"], l["b"], l["s"])
    elif t == "pw":
        y = x @ l["w"][:, :, 0, 0].T + l["b"]
    if l.get("relu"):
        y = relu6(y)
    return y


def forward(L, x):
    for l in L:
        if l["type"] == "block":
            inp = x
            for sl in l["layers"]:
                x = run_layer(sl, x)
            if l["res"]:
                x = x + inp
        elif l["type"] == "fc":
            v = x.mean(axis=(0, 1))
            return v @ l["w"].T + l["b"]
        else:
            x = run_layer(l, x)


def preprocess(path):
    from PIL import Image
    im = Image.open(path).convert("RGB")
    w, h = im.size
    sc = 256 / min(w, h)
    im = im.resize((round(w * sc), round(h * sc)), Image.BILINEAR)
    w, h = im.size
    l, t = (w - 224) // 2, (h - 224) // 2
    im = im.crop((l, t, l + 224, t + 224))
    a = np.asarray(im, np.float32) / 255.0
    a = (a - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    return a.astype(np.float32)


# ---------------- export ----------------
def export(L, outdir, dtype="f16"):
    chunks, manifest, off = [], [], 0

    def add(arr):
        nonlocal off
        a = np.ascontiguousarray(arr.astype(np.float16))
        chunks.append(a.tobytes())
        o = off
        off += a.size
        return o, int(a.size)

    def emit(l):
        t = l["type"]
        d = {k: v for k, v in l.items() if k not in ("w", "b", "layers")}
        if t == "conv":
            w = l["w"].transpose(2, 3, 1, 0)        # [ky,kx,ci,co]
        elif t == "dw":
            w = l["w"][:, 0].transpose(1, 2, 0)     # [ky,kx,c]
        elif t == "pw":
            w = l["w"][:, :, 0, 0].T                # [ci,co]
        elif t == "fc":
            w = l["w"].T                            # [ci,co]
        d["w"] = add(w)
        d["b"] = add(l["b"])
        return d

    for l in L:
        if l["type"] == "block":
            manifest.append(dict(type="block", res=l["res"], layers=[emit(s) for s in l["layers"]]))
        else:
            manifest.append(emit(l))
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, "weights.bin"), "wb") as f:
        for c in chunks:
            f.write(c)
    meta = dict(name="cowcare-mobilenetv2-fmd4", version="0.4.0-poc", classes=CLASSES,
                input=[224, 224, 3], mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225],
                dtype="float16", n_values=off, layers=manifest)
    with open(os.path.join(outdir, "model.json"), "w") as f:
        json.dump(meta, f)
    return off


def quantize_f16(L):
    import copy
    Q = copy.deepcopy(L)

    def q(l):
        if "w" in l:
            l["w"] = l["w"].astype(np.float16).astype(np.float32)
            l["b"] = l["b"].astype(np.float16).astype(np.float32)
        for s in l.get("layers", []):
            q(s)
    for l in Q:
        q(l)
    return Q


if __name__ == "__main__":
    sd = load_state_dict(sys.argv[1])
    L = build_layers(sd)
    n = export(L, sys.argv[2])
    print("exported values:", n, "bytes:", n * 2)
