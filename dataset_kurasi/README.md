# Dataset Kurasi CowCare

Hasil penggabungan & deduplikasi 6 sumber dataset FMD sapi.
**Total 2050 foto unik** (sudah dedup global dengan perceptual hash 16x16).

## Struktur folder

| Folder | Jumlah | Isi |
|---|---|---|
| `1_mulut_gusi_lidah` | 496 | area mulut/gusi/lidah sudah pasti (dari bbox Roboflow-mu) |
| `2_kaki` | 243 | area kaki/hoof sudah pasti |
| `3_puting` | 11 | area puting |
| `4_belum_diketahui` | 787 | foto sakit, area belum jelas - PRIORITAS KURASI |
| `5_sehat` | 484 | foto sapi sehat (kandidat kelas `sehat`) |
| `contact_sheet` | 26 file | contact sheet untuk kurasi visual |

## Sumber data

| Sumber | Jumlah di zip | Peran |
|---|---|---|
| Zenodo FMD Cattle (Osborn 2023) | 378 | foto klinis terkontrol 512x512 |
| Kaggle Cattle Diseases Dataset | 1.038 | 115 FMD + Lumpy + Normal |
| FMD ComVis (devang03mgr) | 3.244 | 746 foot-and-mouth 300x300 |
| Roboflow YOLO `fmd-6p2ec-glvfc` | 1.195 | bbox YOLO, 4 kelas (kuku/mulut x sakit/sehat) |
| GitHub Ashipunaz (Git LFS) | 874 | 357 original + sisanya sudah di-augmentasi |
| EuFMD Lesion Library (FAO/EU) | 87 | **metadata usia lesi = staging** |

## Cara kurasi

1. Buka `contact_sheet/sheet_01.png` dan seterusnya (27 sheet).
2. Nomor di kiri atas setiap thumbnail = kolom `idx` di `labeling_template.csv`.
3. Isi `KELAS_FINAL` dengan salah satu dari 13 kelas (lihat `KELAS_VALID.txt`):

```
air_liur_1  air_liur_2  air_liur_3  air_liur_4
gusi_1      gusi_2      gusi_3
kaki_1      kaki_2      kaki_3
lidah_1     lidah_2     lidah_3
```

4. Isi `LAYAK_tidak` dengan `tidak` untuk foto yang: blur, whole-body (bukan
   close-up lesi), screenshot, atau bukan FMD. Foto ini bisa dibuang.
5. Foto bertanda `S1`..`S4` di contact sheet sudah punya **stadium otomatis**
   dari EuFMD (83 foto) - pakai sebagai acuan, tetap perlu verifikasi dokter hewan.

## Catatan penting

- Folder `4_belum_diketahui` berisi **787 foto** dan wajib dikurasi sebelum
  training, karena area tubuhnya belum bisa dipetakan ke kelas mana pun.
- **Jangan** pakai folder `5_sehat` sebagai kelas FMD. Kalau mau dipakai, harus
  ada kelas `sehat` tersendiri - ini mengubah isi LKP 3/4/5, perlu disepakati
  kelompok dulu.
- Split train/val/test harus dibuat ulang dari daftar foto unik di `manifest.csv`.
  Jangan pakai split Roboflow apa adanya, karena ada foto yang sama di beberapa
  split (data leakage).
