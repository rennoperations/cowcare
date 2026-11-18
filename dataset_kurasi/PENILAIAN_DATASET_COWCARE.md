# PENILAIAN MUTU DATASET COWCARE
### Audit berbasis standar WOAH, FAO/EuFMD, dan kaidah computer vision
Tanggal audit: 21 Oktober 2026 · Cakupan: 2.050 foto unik · 5 bagian · 13 kelas target

---

## 1. Ringkasan Eksekutif

| Item | Hasil |
|---|---|
| Total foto unik | 2.050 (0 duplikat, terverifikasi) |
| Foto sakit | 1.537 |
| Foto sehat | 484 |
| Status tidak diketahui | 29 |
| **Skor mutu keseluruhan** | **51 / 100 — Grade C** |
| Kelas yang sudah punya label final | **0 dari 13** |
| Foto sakit yang punya stadium lesi | **83 (5,4%)** |
| Kesimpulan | Bahan mentah layak, **belum siap dilatih** |

**Tiga temuan terbesar:**

1. **Bias framing (paling berbahaya).** Di proyek Roboflow sendiri, foto *sehat* didominasi foto jarak jauh (median bbox hanya 2,1% luas frame), sedangkan foto *sakit* adalah close-up (median 11–12%). Model bisa mencapai akurasi tinggi hanya dengan membedakan "close-up vs foto jauh", bukan mempelajari lesi. Ini *shortcut learning* klasik.
2. **Taksonomi 13 kelas tidak selaras standar.** EuFMD mendefinisikan 4–5 tahap usia lesi; aplikasi memakai 3 tahap per situs. Kelas `air_liur_1-4` memakai 4 tingkat keparahan liur yang **tidak punya padanan resmi** di WOAH/EuFMD.
3. **Stadium 1 (vesikel utuh) hampir tidak ada.** Dari 83 foto berstadium: S1 = 5, S2 = 24, S3 = 37, S4 = 17. Kelas `*_1` tidak akan bisa dipelajari model.

---

## 2. Dasar Penilaian (Standar Acuan)

> **Catatan penting:** WHO adalah organisasi kesehatan **manusia**. Standar penyakit hewan yang berlaku adalah **WOAH** (World Organisation for Animal Health, dulu OIE), **FAO**, dan **EuFMD**. Untuk konteks Indonesia, acuan operasionalnya Ditjen PKH Kementan.

| Kode | Standar | Yang dipakai |
|---|---|---|
| **S1** | WOAH Terrestrial Animal Health Code Ch. 8.8 + *FMD Technical Disease Card* | Definisi kasus, situs predileksi lesi, tanda klinis |
| **S2** | FAO/EuFMD *A Field Guide to Estimating the Age of Foot-and-Mouth Disease Lesions* | Tahap usia lesi & akurasi penilaian |
| **S3** | EuFMD *Real-Time Training — FMD Clinical Examination* (Kenya Manual 2014) | Prosedur pemeriksaan: mulut, kuku dibersihkan, puting |
| **S4** | Praktik dataset untuk MobileNetV2 224×224 | Resolusi minimum, framing, augmentasi |

**Kutipan standar yang menjadi dasar:**

- **Situs lesi PMK (WOAH):** lidah, dental pad, gusi, pipi, langit-langit, bibir, lubang hidung, moncong, coronary band, puting, ambing, dan sela antar-kuku.
- **Usia lesi (FAO/EuFMD):**
  - Hari 1 — vesikel utuh berisi cairan, kulit pucat.
  - Hari 2 — vesikel pecah, epitel pucat masih ada, dermis merah terbuka.
  - Hari 3–4 — epitel hilang, deposisi fibrin, epitel mulai tumbuh di tepi.
  - Hari 5–7 — pertumbuhan epitel menonjol, fibrin hilang, jaringan parut.
  - Hari 7+ — fibrin hilang, epitel baru menutup dermis, parut berkembang.
  - **Akurasi: ±1 hari sampai hari ke-5; setelah itu meleset hingga ±3 hari.**
- **Batas diagnosis visual (WOAH):** PMK **tidak dapat dibedakan secara klinis** dari penyakit vesikular lain (vesicular stomatitis, bovine papular stomatitis, pseudocowpox, dll.) tanpa uji laboratorium. Karena itu label dataset ini adalah **"suspek PMK"**, bukan diagnosis terkonfirmasi.

