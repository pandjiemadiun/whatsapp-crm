---
RAILS.md — KONTRAK KERJA AI UNTUK PROYEK GARUDA CRM
Dibaca WAJIB oleh setiap AI (Claude, AI CLI/robot coding, siapa pun)
di awal SETIAP sesi, sebelum membaca file lain, sebelum bertindak.
Jika ada isi yang bentrok dengan STATUS-V2.md, file INI yang menang
untuk soal PROSES/ATURAN. STATUS-V2.md tetap sumber kebenaran untuk
STATE TEKNIS (apa yang sudah fix, apa yang belum).
---

## 0. KENAPA FILE INI ADA

Owner (Panji) sudah 3+ hari mengalami pola: AI bilang "siap/aman/lanjutkan
saja", lalu ternyata konteks hilang, kerjaan muter-muter, bug lama muncul
lagi. File ini ada untuk membuat itu TIDAK MUNGKIN terjadi lagi, dengan
memaksa setiap klaim dibuktikan, bukan diucapkan.

## 1. ATURAN MUTLAK UNTUK AI — TIDAK BOLEH DILANGGAR

1. **DILARANG mengatakan "aman", "siap", "sudah fix", "lanjutkan saja",
   atau kata sejenis TANPA menempelkan bukti mentah** (output command
   verifikasi: tsc, test runner, curl+log grep, git diff). Kalimat
   keyakinan tanpa bukti = pelanggaran kontrak ini.
2. **DILARANG mengklaim TASK selesai** kecuali SEMUA acceptance
   criteria di TASK prompt sudah dicek satu-satu dan hasilnya
   ditempel verbatim (bukan diringkas jadi "semua lulus").
3. **DILARANG menyimpulkan root cause tanpa membaca kode sumber
   langsung** (file:line). Dugaan/tebakan harus ditandai eksplisit
   "[DUGAAN, belum diverifikasi]" — tidak boleh disamarkan sebagai
   fakta.
4. **DILARANG mengubah file di luar scope TASK yang sedang dikerjakan.**
   Kalau ketemu bug lain saat bekerja, CATAT di STATUS-V2.md bagian
   "Ditemukan saat kerja, belum ditangani" — jangan langsung diperbaiki
   di luar scope.
5. **DILARANG memulai TASK baru sebelum TASK sebelumnya di-commit**
   dengan git status bersih dan STATUS-V2.md sudah di-update dengan
   hasil TASK itu (bukan cuma "done", tapi: apa yang berubah, apa
   yang diverifikasi, apa yang masih risiko).
6. Setiap sesi baru WAJIB mulai dengan: baca file ini → baca
   STATUS-V2.md → jalankan `git status` → laporkan temuan ke owner
   SEBELUM mengusulkan langkah apa pun.
7. Kalau AI tidak yakin, AI HARUS bilang tidak yakin dan bertanya —
   bukan menebak lalu bicara seolah yakin.

## 2. VERDICT ARSITEKTUR SAAT INI (hasil audit 9 Agu 2026)

Akar masalah "chatbot kaku, tambal-sulam tanpa akhir" BUKAN semata
"kelewat banyak keyword". Akar sebenarnya: **boundary antar-layer
rusak** — beberapa komponen sekaligus jadi pengambil-keputusan
semantik, fallback, executor, DAN persistence. Tidak ada satu sumber
kebenaran untuk keputusan percakapan.

Temuan kritis terverifikasi dari audit source code penuh (lihat
riwayat chat 9 Agu untuk detail file:line):
- V2 bisa mutate DB lalu exception → fallback ke V1 → V1 proses ulang
  pesan yang sama → berpotensi DOBEL mutasi cart/order. [PALING BAHAYA]
- `updateExtractedEntities` di jalur v2 adalah NO-OP (type mismatch) —
  v2 kehilangan memori antar-turn secara diam-diam.
- I13 ("angka wajib dari DB") TIDAK konsisten: `validateCartOpsAgainstDb`
  ada di kode tapi tidak dipanggil; sebagian jalur v1 pakai harga dari
  LLM langsung.
- I8 ("maks 1 LLM/pesan") dilanggar: retry transport di interpreter.ts
  + LLM kedua tersembunyi di `orderService.extractAndSaveOrder()`.
- Shadow mode v2 selalu gagal diam-diam (type mismatch context).
- `modifyCart` read-modify-write tidak transactional → race condition.

## 3. ROADMAP WAJIB, URUTAN INI TIDAK BOLEH DILOMPAT

- [x] **P0 — Safety boundary**: V2 tidak boleh fallback ke V1 setelah
      V2 sudah melakukan mutation. SELESAI & VERIFIED, commit fc39404
      (9 Agu 2026). TASK 0 (jest runner) ikut selesai di commit sama.
