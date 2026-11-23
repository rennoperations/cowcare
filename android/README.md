# CowCare untuk Android

Aplikasi Android (Java, tanpa library tambahan, Android 7.0+/API 24) yang membawa antarmuka
dan model AI dari folder `../web` di dalam APK. Semua proses berjalan di HP:
aplikasi **tidak meminta izin INTERNET**, sehingga foto dan riwayat tidak bisa terkirim keluar.

## Cara mendapatkan APK

**Otomatis (disarankan).** Setiap push ke `main` yang mengubah `web/` atau `android/` menjalankan
GitHub Actions *Build APK Android*. Unduh `CowCare-apk` dari tab **Actions** → run terbaru → *Artifacts*.
Untuk rilis, buat tag `v1.0.0`; APK akan dilampirkan di halaman **Releases**.

**Manual.** Buka folder `android/` di Android Studio (JDK 17), lalu *Build → Build APK(s)*. Atau:

```
cd android
./gradlew assembleDebug        # hasil: app/build/outputs/apk/debug/app-debug.apk
```

## Memasang di HP

Kirim berkas APK ke HP, buka, lalu izinkan "Instal aplikasi tidak dikenal" untuk aplikasi
yang membuka berkas (mis. File Manager/WhatsApp).

## Catatan rilis

APK saat ini ditandatangani kunci debug. Sebelum unggah ke Play Store, buat keystore kelompok
(`keytool -genkey ...`), tambahkan `signingConfigs.release`, dan simpan kata sandinya sebagai GitHub Secrets.

## Struktur

- `app/src/main/java/.../MainActivity.java`: WebView yang melayani `assets/www` dari
  `https://appassets.androidplatform.net/`, kamera/galeri, dan jembatan `CowCareAndroid`
  (bagikan hasil, telepon dokter hewan, simpan CSV).
- `app/src/main/java/.../SharedFileProvider.java`: berbagi foto kamera dan CSV lewat izin URI sementara.
- Berkas web disalin otomatis ke `assets/www` oleh tugas Gradle `copyWebAssets`.
