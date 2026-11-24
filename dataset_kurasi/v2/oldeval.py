import os,csv,torch,torch.nn as nn,torchvision as tv,numpy as np
from PIL import Image
torch.set_num_threads(2)
m=tv.models.mobilenet_v2(weights=None); m.classifier[1]=nn.Linear(1280,4)
m.load_state_dict(torch.load(os.environ.get('OLD_PT','mobilenetv2_fmd4.pt'),map_location='cpu')); m.eval()
etf=tv.transforms.Compose([tv.transforms.Resize((224,224)),tv.transforms.ToTensor(),tv.transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])
rows=[r for r in csv.DictReader(open(os.environ.get('DS', 'ds2') + '/split_manifest.csv')) if r['split']=='test' and r['kelas']=='bukan_target']
with torch.no_grad(): P=torch.softmax(m(torch.stack([etf(Image.open(r['file']).convert('RGB')) for r in rows])),1)
sick=P[:,[0,2]].max(1).values
print('old model on test background crops n=%d: label sakit %.1f%%, sakit>=80%% conf %.1f%%'%(len(rows),100*(P.argmax(1)%2==0).float().mean(),100*(sick>=0.8).float().mean()))
