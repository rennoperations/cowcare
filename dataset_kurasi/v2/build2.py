"""Dataset gabungan: crop per kotak + split train/val/test per kelompok (sapi/rekaman/foto mirip) tanpa kebocoran."""
import json, random, collections, os, csv, numpy as np
from PIL import Image
from sklearn.cluster import AgglomerativeClustering
names = ['kuku_sakit', 'kuku_sehat', 'mulut_sakit', 'mulut_sehat', 'bukan_target']
OUT = os.environ.get('OUT', 'ds2'); random.seed(13)
rows = json.load(open('rows2.json')); X = np.load('emb2.npy'); N = len(rows)
par = list(range(N))
def f(i):
    while par[i] != i: par[i] = par[par[i]]; i = par[i]
    return i
def u(a, b): par[f(a)] = f(b)
# 1) klaster embedding: frame video / foto sapi yang sama
cl = AgglomerativeClustering(n_clusters=None, distance_threshold=0.15, metric='cosine', linkage='average').fit_predict(X)
first = {}
for i, c in enumerate(cl):
    if c in first: u(i, first[c])
    else: first[c] = i
# 2) near-duplicate pHash (termasuk salinan hasil augmentasi/rotasi kecil) lintas sumber
B = np.array([[int(ch, 16) >> k & 1 for ch in r['phash'] for k in (3, 2, 1, 0)] for r in rows], dtype=np.uint8)
for i in range(0, N, 512):
    D = (B[i:i+512, None, :] != B[None, :, :]).sum(2)
    for a, b in zip(*np.nonzero(D <= 20)):
        if i + a < b: u(i + a, b)
# 3) stem sumber yang sama (Roboflow menyalin 1 foto menjadi beberapa versi augmentasi)
st = {}
for i, r in enumerate(rows):
    if r['stem'] in st: u(i, st[r['stem']])
    else: st[r['stem']] = i
# 4) sesi rekaman cow-hooves: frame dari video yang sama atau VideoCapture berselang <=120 dtk = satu sesi
import re, datetime
caps = []
for i, r in enumerate(rows):
    n = os.path.basename(r['path'])
    v = re.match(r'(\d{8}_\d{6}_mp4)-', n)
    if v: caps.append((v.group(1), i)); continue
    t = re.match(r'VideoCapture_(\d{8}-\d{6})', n)
    if t: caps.append((datetime.datetime.strptime(t.group(1), '%Y%m%d-%H%M%S'), i))
vid = {}
for k, i in caps:
    if isinstance(k, str):
        if k in vid: u(i, vid[k])
        else: vid[k] = i
ts = sorted((k, i) for k, i in caps if not isinstance(k, str))
for (t0, a), (t1, b) in zip(ts, ts[1:]):
    if (t1 - t0).total_seconds() <= 120: u(a, b)
gid = {}
for i in range(N): rows[i]['group'] = gid.setdefault(f(i), len(gid))
groups = collections.defaultdict(list)
for i, r in enumerate(rows): groups[r['group']].append(i)
def glabel(g):
    c = collections.Counter(b[0] for i in groups[g] for b in rows[i]['boxes'] if b[0] >= 0)
    return names[c.most_common(1)[0][0]] if c else 'kosong'
CAP_TRAIN, CAP_EVAL = 30, 8
split = {}
for c in names + ['kosong']:
    gs = [g for g in groups if glabel(g) == c]; random.shuffle(gs); gs.sort(key=lambda g: -len(groups[g]))
    if len(gs) < 8:
        for k, g in enumerate(gs): split[g] = ['train', 'test', 'val'][k] if k < 3 else 'train'
        continue
    tot = sum(min(len(groups[g]), CAP_EVAL) for g in gs); acc = {'train': 0, 'val': 0, 'test': 0}
    target = {'train': .70, 'val': .15, 'test': .15}
    for g in gs:
        s = min(target, key=lambda k: acc[k] / tot - target[k]); split[g] = s; acc[s] += min(len(groups[g]), CAP_EVAL)
keep = set()
for g, idx in groups.items():
    random.shuffle(idx); keep.update(idx[:CAP_TRAIN if split[g] == 'train' else CAP_EVAL])
def crop(im, cx, cy, w, h, ctx):
    W, Hh = im.size; s = max(max(w*W, h*Hh) * ctx, 40)
    x0 = min(max(cx*W - s/2, 0), max(W - s, 0)); y0 = min(max(cy*Hh - s/2, 0), max(Hh - s, 0))
    return im.crop((int(x0), int(y0), int(x0 + min(s, W)), int(y0 + min(s, Hh))))
def overlap(a, b):
    return max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
out = []
def add(fn, r, c, area):
    out.append(dict(file=fn, src=os.path.basename(r['path']), source=r['source'], kelas=c, split=split[r['group']], group=r['group'], box_area=area))
for i in sorted(keep):
    r = rows[i]; im = Image.open(r['path']).convert('RGB'); W, Hh = im.size; sp = split[r['group']]; boxes = []
    for k, (c, cx, cy, w, h) in enumerate(r['boxes']):
        boxes.append(((cx-w/2)*W, (cy-h/2)*Hh, (cx+w/2)*W, (cy+h/2)*Hh))
        if c < 0: continue
        cr = im if r.get('whole') else crop(im, cx, cy, w, h, random.uniform(1.3, 2.0))
        d = f'{OUT}/{sp}/{names[c]}'; os.makedirs(d, exist_ok=True); fn = f'{d}/{i:05d}_{k}.jpg'
        cr.resize((224, 224), Image.BICUBIC).save(fn, quality=92); add(fn, r, names[c], round(w*h, 4))
    if r.get('whole'): continue
    for _ in range(20):  # satu crop latar tanpa kotak apa pun -> bukan_target
        s = random.uniform(0.25, 0.5) * min(W, Hh); x0 = random.uniform(0, W - s); y0 = random.uniform(0, Hh - s); bb = (x0, y0, x0 + s, y0 + s)
        if all(overlap(bb, b) < min(0.05 * s * s, 0.1 * (b[2] - b[0]) * (b[3] - b[1])) for b in boxes):
            d = f'{OUT}/{sp}/bukan_target'; os.makedirs(d, exist_ok=True); fn = f'{d}/{i:05d}_bg.jpg'
            im.crop(tuple(int(v) for v in bb)).resize((224, 224), Image.BICUBIC).save(fn, quality=92); add(fn, r, 'bukan_target', ''); break
with open(f'{OUT}/split_manifest.csv', 'w', newline='') as fo:
    wr = csv.DictWriter(fo, fieldnames=list(out[0])); wr.writeheader(); wr.writerows(out)
cnt = collections.Counter((o['split'], o['kelas']) for o in out)
gc = collections.Counter((o['split'], o['kelas']) for o in {(o['group'], o['kelas']): o for o in out}.values())
print('images', N, 'groups', len(groups), 'kept', len(keep))
print('(crop, kelompok)')
for c in names: print(f'{c:13s}', {s: (cnt[(s, c)], gc[(s, c)]) for s in ['train', 'val', 'test']})
leak = {o['group'] for o in out if o['split'] == 'train'} & {o['group'] for o in out if o['split'] != 'train'}; print('kelompok bocor', len(leak))