---

## 3. Rubrik Penilaian

| Dimensi | Bobot | Kriteria |
|---|---|---|
| **K1 Kesesuaian klinis** | 30 | Lesi/tanda khas PMK terlihat; bukan lesi non-PMK; situs sesuai WOAH |
| **K2 Ketepatan situs anatomi** | 20 | Foto benar-benar menampilkan gusi/lidah/kaki/puting, bukan whole-body |
| **K3 Keterbacaan stadium** | 20 | Lesi cukup jelas untuk dinilai usianya menurut EuFMD |
| **K4 Kualitas teknis** | 20 | Resolusi, fokus, cahaya, framing close-up, bebas artefak |
| **K5 Provenance & lisensi** | 10 | Sumber jelas, lisensi boleh dipakai, atribusi dapat dipenuhi |

**Kelas mutu:**

| Grade | Skor | Arti |
|---|---|---|
| **A** | 80–100 | Siap dilatih |
| **B** | 65–79 | Latih setelah koreksi ringan |
| **C** | 50–64 | Wajib kurasi + verifikasi dokter hewan |
| **D** | < 50 | Buang / olah ulang |

---

## 4. Hasil per Bagian

| Bagian | n | K1 (30) | K2 (20) | K3 (20) | K4 (20) | K5 (10) | **Total** | **Grade** | Putusan |
|---|---:|---:|---:|---:|---:|---:|---:|:---:|---|
| `1_mulut_gusi_lidah` | 496 | 27 | 12 | 10 | 14 | 8 | **71** | **B** | Layak setelah koreksi |
| `2_kaki` | 243 | 23 | 18 | 5 | 9 | 8 | **63** | **C** | Kurasi berat |
| `3_puting` | 11 | 22 | 19 | 10 | 16 | 8 | **75** | **B\*** | Mutu baik, jumlah tidak layak |
| `4_belum_diketahui` | 816 | 14 | 5 | 0 | 8 | 6 | **33** | **D** | Olah ulang |
| `5_sehat` | 484 | 16 | 10 | 12 | 9 | 8 | **55** | **C** | Hanya untuk kontrol negatif |
| **Tertimbang jumlah foto** | **2.050** | | | | | | **51** | **C** | |

\* `3_puting` grade B untuk mutu, tetapi **n=11 jauh di bawah ambang** layak kelas (≥140).

### 4.1 `1_mulut_gusi_lidah` — 496 foto (B, 71)

**Kekuatan:** inti dataset. Close-up lesi mulut, banyak dari EuFMD (watermark terlihat), staging tersedia untuk 68 foto.

**Kelemahan:**
- Hanya **71 foto** punya label situs eksplisit (moncong 54, dental pad 10, lidah 6, gusi 1). **425 foto (86%) situsnya belum terverifikasi** — tidak diketahui apakah gusi, lidah, atau moncong.
- **110 foto (22%)** di bawah ambang ketajaman.
- **20 foto** punya letterbox/area kosong >30%.
- 14 foto berasal dari GitHub tanpa lisensi.

**Implikasi:** cukup untuk `gusi_*` dan `lidah_*` *setelah* dipisahkan manual, tetapi jumlah per kelas akan tipis (lihat §5).

### 4.2 `2_kaki` — 243 foto (C, 63)

**Kekuatan:** situs anatomi benar (kaki), 44 foto dari sumber dengan lesi kuku jelas.

**Kelemahan kritis:**
- **Banyak foto jarak jauh** (sapi berdiri, kuku kecil di frame) — tidak cukup untuk menilai stadium.
- **Lumpur menutupi lesi.** EuFMD (S3) mewajibkan kuku dibersihkan sebelum diperiksa; foto berlumpur tidak dapat distadium.
- Hanya **4 foto** berstadium.
- Risiko diagnosis banding: deformasi kuku, footrot, laminitis terlihat menyerupai lesi kronis PMK.
- 44 foto tanpa lisensi (Ashipunaz).

**Implikasi:** bagian dengan *framing* paling buruk. Perlu filter close-up + pembersihan visual.

### 4.3 `3_puting` — 11 foto (B mutu, n tidak layak)

