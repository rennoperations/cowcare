# Dataset v2: crop per kotak + split per kelompok (tanpa kebocoran)

Pipeline untuk melatih ulang MobileNetV2 CowCare dengan split train/val/test yang jujur.
Foto tidak di-commit; unduh sumbernya lalu jalankan skrip dari folder kerja yang berisi `raw/` dan `ext/`.

## Sumber

| Sumber | Folder kerja | Dipakai sebagai | Lisensi |
|---|---|---|---|
| Roboflow `FMD.v1i.yolov8` (1.195 foto) | `raw/` | 4 kelas kuku/mulut x sakit/sehat (kotak YOLO) | lihat README Roboflow |
| [Roboflow cow-hooves v15](https://universe.roboflow.com/cow-project-ytsiq/cow-hooves) (2.286 foto, 952 asli) | `ext/hooves/` | good/normal-hooves -> `kuku_sehat`; bad-hooves diabaikan (bukan label PMK) | CC BY 4.0 |
| [Zenodo FMD Cattle, Osborn](https://zenodo.org/records/7779246) (332 foto terbaca) | `ext/FMD_Cattle/` | per nama file: mulut/kuku sakit/sehat, ambing sehat -> `bukan_target`; ambing sakit & "drooling cow" dibuang | CC BY 4.0 |
| Kaggle FMD-Detection and Classification | - | tidak dipakai: 100% duplikat Zenodo Osborn (pHash) | CC BY-NC 4.0 |

## Langkah

1. `python3 embed2.py` - embedding MobileNetV2 ImageNet + pHash 16x16 semua foto (`rows2.json`, `emb2.npy`).
2. `python3 build2.py` - kelompok = klaster embedding (cosine 0,15) ∪ near-duplicate pHash (≤20) ∪ stem Roboflow yang sama (salinan augmentasi).
   Split 70/15/15 per kelompok, maks 30 foto/kelompok di train dan 8 di val/test. Crop tiap kotak dengan konteks 1,3-2x
   (foto sehat dan sakit sama-sama close-up), plus satu crop latar per foto sebagai `bukan_target`. Hasil: `ds2/`, `split_manifest.csv`.
3. `DS=ds2 MERGE=0 UNF=5 TAG=v4a python3 train.py` - fine-tune 5 blok terakhir, augmentasi degradasi resolusi/blur,
   dropout 0,4, early stopping dengan penalti gap train-val, temperature scaling dari val. `MERGE=1` = 3 kelas `lesi/sehat/bukan_target`.
4. `TAG=v4a python3 eval_source.py` - recall per sumber data (cek shortcut "sumber foto = kelas").
5. `OLD_PT=../poc/mobilenetv2_fmd4.pt python3 oldeval.py` - model lama pada crop latar.

## Komposisi split (crop, kelompok)

| Kelas | Train | Val | Test |
|---|---|---|---|
| kuku_sakit | 178 / 80 | 37 / 37 | 37 / 37 |
| kuku_sehat | 1.280 / 61 | 118 / 26 | 127 / 26 |
| mulut_sakit | 370 / 162 | 67 / 67 | 67 / 67 |
| mulut_sehat | 170 / 65 | 24 / 24 | 24 / 24 |
| bukan_target | 1.488 / 279 | 136 / 98 | 128 / 84 |

Kelompok yang muncul di lebih dari satu split: 0.

## Hasil (MobileNetV2, 5 kelas)

| Model | Data | Train acc / F1 | Val acc / F1 | Test acc / F1 |
|---|---|---|---|---|
| v2 | hanya Roboflow FMD | 98,8% / 0,99 | 80,6% / 0,62 | 82,4% / 0,65 |
| v4a | gabungan (dataset ini) | 99,4% / 0,99 | 89,0% / 0,88 | 86,7% / 0,82 |

v4a, recall test: kuku_sakit 0,76 · kuku_sehat 0,86 · mulut_sakit 0,82 · mulut_sehat 0,75 · bukan_target 0,95. ECE test 0,04.
16/16 gambar polos/noise diprediksi `bukan_target`.

Akurasi 96,8% model lama tidak sebanding: split lamanya punya 2.628 pasangan near-duplicate lintas train/valid/test.

## Batasan

- Semua `kuku_sehat` dari satu sumber (cow-hooves), `kuku_sakit` dari sumber lain; shortcut latar belum bisa disingkirkan sepenuhnya.
  Latar foto cow-hooves dimasukkan sebagai `bukan_target` (recall 0,985) untuk menekan risiko ini.
- `mulut_sehat` masih sedikit (24 kelompok test). Foto mulut terbuka/lidah sapi sehat dari kandang lokal paling dibutuhkan.
- Ini alat bantu triase, bukan diagnosis. Konfirmasi tetap oleh dokter hewan/laboratorium.
