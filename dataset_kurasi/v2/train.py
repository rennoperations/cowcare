"""Latih ulang MobileNetV2 (5 kelas) pada split berbasis kelompok, laporkan metrik test dan kalibrasi."""
import os, csv, json, random, time, collections, numpy as np, torch, torch.nn as nn, torchvision as tv
from PIL import Image, ImageFilter
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
torch.manual_seed(13); random.seed(13); np.random.seed(13); torch.set_num_threads(8)
MERGE = os.environ.get('MERGE') == '1'; UNF = int(os.environ.get('UNF', '5')); TAG = os.environ.get('TAG', 'v2')
# MERGE: area (mulut/kuku) sudah diketahui dari langkah aplikasi, jadi model cukup membedakan lesi / sehat / bukan target
NAMES = ['lesi', 'sehat', 'bukan_target'] if MERGE else ['kuku_sakit', 'kuku_sehat', 'mulut_sakit', 'mulut_sehat', 'bukan_target']
def kelas(r): return (r['kelas'].split('_')[1].replace('sakit', 'lesi') if r['kelas'] != 'bukan_target' else 'bukan_target') if MERGE else r['kelas']
DS = os.environ.get('DS', 'ds'); rows = list(csv.DictReader(open(f'{DS}/split_manifest.csv')))
S = {s: [r for r in rows if r['split'] == s] for s in ['train', 'val', 'test']}
MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]
class Degrade:
    # resolusi rendah & blur acak untuk semua kelas, agar ketajaman tidak jadi petunjuk kelas
    def __call__(self, im):
        if random.random() < 0.5:
            s = random.choice([48, 64, 96, 128]); im = im.resize((s, s), Image.BILINEAR).resize((224, 224), Image.BILINEAR)
        if random.random() < 0.2: im = im.filter(ImageFilter.GaussianBlur(random.uniform(0.5, 1.5)))
        return im
ttf = tv.transforms.Compose([Degrade(), tv.transforms.RandomResizedCrop(224, scale=(0.6, 1.0)), tv.transforms.RandomHorizontalFlip(),
    tv.transforms.RandomRotation(15), tv.transforms.ColorJitter(0.3, 0.3, 0.25, 0.04), tv.transforms.ToTensor(), tv.transforms.Normalize(MEAN, STD)])
etf = tv.transforms.Compose([tv.transforms.Resize((224, 224)), tv.transforms.ToTensor(), tv.transforms.Normalize(MEAN, STD)])
class D(Dataset):
    def __init__(s, r, tf): s.r, s.tf = r, tf
    def __len__(s): return len(s.r)
    def __getitem__(s, i): return s.tf(Image.open(s.r[i]['file']).convert('RGB')), NAMES.index(kelas(s.r[i]))
# worker paralel hanya dengan fork (Linux); spawn (Windows/macOS) menjalankan ulang skrip tanpa guard __main__
NW = 6 if torch.multiprocessing.get_start_method() == 'fork' else 0
cnt = collections.Counter(kelas(r) for r in S['train'])
w = [1.0 / cnt[kelas(r)] for r in S['train']]
dl_tr = DataLoader(D(S['train'], ttf), batch_size=32, sampler=WeightedRandomSampler(w, len(w), replacement=True), num_workers=NW)
dl = {s: DataLoader(D(S[s], etf), batch_size=64, num_workers=NW) for s in ['train', 'val', 'test']}
m = tv.models.mobilenet_v2(weights='IMAGENET1K_V1', dropout=0.4); m.classifier[1] = nn.Linear(1280, len(NAMES))
def logits(loader):
    m.eval(); L, Y = [], []
    with torch.no_grad():
        for x, y in loader: L.append(m(x)); Y.append(y)
    return torch.cat(L), torch.cat(Y)
def metrics(L, Y, T=1.0):
    P = torch.softmax(L / T, 1); pred = P.argmax(1); cm = np.zeros((len(NAMES), len(NAMES)), int)
    for a, b in zip(Y.tolist(), pred.tolist()): cm[a][b] += 1
    rec = {NAMES[i]: round(cm[i, i] / cm[i].sum(), 3) if cm[i].sum() else None for i in range(len(NAMES))}
    prec = {NAMES[i]: round(cm[i, i] / cm[:, i].sum(), 3) if cm[:, i].sum() else None for i in range(len(NAMES))}
    f1 = [2 * p * r / (p + r) if p and r else 0 for p, r in zip(prec.values(), rec.values()) if r is not None]
    conf = P.max(1).values; ece = 0
    for lo in np.linspace(0, 1, 11)[:-1]:
        k = (conf > lo) & (conf <= lo + .1)
        if k.any(): ece += k.float().mean() * abs((pred[k] == Y[k]).float().mean() - conf[k].mean())
    return dict(n=len(Y), accuracy=round((pred == Y).float().mean().item(), 3), macro_f1=round(float(np.mean(f1)), 3), recall=rec, precision=prec, ece=round(float(ece), 3), confusion=cm.tolist())
