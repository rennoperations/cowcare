# CowCare - Aplikasi PMK Monitor

Proyek PPKBP Kelompok 13: aplikasi web mobile offline-first untuk triase dini penyakit mulut dan kuku (PMK) pada sapi. Peternak memotret gejala, model MobileNetV2 mengklasifikasikan gejala langsung di HP, lalu skor AHP menghasilkan status Hijau/Kuning/Merah sebagai bantuan keputusan rujukan ke dokter hewan.

## Aplikasi

CowCare kini berupa **aplikasi Android** (folder `android/`) dan **versi web/PWA** (folder `web/`) yang memakai antarmuka dan model AI yang sama. Semua proses berjalan di HP: foto tidak dikirim ke server, dan APK tidak meminta izin internet.

Alur (desain revisi 3 faktor): foto mulut (wajib) → badge AI + keyakinan → peternak memastikan derajat air liur (0–4) dan lepuh (0–3) → foto kuku bila pincang → 1 pertanyaan jarak ke kasus aktif → hasil Hijau/Kuning/Merah, skor S, H, saran, dan tombol hubungi dokter hewan. Riwayat, tren, ekspor CSV, dan kelompok risiko kandang (K-means) tersimpan di HP.

**Mendapatkan APK:** unduh `CowCare.apk` dari halaman [Releases](https://github.com/rennoperations/cowcare/releases). Push ke `main` yang mengubah `web/` atau `android/` menjalankan workflow *Build APK Android*; hasilnya bisa diunduh sebagai artifact `CowCare-apk` dari tab Actions. APK dilampirkan ke Releases saat sebuah Release diterbitkan (membuat tag saja tidak cukup). Detail di `android/README.md`.

**Menjalankan versi web secara lokal:**

```
cd web
python -m http.server 8000
# buka http://localhost:8000 (kamera/galeri, atau "Coba dengan foto contoh")
```

Versi web juga dipublikasikan ke GitHub Pages di <https://rennoperations.github.io/cowcare/> lewat workflow `pages.yml`, yang berjalan pada setiap push ke `main` yang mengubah `web/`.

**Model di aplikasi:** `web/model/` berisi MobileNetV2 v5a 5 kelas (`kuku_sakit`, `kuku_sehat`, `mulut_sakit`, `mulut_sehat`, `bukan_target`) dari dataset v2 (split per kelompok tanpa kebocoran; folder `dataset_kurasi/v2/` beserta metriknya belum ada di `main`, masih di PR "Dataset v2" yang belum digabung). BatchNorm dilipat, bobot float16 (4,4 MB), dijalankan oleh `web/engine.js` tanpa library, dengan temperature scaling 0,936. Uji: akurasi 89,5% (train 99,3%), recall lesi 87,5%, bukan target 95%. Konversi ulang: `tools/export_model/` (checkpoint v5a tidak disimpan di repo; yang ada hanya checkpoint PoC 4 kelas). Keterbatasan: kuku sehat masih dari satu kandang, jadi derajat selalu dipastikan peternak.

## Isi repo

| Jalur | Isi |
|---|---|
| `web/` | Aplikasi (HTML/CSS/JS), mesin inferensi `engine.js`, skor `scoring.js`, model, foto contoh |
| `android/` | Proyek Android Studio (Java, WebView, minSdk 24) yang membungkus `web/` menjadi APK |
| `tools/export_model/` | Konversi checkpoint PyTorch ke bobot aplikasi (tanpa PyTorch) |
| `.github/workflows/` | Build APK otomatis dan deploy GitHub Pages |
| `REVISI_DESAIN_3_Faktor_Terbesar_COWCARE.docx` | Desain terbaru hasil revisi dosen: 3 faktor terbesar |
| `docs/` | LKP 3, LKP P4, LKP 5, LKP P6, PMK 3 Bab V, dan PPT (versi sebelum revisi); `AHP_Bobot_Faktor_PMK_CowCare.docx` (dasar bobot 3 faktor); `laporan_akhir/` (Laporan Akhir dan presentasi Demo Day) |
| `wireframe/` | 3 wireframe Figma: Beranda, Periksa Sapi, Hasil |
| `dataset_kurasi/` | Manifest, laporan audit standar WOAH/FAO-EuFMD (`PENILAIAN_DATASET_COWCARE.md` + `penilaian_*.csv`), template pelabelan, contact sheet, dan PoC. Rinciannya di `dataset_kurasi/README.md` |

## Status desain (penting)

Dosen meminta desain dipangkas menjadi **3 faktor terbesar** agar seimbang antara kecerdasan AI dan kemudahan peternak. Desain baru (3 faktor; bobot kini dari AHP berbasis literatur: lepuh terparah 57,1%, air liur 28,6%, jarak ≤ 10 km 14,3%, CR = 0, lihat `docs/AHP_Bobot_Faktor_PMK_CowCare.docx`; kuesioner 1 pertanyaan; maksimal 2 foto; model 8 kelas) dicatat di `REVISI_DESAIN_3_Faktor_Terbesar_COWCARE.docx` dan baru diterapkan pada LKP berikutnya. Aplikasi di `web/` sudah menerapkan 3 faktor ini dengan model 5 kelas; model 8 kelas belum ada. Dokumen LKP, PMK 3, dan PPT di `docs/` masih desain lama (7 faktor, 13 kelas, kuesioner 5 langkah), sedangkan `docs/laporan_akhir/` sudah 3 faktor tetapi masih mencantumkan bobot sebelum AHP (air liur 61,2%, lepuh terparah 25,6%, jarak 13,2%) dan model PoC 4 kelas; template pelabelan di `dataset_kurasi/` (`KELAS_VALID.txt`, `labeling_template.csv`) juga masih memakai 13 kelas.

## Ringkasan PoC

MobileNetV2 4 kelas proxy (mulut sakit/sehat, kuku sakit/sehat) pada 1138 gambar bersih (27 duplikat lintas split dibuang dari 1165 gambar berlabel):

| Split | Akurasi | Macro-F1 | Recall kelas sakit | FN |
|---|---|---|---|---|
| Validasi | 93,7% | 93,3% | 91,5% | 8,5% |
| Uji | 96,8% | 95,5% | 96,6% | 3,4% |

Catatan: akurasi subgrup close-up lebih rendah (validasi 87,3%) dibanding wide shot (99,5%) karena bias framing foto sehat yang diambil jauh vs foto sakit close-up.

Angka lengkap ada di `dataset_kurasi/poc/poc_metrics.json`; bobot model hasil latih ada di `dataset_kurasi/poc/mobilenetv2_fmd4.pt`.

## Menjalankan PoC

PoC memakai ekspor Roboflow `FMD.v1i.yolov8.zip`, yang tidak disimpan di repo.

- **Colab:** buka notebook `dataset_kurasi/poc/poc_fmd_mobilenetv2.ipynb`, lalu unggah `FMD.v1i.yolov8.zip` saat diminta. Notebook hanya mencetak metrik di layar; tidak menyimpan `poc_metrics.json` maupun bobot model.
- **Lokal:** skrip belum punya argumen baris perintah. Ubah dulu variabel `ROOT` di `dataset_kurasi/poc/poc_fmd_mobilenetv2.py` (bawaannya jalur Windows `D:\Documents\SEMESTER 5\PPKBP\LSH`) ke folder yang berisi `FMD.v1i.yolov8.zip` dan folder `dataset_kurasi/`, lalu:

```
pip install torch torchvision scikit-learn numpy pillow
python dataset_kurasi/poc/poc_fmd_mobilenetv2.py
```

Skrip mengekstrak zip ke `dataset_kurasi/poc/data/` (diabaikan Git), lalu menulis ulang `poc_metrics.json` dan `mobilenetv2_fmd4.pt` di `dataset_kurasi/poc/`.

## Aturan dataset

- Foto mentah tidak disimpan di repo (ukuran besar dan lisensi belum lengkap).
- `dataset_kurasi/manifest.csv` memuat sumber tiap foto (tanpa kolom lisensi); lisensi per sumber ada di `dataset_kurasi/PENILAIAN_DATASET_COWCARE.md` bagian 6.4. `penilaian_metrik.csv` dan `penilaian_defek.csv` memuat metrik kualitas per foto, `penilaian_bagian.csv` rekap skor per bagian.
- Foto dari GitHub Ashipunaz (179 foto) belum berlisensi: jangan disebarkan sebelum ada izin pemiliknya.