**Kekuatan:** resolusi tinggi (median 1.944 px), lesi puting jelas, situs predileksi WOAH.
**Kelemahan:** hanya 11 foto; 1 letterbox; tidak ada kelas `puting` di taksonomi 13 kelas; risiko diagnosis banding (pseudocowpox, mammilitis ulseratif).
**Catatan metrik:** skor ketajaman Laplacian rendah (48) **bukan karena blur**, melainkan karena permukaan kulit halus tidak punya tekstur tepi. Secara visual foto tajam.

### 4.4 `4_belum_diketahui` — 816 foto (D, 33)

**Isi campuran:**
- **102 foto dapat dipindahkan otomatis** berdasarkan nama file: lidah 30, dental pad 50, moncong 10, gusi 1, puting 11 (11 puting = 1 "teat" + 10 "udder").
- **46 foto (5,6%) artefak berat** — letterbox/collage/screenshot >50%.
- 16 foto punya blok abu-abu >10% (14 di antaranya >25%) — kemungkinan masking/censor dari sumber.
- 8 foto nyaris grayscale.
- 61 foto blur.
- 121 foto tanpa lisensi (Ashipunaz).
- Sisanya: moncong close-up yang sebenarnya layak, dan whole-body yang tidak layak.

**Implikasi:** jangan dipakai sebelum disortir. Sekitar 50–60% berpotensi diselamatkan.

### 4.5 `5_sehat` — 484 foto (C, 55)

**Komposisi:** 322 foto Roboflow (`mulut_sehat`/`kuku_sehat`) + 162 foto Zenodo (whole-body di padang rumput).

**Kelemahan:**
- **Bias framing ekstrem:** median bbox `kuku_sehat` = **2,1%** dari frame; **179 dari 222 (81%)** bbox <3%. Artinya kaki sapi hanya menempati sebagian kecil gambar.
- 30 foto letterbox >30%, 24 foto blok abu-abu >10%, 11 blur.
- Status "sehat" hanya berasal dari label sumber, **bukan pemeriksaan klinis**.
- Ada foto yang justru menunjukkan perawatan (menyemprot ambing) — berpotensi salah label.

**Implikasi:** **jangan dijadikan kelas ke-14** tanpa desain ulang. Gunakan 322 foto close-up sebagai kontrol negatif saat evaluasi; buang 162 whole-body dari training.

---

## 5. Nilai per Kelas (13 Kelas Target)

| Kelas | Bahan potensial | Label final | Status |
|---|---:|---:|:---:|
| `air_liur_1` | ~35–50 | 0 | **D — belum siap** |
| `air_liur_2` | ~35–50 | 0 | **D — belum siap** |
| `air_liur_3` | ~35–50 | 0 | **D — belum siap** |
| `air_liur_4` | ~35–50 | 0 | **D — belum siap** |
| `gusi_1` | ~25–40 | 0 | **D — belum siap** |
| `gusi_2` | ~30–50 | 0 | **D — belum siap** |
| `gusi_3` | ~20–35 | 0 | **D — belum siap** |
| `lidah_1` | ~35–55 | 0 | **D — belum siap** |
| `lidah_2` | ~45–70 | 0 | **D — belum siap** |
| `lidah_3` | ~30–45 | 0 | **D — belum siap** |
| `kaki_1` | ~120–180 | 0 | **C — siap sebagian** |
| `kaki_2` | ~130–200 | 0 | **C — siap sebagian** |
| `kaki_3` | ~70–110 | 0 | **D — belum siap** |

> Angka "bahan potensial" adalah **proyeksi** setelah 65% isi `4_belum_diketahui` dianggap mulut dan 35% kaki, lalu dibagi rata per situs/stadium. Belum divalidasi manual.
>
> **Stadium tidak dapat diatribusikan per kelas:** dari 83 foto berstadium, 68 ada di bucket mulut, 4 di kaki, dan 11 di puting — tetapi situs pastinya (gusi vs lidah) belum diverifikasi. Karena itu kolom stadium per kelas sengaja tidak dicantumkan.

**Proyeksi kapasitas:**
- Mulut: 496 + ~511 = **~1.007 foto** untuk 10 kelas → **~100/kelas** (target LKP 140–190 → **kurang**).
- Kaki: 243 + ~275 = **~518 foto** untuk 3 kelas → **~172/kelas** (memenuhi target).

**Kelangkaan stadium (dari 83 foto berstadium):**

