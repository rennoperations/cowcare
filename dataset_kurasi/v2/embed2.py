"""Embedding + pHash untuk semua sumber: Roboflow FMD, Roboflow cow-hooves, Zenodo FMD Cattle (Osborn).
Kelas kotak: 0 kuku_sakit, 1 kuku_sehat, 2 mulut_sakit, 3 mulut_sehat, 4 bukan_target, -1 abaikan (hanya dihindari crop latar)."""
import os, glob, json, re, numpy as np, torch, torchvision as tv, imagehash
from PIL import Image
m = tv.models.mobilenet_v2(weights='IMAGENET1K_V1').eval(); m.classifier = torch.nn.Identity()
T = tv.transforms.Compose([tv.transforms.Resize((224, 224)), tv.transforms.ToTensor(), tv.transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
def yolo(f, remap):
    lp = f.replace('/images/', '/labels/').rsplit('.', 1)[0] + '.txt'
    L = [l.split() for l in open(lp) if l.strip()] if os.path.exists(lp) else []
    return [[remap[int(l[0])]] + [float(x) for x in l[1:5]] for l in L if len(l) == 5]
items = []
for f in sorted(x.replace(os.sep, '/') for x in glob.glob('raw/*/images/*')):  # FMD Roboflow: urutan kelas sama dengan names
    items.append(dict(path=f, source='roboflow_fmd', split=f.split('/')[1], stem=os.path.basename(f).rsplit('.rf.', 1)[0], boxes=yolo(f, {0: 0, 1: 1, 2: 2, 3: 3})))
for f in sorted(x.replace(os.sep, '/') for x in glob.glob('ext/hooves/*/images/*')):  # bad-hooves bukan label PMK -> abaikan; good/normal -> kuku_sehat
    items.append(dict(path=f, source='roboflow_hooves', split=f.split('/')[2], stem='hv_' + os.path.basename(f).rsplit('.rf.', 1)[0], boxes=yolo(f, {0: -1, 1: 1, 2: 1})))
FOOT = re.compile(r'foot|heel|hoof|interdig|coronet|claw', re.I)
for f in sorted(x.replace(os.sep, '/') for x in glob.glob('ext/FMD_Cattle/FMD_Cattle/[01]/*')):
    n = os.path.basename(f); sick = '/1/' in f
    if re.search(r'udder|teat', n, re.I): c = None if sick else 4
    elif re.search(r'drool', n, re.I): c = None  # foto seluruh tubuh, bukan close-up mulut
    elif FOOT.search(n): c = 0 if sick else 1
    else: c = 2 if sick else 3
    if c is None: continue
    items.append(dict(path=f, source='zenodo_osborn', split='-', stem='os_' + re.sub(r'(\s*copy)?\.\w+~?$', '', n), boxes=[[c, .5, .5, 1., 1.]], whole=True))
rows, X = [], []
with torch.no_grad():
    buf = []
    for r in items:
        try: im = Image.open(r['path']).convert('RGB')
        except Exception: continue
        r['phash'] = str(imagehash.phash(im, hash_size=16)); rows.append(r); buf.append(T(im))
        if len(buf) == 64: X.append(torch.nn.functional.normalize(m(torch.stack(buf)), dim=1).numpy()); buf = []
    if buf: X.append(torch.nn.functional.normalize(m(torch.stack(buf)), dim=1).numpy())
np.save('emb2.npy', np.concatenate(X)); json.dump(rows, open('rows2.json', 'w'))
import collections; print(len(rows), collections.Counter(r['source'] for r in rows))
