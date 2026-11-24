# Ekspor model ke aplikasi

Mengubah `dataset_kurasi/poc/mobilenetv2_fmd4.pt` (state_dict PyTorch) menjadi
`web/model/model.json` + `web/model/weights.bin` (BatchNorm dilipat, bobot float16, 4,4 MB)
yang dibaca mesin inferensi JavaScript `web/engine.js`. Tidak butuh PyTorch.

```
pip install numpy pillow
cd tools/export_model
python export_model.py ../../dataset_kurasi/poc/mobilenetv2_fmd4.pt ../../web/model
```

Bila model 8 kelas (desain revisi) sudah dilatih dengan arsitektur MobileNetV2 torchvision yang sama,
cukup ganti `CLASSES` di `export_model.py` lalu jalankan perintah di atas.

Model v5a (5 kelas, termasuk `bukan_target`, temperature dari kalibrasi validasi):

```
CLASSES=kuku_sakit,kuku_sehat,mulut_sakit,mulut_sehat,bukan_target NAME=cowcare-mobilenetv2-fmd5 \
VERSION=0.5.0-v5a TEMPERATURE=0.936 python export_model.py ~/fmd/mobilenetv2_v5a.pt ../../web/model
```