- [ ] **P1 — Semantic authority** (sedang berjalan, bertahap per-file):
      - [x] Langkah 1: tryProduct confidence gate (cegah substring
        guess, mis. "ram"⊂"Brambang"). TASK B1, commit e529466 +
        aa474cb (rebuild dist). VERIFIED end-to-end production
        (9 Agu 2026) — lihat log keputusan di bawah.
      - [ ] Langkah 2+: tier lain di fallback.service.ts
        (tryCatalog/tryShipping/tryPayment/tryTotal), fast-path
        isOrderIntent/isMultiProductOrder guard, reasoning.ts sebagai
        satu-satunya penentu final. Belum digarap.
- [ ] **P2 — Truth boundary**: executor menolak harga yang tidak sama
      dengan DB (bukan cuma "ambil dari catalog jika sempat").
- [ ] **P3 — Context boundary**: WorkspaceV2 dan legacy
      ExtractedEntities dipisah bersih, tidak saling timpa diam-diam.
- [ ] **P4 — Remove second brain**: `extractAndSaveOrder()` berhenti
      jadi interpreter kedua untuk pesan yang sudah diproses V2.
- [ ] **P5 — Response naturalness**: baru sekarang composer-v2 dibedah
      untuk jadi lebih natural/dinamis (bukan sebelum P0-P4 selesai).
- [ ] **P6 — Golden dataset sebagai architecture gate**, bukan sekadar
      regression test kosmetik.

Prinsip trade-off yang owner tetapkan eksplisit: **robustness dan
natural language understanding > biaya LLM.** I8 (maks 1 LLM/pesan)
BUKAN lagi hard constraint, jadi guideline efisiensi yang boleh
dilanggar demi jawaban benar. I13 (angka wajib dari DB) TETAP
non-negotiable — ini soal integritas transaksi, bukan gaya bicara.

## 4. FORMAT LOG KEPUTUSAN (tambahkan entri baru di bawah, JANGAN edit yang lama)

```
### [tanggal] — [judul keputusan]
Konteks:
Keputusan:
Alasan:
Siapa yang setuju: (owner/Claude/AI CLI)
```

### 9 Agu 2026 — Rekonsiliasi roadmap LAMA vs P0-P6
Konteks: Roadmap asli (sebelum audit GPT) adalah: (1) TASK 9 golden
dataset, (2) normalizer slang I11 + guard nama produk I12, (3)
eskalasi ke pemilik toko, (4) PWA Web Chatbox. Setelah audit
arsitektur menemukan masalah lebih dasar, disepakati P0-P6
menggantikan urutan ini — tapi pemetaan eksplisit sempat tidak
tertulis, nyaris jadi item hilang. Pemetaan final:
- Golden dataset → jadi P6 (akhir, architecture gate), BUKAN dihapus.
- I11 (normalizer slang) → SUDAH ADA & TERUJI. Bukti:
  normalizer.test.ts "toralin brp -> total berapa" PASS, "typo
  dictionary >= 30 entri" PASS (terlihat konsisten di setiap test run
  sejak awal thread). Belum ada verifikasi e2e/golden dataset khusus
  untuk ini, tapi unit-level sudah jalan — TIDAK perlu dikerjakan
  ulang dari nol.
- I12 (guard nama produk tidak berubah saat normalisasi) → SUDAH ADA
  & TERUJI. Bukti: normalizer.test.ts "berasss ada? -> berasss ada?
  (I12: produk tidak diubah)" PASS.
- Eskalasi ke pemilik toko → SEBAGIAN ADA. validator-v2.test.ts
  punya I-V2-4 (attempts>CLARIFICATION_MAX_ATTEMPTS -> eskalasi,
  outcome berubah) PASS — tapi BELUM DIVERIFIKASI apakah ini benar-
  benar memicu human_takeover/notifikasi ke owner, atau cuma
  mengubah outcome tanpa efek nyata. STATUS: perlu audit terpisah,
  masukkan sebagai TASK setelah P1 selesai.
- PWA Web Chatbox → tetap terakhir, tidak berubah, post-stabil.
Keputusan: item lama TIDAK hilang, sudah dipetakan ulang. Prioritas
tetap ikuti urutan P0-P6 (sedang di P1), tapi "audit eskalasi ke
owner" ditambahkan sebagai item antrian setelah P1 selesai, sebelum
P2, karena scope-nya kecil dan bisa jadi cepat.
Siapa yang setuju: owner (Panji), Claude.

