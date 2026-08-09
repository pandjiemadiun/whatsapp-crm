TASK 0: Pasang test runner nyata untuk chat engine (P-1, blocker)

SCOPE: package.json (devDependencies + scripts) + file config test baru
(jest.config.* atau setara). JANGAN ubah logic di
src/services/chat/*.ts atau src/business/conversation.service.ts.
JANGAN ubah isi 21 file test yang sudah ada di
src/services/chat/__tests__/ kecuali kalau memang error TYPO/IMPORT
kecil yang mencegahnya di-parse — kalau begitu, laporkan tiap
perubahan satu-satu, jangan diam-diam.

MASALAH:
- `npx jest` di proyek ini gagal parse semua file .ts (21 suite, 0
  test run) — sepertinya narik Jest generik dari npm registry tanpa
  transform TypeScript yang benar.
- node_modules TIDAK punya jest/vitest/mocha terpasang lokal.
- package.json script "test" hanya untuk 3 file tidak terkait
  (tsx --test), tidak mencakup chat engine sama sekali.
- 21 file test untuk chat engine v2 ADA secara fisik tapi tidak
  pernah bisa dijalankan dengan setup yang ada sekarang.

YANG DIMINTA:
1. Cek dulu: baca beberapa file test (fast-path-v2.test.ts,
   safety-boundary-v2.test.ts) untuk identifikasi syntax yang dipakai
   (describe/it/expect ala Jest? atau built-in `node:test` ala
   date-range.test.ts yang sudah ada?). Laporkan temuan ini duluan
   sebelum instal apa pun.
2. Kalau syntax-nya Jest-style (describe/it/expect global) — install
   jest + ts-jest (atau @swc/jest, pilih yang lebih cepat) sebagai
   devDependency dengan versi di-pin eksplisit (bukan "latest"),
   tambahkan jest.config.ts/js yang benar untuk resolve TypeScript +
   path proyek ini, dan tambahkan script baru di package.json:
   "test:chat": "jest src/services/chat" (JANGAN timpa script "test"
   yang sudah ada untuk file lain).
3. Jalankan `npm run test:chat` dan pastikan MINIMAL semua 21 file
   ter-parse tanpa syntax error (walau ada test yang fail secara
   assertion, itu OK — yang penting bukan gagal parse lagi).
4. Baseline check: `git stash` ke commit SEBELUM TASK A
   (3dd4440 atau sebelum perubahan conversation.service.ts terakhir),
   jalankan test:chat, catat hasil MENTAH (pass/fail per suite).
   `git stash pop` untuk kembali ke state sekarang, jalankan test:chat
   lagi, catat hasil MENTAH. Bandingkan: suite/test mana yang berubah
   status (baru fail, baru pass, tetap sama).

ACCEPTANCE CRITERIA:
- `npm run test:chat` bisa dieksekusi tanpa syntax/parse error di
  semua 21 file.
- Output MENTAH (bukan ringkasan) dari kedua run (baseline vs
  sekarang) ditempel utuh.
- package.json diff ditunjukkan (git diff package.json).
- Konfirmasi tidak ada perubahan ke file src/services/chat/*.ts atau
  conversation.service.ts di luar yang sudah di-commit TASK A
  sebelumnya (git diff --stat harus bersih untuk file-file itu).

LARANGAN:
- Jangan install versi "latest" tanpa pin — proyek harus reproducible.
- Jangan ubah logic test assertion untuk membuat test "lulus" secara
  artifisial.
- Jangan commit sebelum saya (Claude) review hasil mentahnya.

LAPORKAN: temuan syntax test (langkah 1), package.json diff, config
test yang ditambahkan, output mentah baseline vs sekarang.
