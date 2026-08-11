TASK B1: P1 Semantic Authority — Langkah 1: Perketat tryProduct
(cegah tebak-tebak substring, mis. bug "Brambang" nyantol di query
tak relevan)

KONTEKS UNTUK ROBOT: Baca dulu RAILS.md dan STATUS-V2.md di root
repo sebelum mulai. Wajib patuhi aturan RAILS.md — semua klaim harus
dibuktikan output mentah, jangan ringkas jadi "semua lulus".

SCOPE: HANYA apps/api/src/services/chat/fallback.service.ts (fungsi
tryProduct dan fungsi scoring produk yang dipakainya, sekitar baris
~242 dan sekitarnya — cari sendiri lokasi pastinya dengan grep,
jangan asumsi nomor baris dari dokumen lama sudah akurat). Boleh
tambah file test baru di
apps/api/src/services/chat/__tests__/tryproduct-threshold.test.ts.
JANGAN ubah fast-path.ts, reasoning.ts, validator-v2.ts,
composer-v2.ts, conversation.service.ts, atau tier lain
(tryCatalog/tryShipping/tryPayment/tryTotal) di fallback.service.ts —
itu di luar scope TASK ini.

MASALAH:
tryProduct saat ini melakukan substring scoring nama produk terhadap
kata-kata di pesan customer. Ini bisa membuat produk seperti
"Brambang" ke-trigger untuk pesan yang sama sekali tidak menyinggung
produk itu (mis. gara-gara token pendek/umum ikut ke-match). Karena
tryProduct dipanggil sebagai TIER (fast-path, sebelum LLM), match
yang salah ini langsung dijawab ke customer tanpa verifikasi lebih
lanjut — LLM (reasoning.ts) tidak pernah dapat kesempatan menilai
ulang.

PRINSIP PERBAIKAN (baca RAILS.md bagian 2 untuk konteks lengkap):
fallback tier BOLEH menjawab HANYA kalau yakin (high-confidence
match). Kalau tidak yakin, tier harus MISS (return hit:false),
supaya pesan diteruskan ke reasoning.ts (LLM) yang punya konteks
lebih lengkap untuk menilai — LLM lalu bisa menjawab langsung atau
minta klarifikasi. Fallback bukan lagi otoritas semantik untuk kasus
ambigu, cuma untuk kasus yang sudah pasti.

PERUBAHAN YANG DIMINTA:
1. Definisikan level confidence match secara eksplisit, urutan dari
   tertinggi:
   a. EXACT match (case-insensitive, whole word/token) → confidence
      tinggi, BOLEH jawab langsung.
   b. Fuzzy match sangat dekat (mis. Levenshtein distance <= 1 ATAU
      nama produk match >90% dari token pesan) DAN nama produk itu
      adalah SATU-SATUNYA kandidat match di catalog untuk pesan itu
      → BOLEH jawab langsung.
   c. Selain itu (substring parsial, banyak kandidat match, atau
      confidence rendah) → JANGAN jawab. return hit:false (miss).
2. Pastikan constant/threshold-nya bernama jelas (mis.
   PRODUCT_MATCH_EXACT, PRODUCT_MATCH_FUZZY_MAX_DISTANCE) dan
   punya komentar kenapa nilainya segitu.
3. JANGAN ubah perilaku untuk kasus yang SUDAH BENAR sekarang (exact
   match nama produk tetap harus tetap kerja seperti biasa — ini
   TIGHTENING, bukan mematikan tier).
4. Kalau tryProduct return miss karena confidence rendah, pastikan
   TIDAK ada side effect (jangan saveDiscussedItems, jangan apa pun)
   — treat sepenuhnya seperti tier lain yang miss.

ACCEPTANCE CRITERIA:
- Test baru (tryproduct-threshold.test.ts) HARUS mencakup:
  a. Query exact match produk (mis. "ada kentang?") → tier hit,
     jawab langsung, seperti sebelumnya (regresi negatif = FAIL).
  b. Query dengan token yang ambigu/substring-only, DAN produk yang
     jadi contoh bug asli (nama produk yang gampang ke-trigger
     salah, misal produk dengan nama pendek/umum di catalog test) →
     harus MISS (hit:false), bukan menjawab produk yang salah.
  c. Query yang sama sekali tidak menyebut produk apa pun → tetap
     miss seperti sebelumnya.
- Semua 21 test suite existing di src/services/chat/__tests__/ tetap
  jalan tanpa kegagalan BARU. 2 kegagalan pre-existing yang sudah
  diketahui (reasoning-v2 "terminal low confidence", engine-config-v2
  redisAdapter circular dep) tetap boleh gagal, JANGAN diperbaiki di
  TASK ini (di luar scope).
- npx tsc --noEmit → 0 error.
- git diff --stat menunjukkan HANYA fallback.service.ts (dan file
  test baru) yang berubah — tidak ada file lain.

LARANGAN:
- Jangan sentuh file lain di luar yang disebutkan.
- Jangan ubah signature/return type tryProduct yang dipakai caller
  lain — cuma logic internal confidence-nya yang berubah.
- Jangan commit sebelum saya (Claude, via Panji) review bukti mentah.

VERIFIKASI YANG WAJIB DIJALANKAN DAN DILAPORKAN MENTAH (bukan
ringkasan, tempel output asli):
1. cd /home/ubuntu/garuda/apps/api && npx tsc --noEmit
2. npm run test:chat -- src/services/chat/__tests__ 2>&1 | tee /tmp/taskb1-test.txt
   (lalu tempel isi /tmp/taskb1-test.txt lengkap, JANGAN dipotong di
   bagian summary saja — sertakan juga log per-suite)
3. git diff --stat
4. git diff apps/api/src/services/chat/fallback.service.ts (diff
   lengkap, biar Claude bisa review logic-nya langsung)
5. Test manual satu pesan real via curl ke webhook (pakai store
   canary store-f7140b5c, message_id UNIK), untuk salah satu kasus
   query ambigu dari test (b) di atas — lalu grep log
   "Engine v2 active" atau cek balasan di dashboard, tempel hasilnya.

JANGAN klaim TASK selesai tanpa kelima bukti di atas ditempel utuh.