### 9 Agu 2026 — Temuan hygiene: dist/ dan logs/ ter-track di git
Konteks: git status berulang kali menunjukkan apps/api/dist/* dan
apps/api/logs/*.log sebagai "modified" — artinya kedua folder ini
DI-TRACK oleh git, padahal itu build artifact dan runtime log.
Risiko: logs/*.log berpotensi berisi data sensitif customer (nomor WA,
isi pesan) ter-commit ke history git selamanya; dist/* berpotensi
drift dari source kalau ada yang commit tanpa rebuild.
Keputusan: BELUM diperbaiki — jangan `git rm --cached` sembarangan
sebelum dipastikan apakah pm2 production menjalankan dist/ yang
di-commit tanpa proses build/deploy otomatis (kalau iya, menghapus
dari git tanpa alur deploy yang benar bisa bikin server tidak punya
dist/ saat fresh clone/deploy). Ini TASK KECIL TERPISAH, non-blocking
untuk P1, dikerjakan kapan saja sebelum makin banyak data sensitif
ter-commit. Status: DIKETAHUI, BELUM DIKERJAKAN.
Siapa yang setuju: owner (Panji), Claude.

### 9 Agu 2026 — Bukti mentah TASK 0 + TASK A tersimpan di thread chat
Catatan penting untuk sesi/thread manapun yang membaca ini: bukti
verbatim lengkap (output `npm run test:chat`, git diff, git status,
commit log) untuk TASK 0 dan TASK A ADA, tapi tersimpan di histori
percakapan claude.ai tanggal 9 Agu 2026 (thread "audit arsitektur
Garuda"), BUKAN di-paste ulang di sini secara verbatim karena
panjang. Ringkasan hasil (untuk cross-check cepat, TETAP minta
re-run kalau butuh bukti fresh — jangan percaya ringkasan ini
sebagai pengganti bukti):
`npm run test:chat -- src/services/chat/__tests__` di commit fc39404
→ Test Suites: 2 failed, 19 passed, 21 total; Tests: 1 failed,
185 passed, 186 total. 2 gagal = reasoning-v2 (I-V2-6 label mismatch,
pre-existing) + engine-config-v2 (circular dep redisAdapter,
file-level, pre-existing). safety-boundary-v2.test.ts PASS 5/5.
Kalau butuh bukti ulang: jalankan lagi command yang sama di server,
jangan asumsi hasil ini masih berlaku kalau ada commit baru sesudah
fc39404.

### 9 Agu 2026 — TASK B1 VERIFIED e2e + TEMUAN: unit test pass ≠ production berubah
Konteks: TASK B1 (gate confidence tryProduct, cegah substring match
seperti "ram"⊂"Brambang") sudah 11/11 unit test pass dan commit
e529466, tapi saat dicoba manual di WA/curl production, bug ASLI
MASIH terjadi ("ram" → jawab "Brambang" harga). Investigasi: dist/
belum di-rebuild sejak commit (npm run build tidak pernah dijalankan
robot setelah TASK B1, cuma `tsc --noEmit` yang tidak generate file),
pm2 masih jalankan kode lama. Setelah `npm run build` + `pm2 restart
api` manual, query "ram" ulang → balasan generic, TIDAK lagi sebut
Brambang. Confirmed fix bekerja di production.
Keputusan: TAMBAHKAN ke acceptance criteria SEMUA TASK ke depan yang
menyentuh src/business/*.ts atau src/services/**/*.ts: WAJIB
`npm run build && pm2 restart api` sebagai langkah eksplisit sebelum
klaim selesai, BUKAN cuma `tsc --noEmit`. tsc --noEmit hanya validasi
tipe, TIDAK generate dist/ — ini beda fundamental yang harus selalu
dicek. Root cause pola ini: robot terbiasa pakai tsc --noEmit sebagai
"proof of correctness" tapi lupa itu tidak mengubah apa yang pm2
jalankan.
Bukti e2e: sebelum rebuild → "Halo Kak! Untuk *Brambang* harganya
Rp 30.000..."; sesudah rebuild+restart → "Halo, selamat datang! Apa
yang bisa saya bantu hari ini?" (generic, bukan salah-jawab produk).
Siapa yang setuju: owner (Panji), Claude — berdasarkan test end-to-end
nyata, bukan cuma unit test.

