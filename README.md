# NutriTrack – paket deploy Vercel

Isi paket:
- `index.html`        : seluruh aplikasi (satu berkas, CSS sudah dikompilasi, tanpa CDN Tailwind)
- `food-master.json`  : master Food Database awal (kosong = hanya 18 item bawaan). Diisi dari "Ekspor Master Data".
- `vercel.json`       : header keamanan dasar

Data awal: kosong (tanpa catatan makanan, air, berat, resep, target). Akun dibuat saat login pertama.

## Deploy (tanpa build)
1. Upload keempat berkas ke repository GitHub (atau pakai Vercel CLI: `vercel --prod` di folder ini).
2. Vercel -> Add New -> Project -> pilih repository.
3. Framework Preset: Other. Build Command: kosongkan. Output Directory: kosongkan (root). Klik Deploy.

## Mengisi master Food Database
1. Di sistem lama: Settings -> Unduh Cadangan (.json).
2. Di situs baru: login -> Food Database -> Impor Data -> pilih berkas cadangan -> Periksa Data -> Impor & Timpa.
   (Hanya bagian Food Database yang diambil; jurnal, air, berat, profil tidak ikut.)
3. Food Database -> Ekspor Master Data -> simpan sebagai `food-master.json`.
4. Ganti `food-master.json` di repository dengan berkas itu, lalu commit. Vercel otomatis deploy ulang.
   Browser baru yang membuka situs pertama kali akan otomatis memuat master tersebut.

## Catatan penting
- Data pengguna tersimpan di browser (localStorage) per domain dan perangkat. Tidak ada server/database.
- Untuk pindah perangkat: Settings -> Cadangan dan Pemindahan Data (ekspor, lalu impor di perangkat lain).
- Akun login hanya ada di perangkat itu (bukan autentikasi server).
