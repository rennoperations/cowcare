import os,glob,json,collections,numpy as np,torch,torchvision as tv,imagehash
from PIL import Image
names=['kuku_sakit','kuku_sehat','mulut_sakit','mulut_sehat']
m=tv.models.mobilenet_v2(weights='IMAGENET1K_V1').eval(); m.classifier=torch.nn.Identity()
T=tv.transforms.Compose([tv.transforms.Resize((224,224)),tv.transforms.ToTensor(),tv.transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])
rows=[]
for f in sorted(glob.glob('raw/*/images/*')):
    lp=f.replace('/images/','/labels/').rsplit('.',1)[0]+'.txt'
    L=[l.split() for l in open(lp) if l.strip()] if os.path.exists(lp) else []
    L=[[int(l[0])]+[float(x) for x in l[1:5]] for l in L if len(l)==5]
    im=Image.open(f).convert('RGB')
    rows.append(dict(path=f,split=f.split('/')[1],stem=os.path.basename(f).rsplit('.rf.',1)[0],boxes=L,phash=str(imagehash.phash(im,hash_size=16))))
X=[]
with torch.no_grad():
    for i in range(0,len(rows),64):
        b=torch.stack([T(Image.open(r['path']).convert('RGB')) for r in rows[i:i+64]]); X.append(torch.nn.functional.normalize(m(b),dim=1).numpy())
np.save('emb.npy',np.concatenate(X)); json.dump(rows,open('rows.json','w'))
print(len(rows))
