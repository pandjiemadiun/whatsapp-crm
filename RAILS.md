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

- [ ] **P0 — Safety boundary**: V2 tidak boleh fallback ke V1 setelah
      V2 sudah melakukan mutation. (TASK A, sedang dikerjakan robot)
- [ ] **P1 — Semantic authority**: reasoning.ts jadi SATU-SATUNYA
      penentu intent/entity di v2. Fast-path dipersempit jadi murni
      pending-resolver deterministik. Fallback tiers berhenti
      "menjawab", hanya jadi data-retrieval setelah intent jelas.
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

### 9 Agu 2026 — TASK 0: syntax & runner finding (laporan step-1)
Konteks: TASK 0 menugaskan baca sampai 2 file (fast-path-v2,
safety-boundary-v2) agar memastikan syntax sebelum install apapun.
Keputusan: SEMUA 21 file di src/services/chat/__tests__ memakai
`node:test` (import { describe, it } from 'node:test' + node:assert),
BUKAN Jest globals (tidak ada `expect`, tidak ada global describe/it).
Verifikasi: `grep -l "\bexpect("` = nol; 21/21 file import node:test.
`npx tsx --test` (Node built-in runner) sudah terbukti jalan.
Karena eksplisit pakai import binding (bukan global), file sama persis
akan dieksekusi di bawah Jest lewat binding yang sama → hasil pass/fail
akan identit tsx↔jest ASAL jest+ts-jest terpasang.
Maka: pasang jest@29.7.0 + ts-jest + jest.config.ts; script
"test:chat" (tidak timpa "test"). Tak perlu konversi test file.
Alasan: reproducibility (pin versi), owner minta jest.config, 0 dep sebelumnya.
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
2. Output test suite lengkap (pass/fail count, termasuk pre-existing
   failure yang sudah diketahui)
3. Output `git diff --stat` (bukti scope tidak melebar)
4. Konfirmasi `pm2 restart api` sukses + tidak crash loop
5. Untuk perubahan yang menyentuh side-effect (DB write, WA send):
   bukti test manual WA nyata ATAU test otomatis yang mensimulasikan
   skenario itu secara eksplisit.

Tanpa kelima ini, status TASK = "BELUM SELESAI", titik.
