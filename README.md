# CowCare - Aplikasi PMK Monitor

Proyek PPKBP Kelompok 13: aplikasi web mobile offline-first untuk triase dini penyakit mulut dan kuku (PMK) pada sapi. Peternak memotret gejala, model MobileNetV2 mengklasifikasikan gejala langsung di HP, lalu skor AHP menghasilkan status Hijau/Kuning/Merah sebagai bantuan keputusan rujukan ke dokter hewan.

## Isi repo

| Jalur | Isi |
|---|---|
| `REVISI_DESAIN_3_Faktor_Terbesar_COWCARE.docx` | Desain terbaru hasil revisi dosen: 3 faktor terbesar |
| `docs/` | LKP 3, LKP P4, LKP 5, LKP P6, PMK 3 Bab V, dan PPT (versi sebelum revisi) |
| `wireframe/` | 3 wireframe Figma: Beranda, Periksa Sapi, Hasil |
| `dataset_kurasi/` | Manifest, laporan audit standar WOAH/FAO-EuFMD, template pelabelan, contact sheet, dan PoC |

## Status desain (penting)

Dosen meminta desain dipangkas menjadi **3 faktor terbesar** agar seimbang antara kecerdasan AI dan kemudahan peternak. Desain baru (air liur 61,2%, lepuh terparah 25,6%, jarak 13,2%; kuesioner 1 pertanyaan; maksimal 2 foto; model 8 kelas) dicatat di `REVISI_DESAIN_3_Faktor_Terbesar_COWCARE.docx` dan baru diterapkan pada LKP berikutnya. Dokumen di `docs/` masih desain lama (7 faktor, 13 kelas, kuesioner 5 langkah).

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
