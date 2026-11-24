"""Bangun dataset crop + split berbasis kelompok dari ekspor Roboflow YOLOv8."""
import json, random, collections, os, csv, numpy as np, imagehash
from PIL import Image
from sklearn.cluster import AgglomerativeClustering
names = ['kuku_sakit','kuku_sehat','mulut_sakit','mulut_sehat']
random.seed(13)
rows = json.load(open('rows.json')); X = np.load('emb.npy'); N = len(rows)
# kelompok = klaster embedding (frame video / foto mirip) digabung dengan near-duplicate pHash
cl = AgglomerativeClustering(n_clusters=None, distance_threshold=0.15, metric='cosine', linkage='average').fit_predict(X)
par = list(range(N))
def f(i):
    while par[i] != i: par[i] = par[par[i]]; i = par[i]
    return i
def u(a, b): par[f(a)] = f(b)
byc = collections.defaultdict(list)
for i, c in enumerate(cl): byc[c].append(i)
for v in byc.values():
    for j in v[1:]: u(v[0], j)
H = [imagehash.hex_to_hash(r['phash']) for r in rows]
for i in range(N):
    for j in range(i+1, N):
        if H[i] - H[j] <= 20: u(i, j)
stem = {}
for i, r in enumerate(rows):
    if r['stem'] in stem: u(i, stem[r['stem']])
    stem[r['stem']] = i
gid = {}
for i in range(N): rows[i]['group'] = gid.setdefault(f(i), len(gid))
# label gambar = kelas kotak terbanyak; gambar campur/kosong dipakai hanya untuk crop per kotak
CAP_TRAIN, CAP_EVAL = 30, 8  # batas gambar per kelompok agar frame video tidak mendominasi
groups = collections.defaultdict(list)
for i, r in enumerate(rows): groups[r['group']].append(i)
# split per kelompok, dikelompokkan menurut kelas dominan lalu dibagi 70/15/15 berdasarkan jumlah gambar
def glabel(g):
    c = collections.Counter(b[0] for i in groups[g] for b in rows[i]['boxes'])
    return names[c.most_common(1)[0][0]] if c else 'kosong'
split = {}
for c in names + ['kosong']:
    gs = [g for g in groups if glabel(g) == c]; random.shuffle(gs)
    gs.sort(key=lambda g: -len(groups[g]))
    if len(gs) < 8:
        # kelas dengan sedikit kelompok: terbesar ke train, berikutnya bergantian test/val agar tetap bisa diuji
        for k, g in enumerate(gs): split[g] = ['train', 'test', 'val'][k] if k < 3 else 'train'
        continue
    tot = sum(min(len(groups[g]), CAP_EVAL) for g in gs); acc = {'train': 0, 'val': 0, 'test': 0}
    target = {'train': .70, 'val': .15, 'test': .15}
    for g in gs:
        n = min(len(groups[g]), CAP_EVAL)
        s = min(target, key=lambda k: acc[k] / tot - target[k])
        split[g] = s; acc[s] += n
keep = set()
for g, idx in groups.items():
    random.shuffle(idx); keep.update(idx[:CAP_TRAIN if split[g] == 'train' else CAP_EVAL])
os.makedirs('ds', exist_ok=True)
out = []
def crop(im, cx, cy, w, h, ctx):
    W, Hh = im.size; s = max(w*W, h*Hh) * ctx; s = max(s, 40)
    x0, y0 = cx*W - s/2, cy*Hh - s/2
    x0 = min(max(x0, 0), max(W - s, 0)); y0 = min(max(y0, 0), max(Hh - s, 0))
    return im.crop((int(x0), int(y0), int(x0 + min(s, W)), int(y0 + min(s, Hh))))
def overlap(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1])); return ix*iy
for i in sorted(keep):
    r = rows[i]; im = Image.open(r['path']).convert('RGB'); W, Hh = im.size; sp = split[r['group']]
    boxes = []
    for k, (c, cx, cy, w, h) in enumerate(r['boxes']):
        ctx = random.uniform(1.3, 2.0)
        cr = crop(im, cx, cy, w, h, ctx).resize((224, 224), Image.BICUBIC)
        d = f'ds/{sp}/{names[c]}'; os.makedirs(d, exist_ok=True)
        fn = f'{d}/{i:04d}_{k}.jpg'; cr.save(fn, quality=92)
        out.append(dict(file=fn, src=os.path.basename(r['path']), kelas=names[c], split=sp, group=r['group'], roboflow_split=r['split'], box_area=round(w*h, 4)))
        boxes.append(((cx-w/2)*W, (cy-h/2)*Hh, (cx+w/2)*W, (cy+h/2)*Hh))
    # satu crop latar (tanpa bagian kotak) per gambar sebagai kelas bukan_target
    for _ in range(20):
        s = random.uniform(0.25, 0.5) * min(W, Hh); x0 = random.uniform(0, W - s); y0 = random.uniform(0, Hh - s)
        bb = (x0, y0, x0 + s, y0 + s)
        if all(overlap(bb, b) < 0.05 * s * s for b in boxes):
            d = f'ds/{sp}/bukan_target'; os.makedirs(d, exist_ok=True); fn = f'{d}/{i:04d}_bg.jpg'
            im.crop(tuple(int(v) for v in bb)).resize((224, 224), Image.BICUBIC).save(fn, quality=92)
            out.append(dict(file=fn, src=os.path.basename(r['path']), kelas='bukan_target', split=sp, group=r['group'], roboflow_split=r['split'], box_area=''))
            break
with open('ds/split_manifest.csv', 'w', newline='') as fo:
    wr = csv.DictWriter(fo, fieldnames=list(out[0])); wr.writeheader(); wr.writerows(out)
cnt = collections.Counter((o['split'], o['kelas']) for o in out)
gcnt = collections.Counter((o['split'], o['kelas']) for o in {(o['group'], o['kelas'], o['split']): o for o in out}.values())
print('groups', len(groups), 'kept images', len(keep), 'of', N)
for c in names + ['bukan_target']:
    print(f"{c:13s}", {s: (cnt[(s, c)], gcnt[(s, c)]) for s in ['train', 'val', 'test']})
