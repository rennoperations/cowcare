"""
PoC LKP P6 - CowCare
Klasifikasi 4 kelas proxy (mulut_sakit, mulut_sehat, kuku_sakit, kuku_sehat)
MobileNetV2 transfer learning, PyTorch CPU.
Dataset: FMD.v1i.yolov8.zip (proyek Roboflow kelompok, CC BY 4.0)
"""
import os, sys, json, hashlib, random, time, zipfile, shutil
from collections import Counter, defaultdict

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from PIL import Image
import torchvision
from torchvision import transforms
from torchvision.models import mobilenet_v2, MobileNet_V2_Weights
from sklearn.metrics import (accuracy_score, precision_recall_fscore_support,
                             confusion_matrix, classification_report)

SEED = 42
random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))

ROOT = r"D:\Documents\SEMESTER 5\PPKBP\LSH"
ZIP = os.path.join(ROOT, "FMD.v1i.yolov8.zip")
WORK = os.path.join(ROOT, "dataset_kurasi", "poc", "data")
OUT = os.path.join(ROOT, "dataset_kurasi", "poc")
NAMES = ["kuku_sakit", "kuku_sehat", "mulut_sakit", "mulut_sehat"]

# ---------- extract ----------
if not os.path.isdir(WORK):
    print("Ekstrak dataset...")
    with zipfile.ZipFile(ZIP) as z:
        z.extractall(WORK)
print("folder:", os.listdir(WORK))

# ---------- index samples ----------
def index_split(split):
    img_dir = os.path.join(WORK, split, "images")
    lbl_dir = os.path.join(WORK, split, "labels")
    out = []
    for fn in sorted(os.listdir(img_dir)):
        if not fn.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        stem = os.path.splitext(fn)[0]
        lp = os.path.join(lbl_dir, stem + ".txt")
        if not os.path.exists(lp):
            continue
        best = (0.0, -1)
        for line in open(lp, encoding="utf-8", errors="ignore"):
            p = line.split()
            if len(p) == 5:
                area = float(p[3]) * float(p[4])
                if area > best[0]:
                    best = (area, int(float(p[0])))
        if best[1] < 0:
            continue
        fp = os.path.join(img_dir, fn)
        md5 = hashlib.md5(open(fp, "rb").read()).hexdigest()
        out.append({"path": fp, "label": best[1], "area": best[0], "md5": md5, "split": split})
    return out

all_s = []
for sp in ["train", "valid", "test"]:
    s = index_split(sp)
    print(sp, len(s), Counter(x["label"] for x in s))
    all_s += s

# ---------- dedup exact across splits ----------
seen = set()
keep = []
leak = 0
for sp in ["train", "valid", "test"]:
    for r in [x for x in all_s if x["split"] == sp]:
        if r["md5"] in seen:
            leak += 1
            continue
        seen.add(r["md5"])
        keep.append(r)
print(f"total={len(all_s)}  duplikat lintas-split dibuang={leak}  bersih={len(keep)}")
for sp in ["train", "valid", "test"]:
    sub = [r for r in keep if r["split"] == sp]
    print(" ", sp, len(sub), dict(Counter(NAMES[r["label"]] for r in sub)))

# ---------- dataset ----------
class FMDDataset(Dataset):
    def __init__(self, rows, tf):
        self.rows = rows; self.tf = tf
    def __len__(self):
        return len(self.rows)
    def __getitem__(self, i):
        r = self.rows[i]
        im = Image.open(r["path"]).convert("RGB")
        return self.tf(im), r["label"], i

train_tf = transforms.Compose([
    transforms.RandomResizedCrop(224, scale=(0.7, 1.0)),
    transforms.RandomHorizontalFlip(),
    transforms.ColorJitter(0.2, 0.2, 0.15),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])
eval_tf = transforms.Compose([
    transforms.Resize(256), transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])

tr = [r for r in keep if r["split"] == "train"]
va = [r for r in keep if r["split"] == "valid"]
te = [r for r in keep if r["split"] == "test"]
bs = 32
dl_tr = DataLoader(FMDDataset(tr, train_tf), batch_size=bs, shuffle=True, num_workers=0)
dl_va = DataLoader(FMDDataset(va, eval_tf), batch_size=bs, shuffle=False, num_workers=0)
dl_te = DataLoader(FMDDataset(te, eval_tf), batch_size=bs, shuffle=False, num_workers=0)

# ---------- model ----------
try:
    model = mobilenet_v2(weights=MobileNet_V2_Weights.IMAGENET1K_V1)
    pretrained = True