def run(params, epochs, lr):
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=1e-4); sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, epochs)
    global best
    for ep in range(epochs):
        m.train(); t = time.time(); tl = 0
        for mod in m.features:  # blok beku: statistik BatchNorm juga dibekukan
            if not any(p.requires_grad for p in mod.parameters()): mod.eval()
        for x, y in dl_tr:
            opt.zero_grad(); loss = nn.functional.cross_entropy(m(x), y, label_smoothing=0.05); loss.backward(); opt.step(); tl += loss.item()
        sch.step(); L, Y = logits(dl['val']); mv = metrics(L, Y); mt = metrics(*logits(dl['train']))
        hist.append(dict(ep=len(hist), train_err=round(1 - mt['accuracy'], 3), val_err=round(1 - mv['accuracy'], 3), train_f1=mt['macro_f1'], val_f1=mv['macro_f1']))
        print(hist[-1], f"{time.time()-t:.0f}s", flush=True)
        # model dipilih dari F1 validasi, dengan penalti bila selisih train-val melebar (overfit)
        score = mv['macro_f1'] - 0.5 * max(0, mt['macro_f1'] - mv['macro_f1'] - 0.10)
        if score >= best[0]: best = (score, {k: v.clone() for k, v in m.state_dict().items()}, len(hist) - 1)
best = (-1, None, -1); hist = []
for p in m.features.parameters(): p.requires_grad = False
run(m.classifier.parameters(), 4, 3e-3)
# data kecil: layer awal tetap beku, hanya 5 blok terakhir yang ikut dilatih
if UNF > 0:
    for p in m.features[-UNF:].parameters(): p.requires_grad = True
run([p for p in m.parameters() if p.requires_grad], 16, 3e-4)
m.load_state_dict(best[1])
Lr, Yr = logits(dl['train']); Lv, Yv = logits(dl['val']); Lt, Yt = logits(dl['test'])
# temperature scaling di val
T = torch.ones(1, requires_grad=True); o = torch.optim.LBFGS([T], lr=0.1, max_iter=100)
def cl(): o.zero_grad(); l = nn.functional.cross_entropy(Lv / T.clamp(min=0.05), Yv); l.backward(); return l
o.step(cl); T = float(T.clamp(min=0.05))
res = dict(classes=NAMES, split_counts={s: dict(collections.Counter(kelas(r) for r in S[s])) for s in S},
           split_groups={s: dict(collections.Counter(k for _, k in {(r['group'], kelas(r)) for r in S[s]})) for s in S},
           temperature=round(T, 3), best_epoch=best[2], history=hist, train=metrics(Lr, Yr, T), val=metrics(Lv, Yv, T), test=metrics(Lt, Yt, T), test_uncalibrated=metrics(Lt, Yt))
# input sintetis bukan sapi: warna polos & noise
syn = [Image.new('RGB', (224, 224), c) for c in ['black', 'white', 'gray', 'red', 'green', 'blue', 'saddlebrown', 'pink']]
syn += [Image.fromarray(np.random.randint(0, 255, (224, 224, 3), dtype=np.uint8)) for _ in range(8)]
m.eval()
with torch.no_grad(): Ps = torch.softmax(m(torch.stack([etf(i) for i in syn])) / T, 1)
res['synthetic'] = dict(n=len(syn), predicted_bukan_target=int((Ps.argmax(1) == len(NAMES) - 1).sum()), max_lesion_conf=round(float(Ps[:, [0] if MERGE else [0, 2]].max()), 3))
json.dump(res, open(f'metrics_{TAG}.json', 'w'), indent=1); torch.save(m.state_dict(), f'mobilenetv2_{TAG}.pt')
print(json.dumps({k: res[k] for k in ['temperature', 'best_epoch', 'synthetic']}))
for s in ['train', 'val', 'test']: print(s, json.dumps(res[s]))
