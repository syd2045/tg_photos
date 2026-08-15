# Kirim ke Telegram — App Native (Auto-Sync)

App Android asli (bukan cuma web) yang bisa:
- Baca galeri foto HP langsung (lewat MediaStore, bukan cuma file picker)
- **Auto-sync di latar belakang** — mindai foto baru tiap interval waktu tertentu & kirim ke Telegram walau app ditutup
- Kirim manual dari dalam app (fitur lama tetap ada)
- Simpan Bot Token & Chat ID lokal di HP

Dibangun pakai Capacitor (bungkus web app jadi app Android asli) + plugin native Kotlin custom buat background sync-nya.

---

## Cara build APK — TANPA install Android Studio

Kamu cuma butuh akun GitHub (gratis). GitHub yang compile-in APK-nya di cloud lewat GitHub Actions.

### 1. Bikin repo baru di GitHub
Buka github.com → New repository → kasih nama misal `tg-uploader-app` → Create.

### 2. Upload semua file di folder ini ke repo itu
Cara termudah lewat browser (tanpa command line):
- Di halaman repo kosong tadi, klik **"uploading an existing file"**
- Drag & drop **semua isi folder ini** (termasuk folder `android`, `www`, `.github`, dan file `package.json`, `capacitor.config.ts`, `.gitignore`)
- Commit langsung ke branch `main`

> Kalau kamu lebih familiar pakai git di terminal, ini juga bisa: `git init && git add . && git commit -m "init" && git remote add origin <url-repo> && git push -u origin main`

### 3. Tunggu build otomatis jalan
- Buka tab **Actions** di repo GitHub kamu
- Akan ada workflow **"Build APK"** yang otomatis jalan setelah kamu push
- Tunggu ~3-5 menit sampai centang hijau ✅

### 4. Download APK-nya
- Klik workflow run yang sudah selesai (centang hijau)
- Scroll ke bagian **Artifacts** di bawah
- Download **app-debug-apk** (berupa file .zip, di dalamnya ada `app-debug.apk`)

### 5. Install ke HP
- Pindahkan `app-debug.apk` ke HP (lewat kabel data, Google Drive, atau kirim ke diri sendiri di Telegram 😄)
- Buka file-nya di HP → kalau muncul peringatan "sumber tidak dikenal", izinkan instal dari sumber ini
- Buka app → atur ⚙️ Bot Token & Chat ID seperti biasa → aktifkan toggle **Auto-Sync Galeri**

---

## Kalau mau ubah/setting ulang tiap kali push
Workflow di `.github/workflows/build-apk.yml` otomatis jalan tiap ada push ke branch `main`/`master`. Kalau mau trigger manual tanpa push, buka tab Actions → pilih workflow → **Run workflow**.

---

## Batasan yang perlu kamu tau

- **Interval minimum 15 menit.** Ini batasan resmi dari Android sendiri (`WorkManager`) untuk semua app, bukan keterbatasan app ini — supaya baterai HP nggak boros karena app kejar-kejaran cek storage tiap detik.
- **APK ini "debug build"**, belum ditandatangani buat rilis Play Store — tapi 100% berfungsi normal buat pemakaian pribadi/sideload. Kalau suatu saat mau publish ke Play Store, perlu proses signing tambahan (bisa saya bantu kalau perlu).
- Auto-sync baseline-nya mulai dari **waktu pertama kali diaktifkan** — foto lama di galeri nggak ikut ke-upload otomatis (biar nggak spam ratusan foto lama ke chat Telegram sekaligus). Foto lama tetap bisa dikirim manual lewat fitur "Pilih Foto/Folder" di halaman utama.
- Auto-sync butuh izin akses galeri (diminta otomatis pertama kali toggle diaktifkan).