| Stadium EuFMD | n | Proporsi |
|---|---:|---:|
| S1 (hari 1) | 5 | 6% |
| S2 (hari 2–3) | 24 | 29% |
| S3 (hari 4–5) | 37 | 45% |
| S4 (hari ≥6) | 17 | 20% |

Stadium 1 adalah **kelas paling kritis secara klinis** (vesikel utuh = masa penularan tertinggi) tetapi paling sedikit datanya.

---

## 6. Temuan Kritis

### 6.1 Bias framing sehat vs sakit — bukti kuantitatif

Dari proyek Roboflow sendiri (1.195 gambar berlabel bbox):

| Kelas | n | Median luas bbox | bbox <3% | bbox ≥20% |
|---|---:|---:|---:|---:|
| `kuku_sakit` | 218 | 11,2% | 34 (16%) | 49 (22%) |
| `kuku_sehat` | 222 | **2,1%** | **179 (81%)** | 0 |
| `mulut_sakit` | 486 | 12,0% | 18 (4%) | 106 (22%) |
| `mulut_sehat` | 239 | **3,7%** | 46 (19%) | 7 (3%) |

**Artinya:** model dapat membedakan sehat vs sakit dari *komposisi gambar*, bukan dari lesi. Ini akan menghasilkan akurasi validasi tinggi tetapi **gagal total saat aplikasi menerima close-up dari peternak**. Wajib diuji dengan split berdasarkan framing, bukan split acak.

### 6.2 Ketidakselarasan taksonomi vs standar

| Kelas aplikasi | Dasar standar | Masalah |
|---|---|---|
| `air_liur_1-4` | WOAH: *hypersalivation/drooling* (kualitatif) | Tidak ada skala 4 tingkat resmi; batas antar-kelas harus didefinisikan sendiri |
| `gusi_1-3`, `lidah_1-3`, `kaki_1-3` | EuFMD: 1 hari / 2–3 / 4–5 / ≥6 hari | EuFMD punya **4 tahap**, aplikasi **3** → perlu pemetaan eksplisit |
| `puting` (11 foto) | WOAH: puting = situs predileksi | Tidak ada kelas tujuan |
| `sehat` (484 foto) | — | Tidak ada kelas tujuan |

**Usulan pemetaan yang dapat dipertahankan secara ilmiah:**

| Stadium aplikasi | Stadium EuFMD | Alasan |
|---|---|---|
| `*_1` | Hari 1 + Hari 2–3 | Fase vesikel/fresh rupture; akurasi EuFMD ±1 hari |
| `*_2` | Hari 4–5 | Fase fibrin/erosi aktif |
| `*_3` | Hari 6–7 + 8–10 + >10 | Fase penyembuhan; FAO menyatakan akurasi setelah hari 5 meleset ±3 hari, sehingga penggabungan sah |

**Definisi operasional `air_liur` yang diusulkan** (harus disepakati kelompok):
- `air_liur_1` = tidak ada liur berlebih.
- `air_liur_2` = liur menggantung <10 cm.
- `air_liur_3` = liur berbusa/menggantung >10 cm.
- `air_liur_4` = liur deras + busa menetes ke tanah/moncong.

### 6.3 Artefak teknis

| Bagian | n | letterbox >30% | letterbox >50% | blok abu >10% | blok abu >25% | nyaris abu-abu |
|---|---:|---:|---:|---:|---:|---:|
| `1_mulut_gusi_lidah` | 496 | 20 | 1 | 1 | 0 | 0 |
| `2_kaki` | 243 | 0 | 0 | 0 | 0 | 0 |
| `3_puting` | 11 | 1 | 1 | 0 | 0 | 0 |
| `4_belum_diketahui` | 816 | 93 | 46 | 16 | 14 | 8 |
| `5_sehat` | 484 | 30 | 14 | 24 | 19 | 5 |

**Resolusi:** median 300×300 di semua bagian (kecuali puting 1.944 px). Hanya ~16% foto ≥640 px. Cukup untuk input 224×224, tetapi ruang augmentasi (crop/rotate) terbatas.

### 6.4 Provenance & lisensi