### 9 Agu 2026 — TASK 0 + TASK A VERIFIED dengan bukti mentah
Konteks: Setelah beberapa ronde bukti gagal (screenshot OCR dengan
matematika tidak konsisten, klaim yang tidak match git diff), akhirnya
didapat output jest mentah langsung dari terminal.
Bukti: `npm run test:chat -- src/services/chat/__tests__` →
Test Suites: 2 failed, 19 passed, 21 total (2+19=21 ✓)
Tests: 1 failed, 185 passed, 186 total (1+185=186 ✓)
2 kegagalan PERSIS sama dengan yang sudah diketahui sejak sebelum
TASK 0/TASK A: reasoning-v2.test.ts (I-V2-6 outcome label mismatch,
test lama vs desain baru) dan engine-config-v2.test.ts (circular dep
redisAdapter, file-level, tak terkait chat logic). TIDAK ADA kegagalan
baru. safety-boundary-v2.test.ts PASS 5/5 termasuk test yang membaca
source asli conversation.service.ts untuk konfirmasi guard terpasang.
package.json diff dikonfirmasi minimal (1 script baru test:chat, 3
devDependency di-pin: jest, ts-jest, @types/jest). conversation.service.ts
dikonfirmasi utuh (50KB, diff sesuai desain TASK A, tidak ada
penghapusan seperti yang sempat diklaim laporan OCR sebelumnya —
klaim itu terbukti salah/halusinasi).
Keputusan: TASK 0 dan TASK A resmi VERIFIED. Lanjut ke commit lalu P1.
Siapa yang setuju: owner (Panji), Claude — berdasarkan bukti terminal
mentah, bukan ringkasan AI mana pun.

### 9 Agu 2026 — TEMUAN KRITIS: tidak ada test runner terpasang
Konteks: Saat memverifikasi TASK A, ditemukan `npx jest` gagal parse
SEMUA file test (21 test suite, 0 tests run) dengan error babel parser.
Investigasi lanjutan: `package.json` "test" script memakai `tsx --test`
(Node built-in test runner) untuk 3 file tidak terkait (date-range,
analytics, batch-magic-paste) — TIDAK ADA script untuk chat engine.
`node_modules` TIDAK punya jest/vitest/mocha sama sekali (dicek
langsung, kosong). 21 file test di src/services/chat/__tests__/ ada
secara fisik tapi TIDAK ADA cara valid menjalankannya di proyek ini
saat ini.
Keputusan: SEMUA klaim "test lulus" untuk chat engine v2 sejak TASK 8
ke belakang (termasuk di STATUS-V2.md) berstatus TIDAK TERVERIFIKASI
ULANG sampai ada test runner nyata yang terpasang dan dikonfirmasi
bisa menjalankan file-file ini. Ini menjadi TASK 0 — prioritas di atas
TASK A. TASK A tidak boleh ditandai selesai sampai TASK 0 kelar dan
safety-boundary-v2.test.ts benar-benar jalan (bukan cuma tsc bersih).
Alasan: tanpa test runner yang benar-benar berfungsi, tidak ada cara
membuktikan APAPUN yang diklaim "lulus" — ini akar structural dari
pola trauma "AI bilang aman tapi ternyata tidak".
Siapa yang setuju: owner (Panji), Claude.

### 9 Agu 2026 — Urutan P0→P6 ditetapkan
Konteks: Audit penuh source code oleh AI CLI menemukan boundary
antar-layer rusak, bukan sekadar keyword overload.
Keputusan: Kerjakan P0-P6 berurutan, tidak boleh lompat ke semantic
refactor (P1+) sebelum P0 (safety boundary) selesai dan terverifikasi.
Alasan: P0 adalah risiko data-corruption aktif di production canary;
P1-P6 adalah soal kualitas, bisa ditunda tanpa merusak data customer.
Siapa yang setuju: owner (Panji), Claude, AI CLI (GPT).

## 5. DEFINISI "SELESAI" UNTUK SATU TASK

Sebuah TASK dianggap selesai HANYA jika semua ini ada, ditempel
verbatim (bukan diringkas):
1. Output `npx tsc --noEmit` (harus 0 error)
2. Output `npm run build` (WAJIB, bukan cuma --noEmit — --noEmit TIDAK
   generate dist/, pm2 tetap jalankan kode lama kalau ini dilewat.
   Ditemukan nyata di TASK B1, 9 Agu 2026: unit test 11/11 pass tapi
   production masih pakai kode lama karena langkah ini terlewat.)
2. Output test suite lengkap (pass/fail count, termasuk pre-existing
   failure yang sudah diketahui)
3. Output `git diff --stat` (bukti scope tidak melebar)
4. Konfirmasi `pm2 restart api` sukses + tidak crash loop
5. Untuk perubahan yang menyentuh side-effect (DB write, WA send):
   bukti test manual WA nyata ATAU test otomatis yang mensimulasikan
   skenario itu secara eksplisit.

Tanpa kelima ini, status TASK = "BELUM SELESAI", titik.