except Exception as e:
    print("Gagal unduh bobot pretrained:", e)
    model = mobilenet_v2(weights=None)
    pretrained = False
model.classifier[1] = nn.Linear(model.classifier[1].in_features, len(NAMES))
for p in model.features.parameters():
    p.requires_grad = False
for blk in model.features[-4:]:
    for p in blk.parameters():
        p.requires_grad = True

criterion = nn.CrossEntropyLoss(label_smoothing=0.05)
head_params = list(model.classifier.parameters())
back_params = [p for p in model.parameters() if p.requires_grad and not any(p is q for q in head_params)]
opt = torch.optim.AdamW([
    {"params": head_params, "lr": 1e-3},
    {"params": back_params, "lr": 1e-4},
], weight_decay=1e-4)
sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=7)

def evaluate(dl):
    model.eval(); ys, ps, idxs = [], [], []
    with torch.no_grad():
        for x, y, i in dl:
            logit = model(x)
            ps += logit.argmax(1).tolist(); ys += y.tolist(); idxs += i.tolist()
    return np.array(ys), np.array(ps), idxs

EPOCHS = 7
t0 = time.time()
for ep in range(EPOCHS):
    model.train(); tot = corr = 0; loss_sum = 0.0
    for x, y, _ in dl_tr:
        opt.zero_grad()
        logit = model(x)
        loss = criterion(logit, y)
        loss.backward(); opt.step()
        loss_sum += loss.item() * len(y)
        corr += (logit.argmax(1) == y).sum().item(); tot += len(y)
    sched.step()
    yv, pv, _ = evaluate(dl_va)
    print(f"epoch {ep+1}/{EPOCHS}  loss={loss_sum/tot:.3f}  train_acc={corr/tot:.3f}  "
          f"val_acc={(yv==pv).mean():.3f}  waktu={time.time()-t0:.0f}s")

# ---------- final metrics ----------
results = {"pretrained": pretrained, "dedup": {"original": len(all_s), "removed": leak, "clean": len(keep)},
           "splits": {sp: len([r for r in keep if r["split"] == sp]) for sp in ["train", "valid", "test"]},
           "class_names": NAMES, "class_counts": {NAMES[k]: int(v) for k, v in
                                                  Counter(r["label"] for r in keep).items()}}

for tag, dl, rows in [("valid", dl_va, va), ("test", dl_te, te)]:
    y, p, idxs = evaluate(dl)
    acc = accuracy_score(y, p)
    prec, rec, f1, sup = precision_recall_fscore_support(y, p, labels=range(len(NAMES)), zero_division=0)
    cm = confusion_matrix(y, p, labels=range(len(NAMES)))
    sick_ids = [i for i, n in enumerate(NAMES) if n.endswith("sakit")]
    sick_recall = rec[sick_ids].mean()
    fn_rate = 1 - sick_recall
    results[tag] = {
        "n": int(len(y)), "accuracy": float(acc),
        "macro_precision": float(prec.mean()), "macro_recall": float(rec.mean()), "macro_f1": float(f1.mean()),
        "per_class": {NAMES[i]: {"precision": float(prec[i]), "recall": float(rec[i]),
                                 "f1": float(f1[i]), "support": int(sup[i])} for i in range(len(NAMES))},
        "sick_recall_mean": float(sick_recall), "false_negative_rate": float(fn_rate),
        "confusion_matrix": cm.tolist(),
    }
    # subgroup framing
    areas = np.array([rows[i]["area"] for i in idxs])
    for name, mask in [("close_bbox_ge_8pct", areas >= 0.08), ("wide_bbox_lt_8pct", areas < 0.08)]:
        if mask.sum() > 0:
            results[tag][name] = {"n": int(mask.sum()), "accuracy": float((y[mask] == p[mask]).mean())}
    print(f"\n== {tag.upper()} n={len(y)} acc={acc:.4f} macroF1={f1.mean():.4f} "
          f"sick_recall={sick_recall:.4f} FN={fn_rate:.4f}")
    print(classification_report(y, p, target_names=NAMES, digits=3, zero_division=0))
    print("confusion:\n", cm)
    print("subgroup:", {k: results[tag][k] for k in ["close_bbox_ge_8pct", "wide_bbox_lt_8pct"] if k in results[tag]})

with open(os.path.join(OUT, "poc_metrics.json"), "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)
torch.save(model.state_dict(), os.path.join(OUT, "mobilenetv2_fmd4.pt"))
print("\nSelesai. Metrik:", os.path.join(OUT, "poc_metrics.json"))