| Sumber | n | Lisensi | Risiko |
|---|---:|---|---|
| Roboflow User YOLO | 854 | CC BY 4.0 | Rendah — cantumkan atribusi |
| FMD ComVis (devang03mgr) | 625 | Tidak ada file lisensi | Sedang — verifikasi ke pemilik |
| GitHub Ashipunaz | 179 | **Tidak ada LICENSE** | **Tinggi — jangan dipublikasikan tanpa izin** |
| Zenodo FMD_Cattle | 275 | Tidak ada file lisensi di arsip | Sedang — cek halaman record |
| Kaggle SkinDisease | 115 | Tidak jelas (repackaging EuFMD) | Sedang — rantai atribusi kabur |
| EuFMD Lesion Library | 2 | Atribusi wajib | Rendah |

### 6.5 Tidak ada konfirmasi laboratorium

Semua label "sakit" berasal dari label sumber, bukan PCR/ELISA. WOAH menegaskan PMK tidak dapat dipastikan secara visual. Karena itu:
- Metrik model harus dilaporkan sebagai **"deteksi suspek PMK"**, bukan diagnosis.
- Perlu persetujuan dokter hewan sebelum dataset dipakai untuk klaim akurasi.

---

## 7. Rekomendasi Berprioritas

| Prioritas | Tindakan | Dampak |
|---|---|---|
| **P0** | Tulis definisi operasional 13 kelas + tabel pemetaan EuFMD (§6.2) sebelum labeling | Mencegah 1.537 label dibuang |
| **P0** | Pindahkan 102 foto yang salah bucket (lidah 30, dental 50, moncong 10, gusi 1, puting 11) | +6,6% data mulut/puting |
| **P0** | Putuskan nasib `puting` (11) dan `sehat` (484): buang, jadikan kontrol evaluasi, atau kelas ke-14 | Menghindari label yatim |
| **P1** | Filter otomatis: buang 61 artefak >50% (46 di `belum`, 14 di `sehat`, 1 di `puting`), 33 blok abu >25%, 13 grayscale, ±196 blur | Menaikkan mutu teknis |
| **P1** | Kumpulkan minimal 100–140 foto stadium 1 (vesikel utuh) dari dinas/RSHP/dokter hewan | Menyelamatkan kelas `*_1` |
| **P1** | Uji *shortcut learning*: latih close-up, uji pada foto jarak jauh | Validasi klaim akurasi |
| **P2** | Hapus/izin ulang 179 foto Ashipunaz | Kepatuhan lisensi |
| **P2** | Tambah foto close-up sehat (bukan whole-body) | Menyeimbangkan framing |
| **P3** | Naikkan resolusi sumber (foto lapangan ≥1.000 px) | Ruang augmentasi |

---

## 8. Dampak ke LKP P6 (AI Feasibility Check)

PoC yang jujur dan tetap bisa dikerjakan **sekarang**:

1. **Gunakan 4 kelas proxy** dari proyek Roboflow sendiri: `mulut_sakit`, `mulut_sehat`, `kuku_sakit`, `kuku_sehat`.
2. **Split berkelompok** (bukan acak): kelompokkan berdasarkan sumber/framing, lalu uji pada kelompok yang belum pernah dilihat.
3. **Laporkan dua angka:**
   - akurasi pada split acak (akan terlihat tinggi),
   - akurasi pada split anti-shortcut (akan turun).
   - Selisih keduanya = **bukti bias framing**. Ini justru temuan yang kuat untuk LKP.
4. Tulis di Section 2: "target SRS belum dapat diklaim; dataset 13 kelas baru 0% berlabel; PoC proxy menunjukkan [angka]".

---

## 9. Batas Penilaian

- Ini **audit meja** (desk audit), bukan pemeriksaan histopatologi/lab.
- Penilaian stadium dan kesesuaian klinis **wajib ditandatangani dokter hewan** sebelum dipakai untuk klaim.
- Skor K1–K5 adalah penilaian terstruktur berbasis bukti visual + metrik, bukan diagnosis veteriner.

---

## Lampiran — Berkas Pendukung

| Berkas | Isi |
|---|---|
| `manifest.csv` | 2.050 baris metadata lengkap |
| `penilaian_metrik.csv` | Resolusi, ketajaman, kecerahan, kontras per foto |
| `penilaian_defek.csv` | Deteksi letterbox, blok abu-abu, framing per foto |
| `penilaian_bagian.csv` | Rekap skor 5 bagian |
| `labeling_template.csv` | 1.537 baris untuk diisi kelas final |
| `contact_sheet/` | 26 lembar visual (foto sakit) |
| `contact_sheet_extra/` | Lembar puting + sehat |
