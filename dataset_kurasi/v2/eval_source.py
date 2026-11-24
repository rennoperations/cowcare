"""Recall per sumber data pada split test, untuk mendeteksi shortcut 'sumber foto = kelas'."""
import os, csv, collections, torch, torch.nn as nn, torchvision as tv
from PIL import Image
TAG = os.environ['TAG']; MERGE = os.environ.get('MERGE') == '1'; DS = os.environ.get('DS', 'ds2'); SPLIT = os.environ.get('SPLIT', 'test')
NAMES = ['lesi', 'sehat', 'bukan_target'] if MERGE else ['kuku_sakit', 'kuku_sehat', 'mulut_sakit', 'mulut_sehat', 'bukan_target']
def kelas(r): return (r['kelas'].split('_')[1].replace('sakit', 'lesi') if r['kelas'] != 'bukan_target' else 'bukan_target') if MERGE else r['kelas']
m = tv.models.mobilenet_v2(weights=None); m.classifier[1] = nn.Linear(1280, len(NAMES))
m.load_state_dict(torch.load(f'mobilenetv2_{TAG}.pt', map_location='cpu')); m.eval()
etf = tv.transforms.Compose([tv.transforms.Resize((224, 224)), tv.transforms.ToTensor(), tv.transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
ok, n = collections.Counter(), collections.Counter()
with torch.no_grad():
    for r in csv.DictReader(open(f'{DS}/split_manifest.csv')):
        if r['split'] != SPLIT: continue
        p = m(etf(Image.open(r['file']).convert('RGB'))[None]).argmax(1).item(); k = (r['source'], r['kelas'])
        n[k] += 1; ok[k] += NAMES[p] == kelas(r)
for k in sorted(n): print(f'{k[0]:16s} {k[1]:13s} n={n[k]:4d} recall={ok[k]/n[k]:.3f}')
