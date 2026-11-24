# CowCare - Aplikasi PMK Monitor

Proyek PPKBP Kelompok 13: aplikasi web mobile offline-first untuk triase dini penyakit mulut dan kuku (PMK) pada sapi. Peternak memotret gejala, model MobileNetV2 mengklasifikasikan gejala langsung di HP, lalu skor AHP menghasilkan status Hijau/Kuning/Merah sebagai bantuan keputusan rujukan ke dokter hewan.

## Aplikasi

CowCare kini berupa **aplikasi Android** (folder `android/`) dan **versi web/PWA** (folder `web/`) yang memakai antarmuka dan model AI yang sama. Semua proses berjalan di HP: foto tidak dikirim ke server, dan APK tidak meminta izin internet.

Alur (desain revisi 3 faktor): foto mulut (wajib) → badge AI + keyakinan → peternak memastikan derajat air liur (0–4) dan lepuh (0–3) → foto kuku bila pincang → 1 pertanyaan jarak ke kasus aktif → hasil Hijau/Kuning/Merah, skor S, H, saran, dan tombol hubungi dokter hewan. Riwayat, tren, ekspor CSV, dan kelompok risiko kandang (K-means) tersimpan di HP.

**Mendapatkan APK:** push ke `main` menjalankan workflow *Build APK Android*; unduh artifact `CowCare-apk` dari tab Actions, atau buat tag `v1.0.0` agar APK muncul di Releases. Detail di `android/README.md`.

**Menjalankan versi web secara lokal:**

```
cd web
python -m http.server 8000
# buka http://localhost:8000 (kamera/galeri, atau "Coba dengan foto contoh")
```

Versi web juga bisa dipublikasikan ke GitHub Pages lewat workflow `pages.yml` (aktifkan Settings → Pages → Source: GitHub Actions).

**Model di aplikasi:** `web/model/` berisi MobileNetV2 v5a 5 kelas (`kuku_sakit`, `kuku_sehat`, `mulut_sakit`, `mulut_sehat`, `bukan_target`) dari dataset v2 (`dataset_kurasi/v2/`, split per kelompok tanpa kebocoran). BatchNorm dilipat, bobot float16 (4,4 MB), dijalankan oleh `web/engine.js` tanpa library, dengan temperature scaling 0,936. Uji: akurasi 89,5% (train 99,3%), recall lesi 87,5%, bukan target 95%. Konversi ulang: `tools/export_model/`. Keterbatasan: kuku sehat masih dari satu kandang, jadi derajat selalu dipastikan peternak.

## Isi repo

| Jalur | Isi |
|---|---|
| `web/` | Aplikasi (HTML/CSS/JS), mesin inferensi `engine.js`, skor `scoring.js`, model, foto contoh |
| `android/` | Proyek Android Studio (Java, WebView, minSdk 24) yang membungkus `web/` menjadi APK |
| `tools/export_model/` | Konversi checkpoint PyTorch ke bobot aplikasi (tanpa PyTorch) |
| `.github/workflows/` | Build APK otomatis dan deploy GitHub Pages |
| `REVISI_DESAIN_3_Faktor_Terbesar_COWCARE.docx` | Desain terbaru hasil revisi dosen: 3 faktor terbesar |
| `docs/` | LKP 3, LKP P4, LKP 5, LKP P6, PMK 3 Bab V, dan PPT (versi sebelum revisi) |
| `wireframe/` | 3 wireframe Figma: Beranda, Periksa Sapi, Hasil |
| `dataset_kurasi/` | Manifest, laporan audit standar WOAH/FAO-EuFMD, template pelabelan, contact sheet, dan PoC |

## Status desain (penting)

Dosen meminta desain dipangkas menjadi **3 faktor terbesar** agar seimbang antara kecerdasan AI dan kemudahan peternak. Desain baru (3 faktor; bobot kini dari AHP berbasis literatur: lepuh terparah 57,1%, air liur 28,6%, jarak ≤ 10 km 14,3%, CR = 0, lihat `docs/AHP_Bobot_Faktor_PMK_CowCare.docx`; kuesioner 1 pertanyaan; maksimal 2 foto; model 8 kelas) dicatat di `REVISI_DESAIN_3_Faktor_Terbesar_COWCARE.docx` dan baru diterapkan pada LKP berikutnya. Dokumen di `docs/` masih desain lama (7 faktor, 13 kelas, kuesioner 5 langkah).

## Ringkasan PoC

MobileNetV2 4 kelas proxy (mulut sakit/sehat, kuku sakit/sehat) pada 1138 gambar bersih (27 duplikat lintas split dibuang dari 1165 gambar berlabel):

| Split | Akurasi | Macro-F1 | Recall kelas sakit | FN |
|---|---|---|---|---|
| Validasi | 93,7% | 93,3% | 91,5% | 8,5% |
| Uji | 96,8% | 95,6% | 96,6% | 3,4% |

Catatan: akurasi subgrup close-up lebih rendah (validasi 87,3%) dibanding wide shot (99,5%) karena bias framing foto sehat yang diambil jauh vs foto sakit close-up.

## Menjalankan PoC

Notebook `dataset_kurasi/poc/poc_fmd_mobilenetv2.ipynb` siap dipakai di Colab, atau:

```
pip install torch torchvision scikit-learn opencv-python
python dataset_kurasi/poc/poc_fmd_mobilenetv2.py --data <folder dataset>
```

## Aturan dataset

- Foto mentah tidak disimpan di repo (ukuran besar dan lisensi belum lengkap).
- `manifest.csv` memuat sumber dan lisensi tiap foto; `penilaian_*.csv` memuat metrik kualitas per foto.
- Foto dari GitHub Ashipunaz (179 foto) belum berlisensi: jangan disebarkan sebelum ada izin pemiliknya.
