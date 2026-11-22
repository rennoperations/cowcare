# Dataset Kurasi CowCare

Hasil penggabungan & deduplikasi 6 sumber dataset FMD sapi.
**Total 2050 foto unik** (sudah dedup global dengan perceptual hash 16x16).

## Bucket foto

Foto mentah tidak disimpan di repo. Kelima folder di bawah ini hanya muncul
sebagai kolom `bucket` di `manifest.csv`.

| Bucket | Jumlah | Isi |
|---|---|---|
| `1_mulut_gusi_lidah` | 496 | area mulut/gusi/lidah sudah pasti (dari bbox Roboflow-mu) |
| `2_kaki` | 243 | area kaki/hoof sudah pasti |
| `3_puting` | 11 | area puting |
| `4_belum_diketahui` | 816 | area belum jelas: 787 foto sakit (PRIORITAS KURASI) + 29 foto berstatus `unknown` |
| `5_sehat` | 484 | foto sapi sehat (kandidat kelas `sehat`) |

## Isi folder ini

| Jalur | Isi |
|---|---|
| `manifest.csv` | 2050 baris: bucket, status, area/stadium otomatis, sumber, ukuran, hash tiap foto |
| `labeling_template.csv` | 1537 baris (semua foto berstatus sakit) untuk diisi `KELAS_FINAL` dan `LAYAK_tidak` |
| `KELAS_VALID.txt` | daftar 13 kelas yang sah untuk `KELAS_FINAL` |
| `contact_sheet/` | 26 file (`sheet_01.jpg` - `sheet_26.jpg`), hingga 60 foto sakit per lembar, untuk kurasi visual |
| `contact_sheet_extra/` | 10 file: `puting_01.jpg` dan `sehat_01.jpg` - `sehat_09.jpg` |
| `PENILAIAN_DATASET_COWCARE.md` | laporan audit mutu dataset (standar WOAH/FAO-EuFMD) |
| `penilaian_metrik.csv`, `penilaian_defek.csv` | metrik kualitas dan defek per foto (2050 baris) |
| `penilaian_bagian.csv` | rekap skor audit per bucket + baris total tertimbang |
| `poc/` | PoC MobileNetV2 4 kelas proxy: skrip, notebook, `poc_metrics.json`, bobot `mobilenetv2_fmd4.pt` (cara menjalankan ada di README utama) |

## Sumber data

Kolom "Unik di manifest" = jumlah foto per nilai kolom `sumber` di `manifest.csv`
setelah dedup (total 2050).

| Sumber | Nilai `sumber` di manifest | Jumlah di zip | Unik di manifest | Peran |
|---|---|---|---|---|
| Zenodo FMD Cattle (Osborn 2023) | `Zenodo FMD_Cattle` | 378 | 275 | foto klinis terkontrol 512x512 |
| Kaggle Cattle Diseases Dataset | `Kaggle SkinDisease` | 1.038 | 115 | 115 FMD + Lumpy + Normal |
| FMD ComVis (devang03mgr) | `FMD ComVis` | 3.244 | 625 | 746 foot-and-mouth 300x300 |
| Roboflow YOLO `fmd-6p2ec-glvfc` | `Roboflow User YOLO` | 1.195 | 854 | bbox YOLO, 4 kelas (kuku/mulut x sakit/sehat) |
| GitHub Ashipunaz (Git LFS) | `GitHub Ashipunaz` | 874 | 179 | 357 original + sisanya sudah di-augmentasi |
| EuFMD Lesion Library (FAO/EU) | `EuFMD Lesion Library` | 87 | 2 | **metadata usia lesi = staging** |

## Cara kurasi

1. Buka `contact_sheet/sheet_01.jpg` dan seterusnya (26 sheet).
2. Nomor di kiri atas setiap thumbnail = kolom `idx` di `labeling_template.csv`.
3. Isi `KELAS_FINAL` dengan salah satu dari 13 kelas (lihat `KELAS_VALID.txt`):

```
air_liur_1  air_liur_2  air_liur_3  air_liur_4
gusi_1      gusi_2      gusi_3
kaki_1      kaki_2      kaki_3
lidah_1     lidah_2     lidah_3
```

   Catatan: 13 kelas ini masih desain lama. Revisi desain 8 kelas (lihat README
   utama) belum diterapkan pada template ini.

4. Isi `LAYAK_tidak` dengan `tidak` untuk foto yang: blur, whole-body (bukan
   close-up lesi), screenshot, atau bukan FMD. Foto ini bisa dibuang.
5. Foto bertanda `S1`..`S4` di contact sheet sudah punya **stadium otomatis**
   dari metadata usia lesi EuFMD (83 foto: 81 lewat `Kaggle SkinDisease`, 2 langsung
   dari `EuFMD Lesion Library`) - pakai sebagai acuan, tetap perlu verifikasi dokter hewan.

## Catatan penting

- Bucket `4_belum_diketahui` berisi **816 foto** (787 sakit yang masuk
  `labeling_template.csv` + 29 berstatus `unknown`) dan wajib dikurasi sebelum
  training, karena area tubuhnya belum bisa dipetakan ke kelas mana pun.
- **Jangan** pakai bucket `5_sehat` sebagai kelas FMD. Kalau mau dipakai, harus
  ada kelas `sehat` tersendiri - ini mengubah isi LKP 3/4/5, perlu disepakati
  kelompok dulu.
- Split train/val/test harus dibuat ulang dari daftar foto unik di `manifest.csv`.
  Jangan pakai split Roboflow apa adanya, karena ada foto yang sama di beberapa
  split (data leakage).
