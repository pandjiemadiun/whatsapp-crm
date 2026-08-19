---
RAILS.md — KONTRAK KERJA AI UNTUK PROYEK GARUDA CRM
Dibaca WAJIB oleh setiap AI (Claude, AI CLI/robot coding, siapa pun)
di awal SETIAP sesi, sebelum membaca file lain, sebelum bertindak.
Jika ada isi yang bentrok dengan STATUS-V2.md, file INI yang menang
untuk soal PROSES/ATURAN. STATUS-V2.md tetap sumber kebenaran untuk
STATE TEKNIS (apa yang sudah fix, apa yang belum).

REWRITE TOTAL 10 Agu 2026: struktur ditata ulang (status/roadmap
dipindah ke atas biar tidak perlu scroll ratusan baris untuk tahu
posisi terkini). SEMUA entri log keputusan lama dipertahankan
VERBATIM di §6 — tidak ada yang dihapus/diubah, hanya dipindah
posisi. Aturan §1 dan audit §2 tidak berubah isi.
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
8. **Saat ada masalah/incident di server (file rusak, state tidak
   jelas, dst), WAJIB langsung ambil opsi paling tegas/simple yang
   tersedia (mis. `git reset --hard` + `git clean -fd` ke commit sehat
   terakhir), bukan tambal per-file lalu eskalasi bertahap ke opsi
   tegas setelah gagal berkali-kali.** Satu blok command lengkap dari
   diagnosis sampai verifikasi akhir dalam satu balasan — minimalkan
   jumlah putaran owner harus paste-balas. (Ditambahkan setelah
   insiden restore TASK B4, lihat §6.)
9. **TASK yang scope-nya bisa dipecah per-unit kerja kecil (per-tier,
   per-file, per-fitur) WAJIB dipecah dan di-commit per-unit**, bukan
   dikerjakan sekaligus dalam satu sesi/edit besar. Kalau robot
   kehabisan resource (kuota token, dsb.) di tengah jalan, kerugian
   maksimal cuma satu unit kerja yang gampang di-checkout balik, bukan
   seluruh scope TASK. (Ditambahkan setelah insiden TASK B4 crash,
   lihat §6.)

## 2. VERDICT ARSITEKTUR (hasil audit 9 Agu 2026, MASIH BERLAKU)

Akar masalah "chatbot kaku, tambal-sulam tanpa akhir" BUKAN semata
"kelewat banyak keyword". Akar sebenarnya: **boundary antar-layer
rusak** — beberapa komponen sekaligus jadi pengambil-keputusan
semantik, fallback, executor, DAN persistence. Tidak ada satu sumber
kebenaran untuk keputusan percakapan.

Temuan kritis terverifikasi dari audit source code penuh (lihat
riwayat chat 9 Agu untuk detail file:line):
- V2 bisa mutate DB lalu exception → fallback ke V1 → V1 proses ulang
  pesan yang sama → berpotensi DOBEL mutasi cart/order. [DITUTUP P0]
- `updateExtractedEntities` di jalur v2 adalah NO-OP (type mismatch) —
  v2 kehilangan memori antar-turn secara diam-diam. [P3, BELUM]
- I13 ("angka wajib dari DB") TIDAK konsisten: `validateCartOpsAgainstDb`
  ada di kode tapi tidak dipanggil; sebagian jalur v1 pakai harga dari
  LLM langsung. [P2, BELUM]
- I8 ("maks 1 LLM/pesan") dilanggar: retry transport di interpreter.ts
  + LLM kedua tersembunyi di `orderService.extractAndSaveOrder()`.
  [P4, BELUM. CATATAN: I8 sudah diturunkan dari hard constraint jadi
  guideline efisiensi — lihat prinsip trade-off di §3]
- Shadow mode v2 selalu gagal diam-diam (type mismatch context). [P3]
- `modifyCart` read-modify-write tidak transactional → race condition.
  [belum masuk P-mana pun secara eksplisit, perlu diklasifikasi ulang]

## 3. STATUS TERKINI — RINGKAS (baca ini dulu tiap sesi baru)

**Commit terakhir diketahui:** `ffd00df` (TASK B4.5, final tier P1)
**Cek selalu:** `git log --oneline -5` dan `git status` di awal sesi —
JANGAN percaya angka commit di file ini kalau belum di-cross-check live,
bisa saja sudah ada sesi lain sesudah file ini terakhir ditulis.

### PRINSIP KANAL: WA vs PWA (LOCKED, 19 Agu 2026) — ATURAN MUTLAK SETINGKAT §1

> Keputusan permanen owner, **terkunci, TIDAK BOLEH dibatalkan tanpa persetujuan
> owner**. Diperlakukan sebagai aturan mengikat sama dengan §1. Setiap implementasi
> masa depan (reminder, notifikasi order, broadcast promo, dll) WAJIB mematuhi ini.

1. **WA = teks bebas selamanya (NO interactive buttons/lists).** WhatsApp tetap
   kanal *natural-language text-only*. Tidak akan pernah pakai tombol/list/menu
   interaktif (Fonnte/GOWA gratis tidak support, dan TIDAK ada rencana upgrade ke
   WA Business API resmi). Jangan pernah bangun fitur yang mengasumsikan WA bisa
   kirim template/interactive/button — semua "pilihan" diselesaikan via teks
   (clarification NLP, bukan UI button).

2. **WA = ANTI-BROADCAST / reply-only.** WA **HANYA** boleh membalas pesan masuk
   (inbound → outbound reply). **DILARANG KERAS** mengirim pesan proaktif/push/
   reminder/notifikasi/notif order/cs proaktif via WA outbound. Tidak ada
   `sendMessage` WA yang dipicu tanpa ada inbound customer sebagai pemicu.

3. **PWA Web Chatbox = kanal kaya-fitur ("toko sendiri"); WA = pintu masuk saja.**
   Kalau butuh push/notifikasi proaktif (web push sudah ada di infra per G2-E4),
   reminder, atau broadcast promo → **HARUS lewat PWA (web push) atau kanal lain**,
   BUKAN WA. WA tidak boleh dijadikan kanal notifikasi satu arah.

**Konsekuensi implementasi:** segala fitur outbound proaktif DILARANG di jalur
`webhooks.ts`/Fonnte/GOWA. Kalau suatu task meminta "kirim notif ke customer",
arahkan ke PWA web push, bukan WA.

### Roadmap P0-P6 (menggantikan roadmap lama, urutan TIDAK BOLEH dilompat)

- [x] **P0 — Safety boundary**: V2 tidak fallback ke V1 setelah V2
      sudah mutation. Commit `fc39404`. VERIFIED (lihat §6, 9 Agu).
- [x] **P1 — Semantic authority**: SEMUA langkah selesai.
      - [x] Langkah 1: tryProduct confidence gate. Commit `e529466`+`aa474cb`.
      - [x] Langkah 2: tryTotal + tryPayment "bayar" overlap. Commit
            `4bd4414`+`f314326` (TASK B3).
      - [x] Langkah 3: 5 tier SEDANG-risk sisa — tryOrderStatus,
            trySop, tryShipping, tryFAQ/tryKnowledge, tryProductNotFound.
            Commit `fca533f`,`373cb37`,`7b71298`,`4205b29`,`ffd00df`
            (TASK B4.1-B4.5). VERIFIED end-to-end production (10 Agu
            2026, lihat §6).
      **P1 RESMI SELESAI 10 Agu 2026.**
- [ ] **P2 — Truth boundary** (NEXT, belum mulai): executor menolak
      harga yang tidak sama dengan DB (bukan cuma "ambil dari catalog
      jika sempat"). Terkait I13 (non-negotiable, lihat §2).
- [x] **P3 — Context boundary**: WorkspaceV2 dan legacy
      ExtractedEntities dipisah bersih, tidak saling timpa diam-diam.
      - [x] P3.1 — persist WorkspaceV2 ke kolom baru `workspace_v2` (T1). Commit `c164729`.
      - [x] P3.2 — migrasi legacy `extractedEntities` → `workspace_v2` pada v1→v2 switch (T3). Commit `3780453`.
      - [x] P3.3 — satukan shape kolom `extractedEntities` → OBJECT (T2). Commit `eb74929` (`3780453`), laporan `laporan-taskP3.3.md`.
      - [x] P3.4 — atomic read-modify-write via optimistic lock `updatedAt` (T4). Commit `099967a`, laporan `laporan-taskP3.4.md`.
- [ ] **P4 — Remove second brain**: `extractAndSaveOrder()` berhenti
      jadi interpreter kedua untuk pesan yang sudah diproses V2.
- [ ] **P5 — Response naturalness**: composer-v2 dibedah untuk lebih
      natural. SENGAJA ditunda sampai P0-P4 selesai.
- [ ] **P6 — Golden dataset sebagai architecture gate**, bukan sekadar
      regression test kosmetik.

**Prinsip trade-off (tetap berlaku):** robustness dan natural language
understanding > biaya LLM. I8 (maks 1 LLM/pesan) BUKAN lagi hard
constraint, jadi guideline efisiensi yang boleh dilanggar demi jawaban
benar. I13 (angka wajib dari DB) TETAP non-negotiable — soal integritas
transaksi, bukan gaya bicara.

### Item lama di luar P0-P6 (masih berlaku, belum dikerjakan)

- Receipt tampil item qty 0 ("Brambang (0x)") — kosmetik.
- Reply resolved terpotong ("adalah?") — kosmetik.
- Test `reasoning-v2.test.ts` "terminal→fallback" outdated (I-V2-6
  label mismatch) — ini salah satu dari 2 pre-existing test failure
  yang konsisten muncul di setiap test run sejak sebelum TASK 0.
- Eskalasi ke owner untuk jalur v2 (canary) — masih SHADOW-ONLY.
  Jalur v1/production sudah nyata sejak TASK C1 (commit `718c375`).
  Kalau v2 suatu saat butuh path eskalasi sendiri, ini jadi TASK
  terpisah, bukan bug.
- Kata `'mau'` di `ORDER_INTENT_KEYWORDS` (`fast-path.ts`) bisa
  short-circuit sebelum trySop sempat dicek untuk kalimat seperti
  "barang rusak mau retur" — ditemukan saat TASK B4.2 (10 Agu 2026),
  di luar scope B4, belum ada TASK perbaikan.
- Threshold `tryFAQ`/`tryKnowledge` (0.5 + margin 0.15, TASK B4.4) —
  masih `[DUGAAN, belum divalidasi data nyata]` karena FAQ/knowledge
  base toko canary kosong. Perlu divalidasi ulang begitu ada toko
  dengan data FAQ/knowledge asli.
- Golden dataset + test invarian permanen I8-I15 — jadi P6, baru
  test unit parsial sejauh ini.
- Keputusan terbuka: "dua duanya" jika opsi klarifikasi >2; retry LLM
  dihitung sebagai panggilan LLM atau tidak — belum diputuskan.

### Item hygiene (non-blocking, tapi menumpuk — perlu TASK kecil terpisah)

- `apps/api/logs/*.log` — **Fase A (untrack) SELESAI** (commit `a1f69f7`:
  `.gitignore` exclude `apps/api/logs/*.log` + `git rm --cached`, 0 log
  ter-track setelahnya) DAN **Fase B (purge history) SELESAI** (commit
  `469804a`→`73f607b` via `git filter-repo --path apps/api/logs/
  --invert-paths --force`; backup `garuda-backup-20260819.bundle` di
  `/home/ubuntu/backups/`). Data sensitif di history lama SUDAH TERHAPUS.
  ⚠️ Clone lain WAJIB re-clone fresh (jangan `git pull`, history berubah
  total). [DIREKONSTRUKSI, bukan diff asli — dari laporan sesi sebelumnya]
- Belum ada git pre-commit hook / checklist otomatis untuk cek
  `dist/` tertinggal sebelum commit. Sudah 3x kejadian manual
  ditemukan lewat `git status` menyeluruh: TASK A/0, TASK B3, insiden
  restore TASK B4 (10 Agu — bahkan menemukan 7 file dist/ YATIM dari
  fitur yang sudah tidak ada source-nya sama sekali: route-decider,
  clarification-resolver, message-normalizer, ot-or-interpreter,
  +3 dist test file — dibersihkan di commit `5f502d1`).

### Roadmap besar setelah engine v2 stabil (belum mulai)

PWA Web Chatbox — blueprint lengkap ada di riwayat chat 9/8 00:50
(simpan sbg 04_PWA_BLUEPRINT.md kalau belum). Prinsip: zero-friction
auth (uid URL→localStorage), <300KB, multi-tenant qlobot.web.id/c/<slug>,
UI mirip WA. 3 endpoint: GET /api/pwa/:slug/init, GET .../history?uid=,
POST .../message (pipeline AI sama, gratis tanpa Fonnte). 5 milestone:
skeleton→session handoff→2-way chat→manifest+katalog→push. Bonus:
M1-M3 = test harness gratis pengganti Fonnte. CATATAN: uid map ke
conversationId existing (store:<nomor>); channel WA/WEB field
terpisah, JANGAN timpa field source. Ditunda sampai P0-P6 kelar.

## 4. FAKTA OPERASIONAL PROYEK

- Server VPS: `root@vps3541799`, repo: `/home/ubuntu/garuda`
- Struktur monorepo: `apps/api` (package.json + tsconfig di sini,
  BUKAN di root — build/tsc harus dijalankan dari `apps/api/`),
  `apps/dashboard`
- Canary: `store-f7140b5c` (Depot Kinasih)
- Device/gateway: `6289658888008`
- Redis flag: `store-f7140b5c:engine = v2`
- Test gratis: curl webhook + baca dashboard `/dashboard/conversations`
- Owner tidak akses server langsung untuk AI — AI kerja lewat owner:
  AI kasih command, owner jalankan & paste hasil balik. Command dengan
  path relatif WAJIB eksplisit `cd` dulu di awal.
- Robot coding terpisah (opencode/DeepSeek, disebut "commandcode")
  yang eksekusi TASK — dijalankan lewat prompt yang ditulis Claude,
  hasilnya dilaporkan ke file `.md` di root repo (bukan cuma balas
   chat), owner upload balik ke Claude untuk cross-check vs diff mentah.

### 4.1 Git hook `post-merge` auto-build (TASK III-1-B, 19 Agu 2026)

Konteks: alur deploy production = `git pull` + `pm2 restart api` TANPA build
manual sama sekali. `dist/` ter-commit adalah safety net saat ini. Root
cause berulang: lupa `npm run build` sebelum commit/pull (insiden TASK B1 9
Agu, TASK B4). Hook ini mencegah lupa: setiap habis `git pull`/`git merge`,
otomatis rebuild `apps/api/dist/`.

- File: `/home/ubuntu/garuda/.git/hooks/post-merge` (isi: `cd apps/api &&
  npm run build`). Sengaja TIDAK auto `pm2 restart` — restart tetap manual
  supaya kalau build gagal, tidak diam-diam restart pakai `dist/` rusak.
- ⚠️ PENTING: `.git/hooks/` TIDAK ter-track git. Hook ini HILANG kalau repo
  di-re-clone / ganti server / setup VPS baru. WAJIB pasang ulang manual
  (copy di bawah) setiap kali setup server/environment baru:
  ```bash
  cat > /home/ubuntu/garuda/.git/hooks/post-merge <<'EOF'
  #!/bin/bash
  set -e
  echo "[post-merge hook] Rebuilding apps/api..."
  cd apps/api && npm run build
  echo "[post-merge hook] Build done. Restart pm2 manually: pm2 restart api"
  EOF
  chmod +x /home/ubuntu/garuda/.git/hooks/post-merge
  ```
- Safety: `apps/api/tsconfig.json` diset `"noEmitOnError": true` (TASK
  III-1-B) supaya build GAGAL tidak menimpa `dist/` lama dengan output
  rusak — `tsc` berhenti tanpa emit, hook (`set -e`) stop, `dist/` tetap
  aman. Terverifikasi via simulasi merge dengan source sengaja error.
- TIDAK mengubah `ecosystem.config.js`, TIDAK meng-untrack `dist/`. Keputusan
  untrack `dist/` DITUNDA sampai hook terbukti reliable beberapa kali deploy
  nyata — bukan sekarang.

## 5. DEFINISI "SELESAI" UNTUK SATU TASK

Sebuah TASK dianggap selesai HANYA jika semua ini ada, ditempel
verbatim (bukan diringkas):
1. Output `npx tsc --noEmit` (harus 0 error)
2. Output `npm run build` (WAJIB, bukan cuma --noEmit — --noEmit TIDAK
   generate dist/, pm2 tetap jalankan kode lama kalau ini dilewat.
   Ditemukan nyata di TASK B1, 9 Agu 2026: unit test 11/11 pass tapi
   production masih pakai kode lama karena langkah ini terlewat.)
3. Output test suite lengkap (pass/fail count, termasuk pre-existing
   failure yang sudah diketahui — baseline saat ini: 2 failed suites/
   1 failed test, lihat §3)
4. Output `git diff --stat` (bukti scope tidak melebar)
5. Konfirmasi `pm2 restart api` sukses + tidak crash loop
6. Untuk perubahan yang menyentuh side-effect (DB write, WA send):
   bukti test manual WA nyata ATAU test otomatis yang mensimulasikan
   skenario itu secara eksplisit (curl webhook + DB readback, atau
   throwaway Prisma tx untuk kasus yang tidak bisa di-e2e langsung
   seperti FAQ/knowledge dengan data canary kosong — pola dari TASK
   C1 dan TASK B4.4/B4.5).

Tanpa keenam ini, status TASK = "BELUM SELESAI", titik.

Untuk TASK yang scope-nya bisa dipecah per-unit (lihat §1 aturan 9):
tiap unit WAJIB commit terpisah dan memenuhi keenam poin di atas
SEBELUM lanjut ke unit berikutnya — bukan satu commit besar di akhir.

## 6. LOG KEPUTUSAN (HISTORIS, VERBATIM — jangan edit entri lama,
    tambah entri baru di paling bawah)

```
### [tanggal] — [judul keputusan]
Konteks:
Keputusan:
Alasan:
Siapa yang setuju: (owner/Claude/AI CLI)
```

### 9 Agu 2026 — Urutan P0→P6 ditetapkan
Konteks: Audit penuh source code oleh AI CLI menemukan boundary
antar-layer rusak, bukan sekadar keyword overload.
Keputusan: Kerjakan P0-P6 berurutan, tidak boleh lompat ke semantic
refactor (P1+) sebelum P0 (safety boundary) selesai dan terverifikasi.
Alasan: P0 adalah risiko data-corruption aktif di production canary;
P1-P6 adalah soal kualitas, bisa ditunda tanpa merusak data customer.
Siapa yang setuju: owner (Panji), Claude, AI CLI (GPT).

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

  **UPDATE 19 Agu 2026 (TASK III-2-A + III-2-B) — Fase A + Fase B SELESAI:**
  - Fase A (untrack): commit `a1f69f7` — `.gitignore` exclude
    `apps/api/logs/*.log` + `git rm --cached` (0 log ter-track setelahnya).
  - Fase B (purge history, destruktif): backup dulu `git bundle create
    /home/ubuntu/backups/garuda-backup-20260819.bundle --all` (17M, verify
    "is okay"), lalu `git filter-repo --path apps/api/logs/ --invert-paths
    --force`. New HEAD `73f607b`; `git push origin --force --all` sukses.
  - Verifikasi prune: dari 8 commit "ter-prune", 6 ada di `main` (100%
    logs-only, hanya `apps/api/logs/combined.log`) + 2 commit stash-only
    (ref `refs/stash`, BUKAN di `main`; source-nya tetap ada di `main` +
    `refs/stash-bak` + bundle). TIDAK ada source/data hilang dari `main`.
  - `pm2 restart api` online normal. Lokal `git gc --prune=now` → blob log
    sensitif tidak lagi recoverable (bundle tetap pegang copy rollback).
  [DIREKONSTRUKSI, bukan diff asli — dari laporan sesi sebelumnya]
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
pre-existing) + engine-config-v2 (circular dep redisAdapter, file-level,
pre-existing). safety-boundary-v2.test.ts PASS 5/5.
Kalau butuh bukti ulang: jalankan lagi command yang sama di server,
jangan asumsi hasil ini masih berlaku kalau ada commit baru sesudah
fc39404.

### 9 Agu 2026 — TASK C1 selesai: eskalasi ke owner sekarang nyata
Konteks: TASK C1 saya scope ke "conversation.service.ts bagian v2"
dengan asumsi eskalasi hidup di v2. Audit robot (Stage 1) mengoreksi
asumsi ini: I-V2-4 di validator-v2.ts CUMA jalan di shadow hook
(reasoning.ts understand() dipanggil dari conversation.service.ts:657
sebagai shadow, bukan keputusan nyata) — jalur produksi pakai
runOneCall (v1). Mekanisme eskalasi nyata yang dipakai production ada
di conversation.service.ts BAGIAN 2 (v1), baris ESCALATE ~419 dan
retry-exceeded ~514 — SEBELUM TASK C1, kedua cabang ini cuma kirim
balasan kaleng "Saya akan hubungkan ke pemilik toko" TANPA pernah
mengubah conversation.status atau memicu notifikasi apa pun ke owner
(notifyHumanTakeover cuma terhubung ke circuit breaker LLM, trigger
berbeda). Robot mengoreksi scope ke v1 (BAGIAN 2) dan
composer-v2.ts, BUKAN v2 seperti draft TASK awal — dikonfirmasi valid
lewat diff mentah (git show 718c375), bukan sekadar diklaim.
Fix: markHumanTakeover() (private, try/catch non-throwing) set
status='human_takeover'+humanTakeoverAt pakai konvensi existing
(routes/conversations.ts:88) di kedua cabang escalate; balasan
customer diganti composeEscalateReply() yang jujur, bukan generic.
Verifikasi: tsc 0 error, build sukses, pm2 restart online, test suite
22 total (20 pass/2 pre-existing fail, +2 test composer-v2 baru pass,
math 1+198=199 konsisten), DB readback before/after (open→
human_takeover) dibuktikan lewat throwaway Prisma tx. e2e curl WA
penuh SENGAJA tidak dijalankan robot — alasan jujur: berisiko ganggu
canary production real (WA+groq+data customer nyata), disarankan
sandbox store terpisah kalau mau full e2e. Commit 718c375, scope
bersih (3 file saja, tidak ada dist/logs/TASK-*.md ikut).
Keputusan: TASK C1 VERIFIED SELESAI. Item lama "eskalasi ke pemilik
toko" (roadmap asli #3) sekarang resmi tertutup untuk jalur v1/
production. Kalau v2 canary suatu saat butuh path eskalasi sendiri
(saat ini shadow-only), itu jadi item terpisah nanti, bukan bug.
Siapa yang setuju: owner (Panji), Claude — berdasarkan diff mentah
dan bukti DB readback, bukan ringkasan commit message saja.

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

### 9 Agu 2026 — TASK B2 audit selesai: peta risiko 11 tier fallback.service.ts
Konteks: Audit read-only (tidak ada perubahan kode) atas seluruh tier
di fallback.service.ts (chain: tryCache→tryFAQ→tryOrderStatus→
tryTotal→tryShipping→tryPayment→tryCatalog→tryProduct→
tryProductNotFound→trySop→tryKnowledge→HUMAN). Laporan lengkap
tersimpan di apps/api atau root repo sebagai laporan-taskB2.md
(diupload user 9 Agu 2026).
Temuan risiko TINGGI (2): tryTotal (:593) dan tryPayment (:372) —
keduanya pakai substring keyword match dan SALING TUMPANG TINDIH di
kata "bayar" (ada di kedua keyword list). Contoh konkret dari data
canary nyata (store-f7140b5c, Depot Kinasih): "berapa bayar kangkung"
bisa "dicuri" tryTotal/tryPayment sebelum sempat sampai tryProduct —
customer nanya harga malah dijawab "keranjang kosong" atau daftar
metode pembayaran. Pola identik bug tryProduct "ram"⊂"Brambang",
cuma lokasi beda. Komentar kode lama (BUG-10/12) sengaja taruh
shipping+payment SEBELUM product supaya "bayar" tidak nyasar ke
produk "Bawang" — tapi ini menciptakan konflik baru dengan tryTotal.
Risiko SEDANG (4): tryOrderStatus, trySop (contoh nyata: "ganti
kangkung ke wortel" ke-trigger SOP retur), tryShipping, tryFAQ/
tryKnowledge (threshold 0.3, tidak bisa dibuktikan di canary karena
FAQ/knowledge kosong — TIDAK diklaim sebagai bug nyata, cuma risiko
teoretis dicatat jujur oleh robot).
Risiko RENDAH (3): tryCache (exact key), tryCatalog (keyword
eksklusif), tryProduct (sudah post-B1).
Side effect: HANYA tryProduct yang punya DB write (saveDiscussedItems),
dan itu sudah benar (miss = no write, sesuai desain B1).
Keputusan: TASK B3 menyasar tryTotal + tryPayment BERSAMAAN (bukan
terpisah) karena sama-sama HIGH risk dan saling terkait lewat kata
kunci sama. Tier lain (SEDANG/RENDAH) diantre untuk TASK berikutnya
setelah B3 selesai, sesuai urutan rekomendasi robot.
Siapa yang setuju: owner (Panji), Claude.

### 9 Agu 2026 — TASK B3 selesai: tryTotal + tryPayment "bayar" overlap tertutup
Konteks: Audit TASK B2 menemukan tryTotal (:593) dan tryPayment (:372)
sama-sama HIGH risk, saling tumpang tindih di kata "bayar", duduk
SEBELUM tryProduct di chain. Fix: helper pure baru tier-match.ts
(isTotalIntent/isPaymentIntent) — tryTotal/tryPayment sekarang cek
nama produk di catalog + kata jumlah vs kata metode eksplisit,
bukan cuma substring "bayar" mentah.
Bukti: unit test 23 suite (21 pass/2 pre-existing fail, math
1+215=216 konsisten), e2e curl PRODUCTION real "berapa bayar
kangkung" → DB readback membuktikan balasan "Untuk Kangkung harganya
Rp 8.000" (BUKAN lagi "keranjang kosong"/metode bayar). Regresi
check (a/c/d: "total berapa", "bisa cod ga?", "tagihan saya berapa")
semua tetap benar.
Temuan proses (dicatat, bukan disalahkan ke robot): laporan robot
sempat KONTRADIKSI bukti (bilang golden-dataset.test.ts "tidak
disentuh" padahal diff menunjukkan 90 baris ditambahkan) — dikoreksi
setelah diff mentah dibandingkan langsung. Juga ditemukan file
dist/ dari TASK C1 (718c375) TIDAK PERNAH ter-commit meski build+
restart sudah dilakukan saat itu — production benar (jalan dari
disk lokal) tapi git history dist/ tertinggal sampai TASK B3
memicu rebuild ulang dan ketahuan. Dibereskan di commit f314326.
Keputusan: kebiasaan cek `git status` MENYELURUH (bukan cuma file
yang baru disentuh TASK berjalan) setiap sebelum commit sudah
terbukti perlu — ini kedua kalinya menemukan sisa dist/ tertinggal
dari TASK sebelumnya (sekarang C1, sebelumnya juga sempat kejadian
serupa di TASK A/0). Pertimbangkan TASK terpisah nanti: bikin
git pre-commit hook atau checklist eksplisit "npm run build && git
status --short | grep dist" di SETIAP akhir TASK, bukan cuma
diandalkan diingat manual.
Commit: 4bd4414 (TASK B3 source+dist) + f314326 (catch-up dist TASK
C1 + sync RAILS.md). Sisa scope P1: tryOrderStatus, trySop,
tryShipping, tryFAQ/tryKnowledge (SEDANG risk dari audit B2) — belum
digarap, sesuai urutan rekomendasi di laporan-taskB2.md.
Siapa yang setuju: owner (Panji), Claude.

### 10 Agu 2026 — Insiden TASK B4: robot crash di tengah edit 5-tier gabungan, full reset
Konteks: TASK B4 awalnya diberikan sebagai satu TASK besar mencakup
5 tier sekaligus (tryOrderStatus, trySop, tryShipping, tryFAQ/
tryKnowledge, tryProductNotFound). Robot (commandcode/opencode)
kehabisan kuota token di tengah edit fallback.service.ts — file
source rusak (trySop terpotong di tengah, beberapa method helper
hilang termasuk createResult, saveDiscussedItems, export const
fallbackService). tier-match.ts dan tier-match.test.ts sempat
SELESAI ditulis robot (5 helper function baru) tapi belum sempat
di-commit saat crash terjadi.
Investigasi: pm2 production TIDAK crash (masih jalankan dist/ lama
yang valid, source rusak belum ter-build ulang) — tapi ditemukan
dist/tier-match.js SUDAH mengandung kode B4 meski source tier-match.ts
sempat ke-checkout balik ke HEAD, mengindikasikan ada build yang
sempat jalan di atas source yang belum final. git status juga
menunjukkan 2 file di luar scope B4 sempat tersentuh (.gitignore,
golden-dataset.test.ts) — tidak sempat diinvestigasi mendalam karena
diputuskan restore total lebih prioritas daripada mencari akar
masalah dulu.
Keputusan: SETELAH beberapa ronde checkout per-file yang membingungkan
dan memakan waktu (dikritik owner sebagai "muter-muter"), diputuskan
restore TOTAL: `git reset --hard f314326` + `git clean -fd` (buang
SEMUA perubahan tracked + untracked tanpa pandang bulu) + rebuild
dari nol (hapus .tsbuildinfo + rm -rf dist + build ulang). Proses ini
sekaligus mengungkap 7 file dist/ YATIM (source-nya sudah tidak ada:
route-decider, clarification-resolver, message-normalizer,
ot-or-interpreter, +3 dist test file) yang selama ini nyangkut di git
tanpa terpakai — dihapus di commit 5f502d1. TASK B4 dianggap BELUM
PERNAH DIKERJAKAN, mulai dari nol lagi, TAPI dipecah per-tier
(1 tier = 1 edit + 1 commit) supaya kalau robot kehabisan kuota lagi,
kerugian maksimal cuma 1 tier.
Alasan proses "restore total, bukan tambal": ditegaskan owner secara
eksplisit setelah frustrasi dengan proses checkout bertahap yang
berkali-kali menemukan anomali baru (dist masih ada sisa B4 meski
source sudah bersih, dll) — setiap putaran tambal menghabiskan waktu/
token owner. Ditambahkan sebagai ATURAN PERMANEN di §1 (aturan 8, 9).
Siapa yang setuju: owner (Panji), Claude.

### 10 Agu 2026 — TASK B4 selesai: 5 tier SEDANG-risk fallback.service.ts tertutup
Konteks: Setelah full reset (lihat entri di atas), TASK B4 diulang
dari nol dan dipecah jadi 5 sub-task terpisah (B4.1-B4.5), tiap
sub-task WAJIB commit bersih sebelum robot lanjut ke sub-task
berikutnya. Menyelesaikan sisa audit B2 (tryOrderStatus, trySop,
tryShipping, tryFAQ/tryKnowledge, tryProductNotFound).
Fix per tier: tryOrderStatus ('sampai mana' vs stok produk — gate
pakai isOrderStatusIntent + sinyal order eksplisit), trySop
('ganti X ke Y' vs retur — isSopRetourIntent, pola 2-produk
dikecualikan dari retur), tryShipping ('mau pesan' vs ongkir —
isShippingIntent, kata order eksplisit tanpa kata kirim/ongkir →
bukan shipping), tryFAQ/tryKnowledge (threshold 0.3→0.5 + margin
0.15, ditandai [DUGAAN] karena FAQ/knowledge canary kosong, belum
tervalidasi data nyata), tryProductNotFound (regex anchor awal →
isProductNotFoundInquiry, deteksi kata tanya di mana saja dalam
kalimat + filter kata pengisi untuk cegah false-positive baru).
Bukti: 5 commit terpisah (fca533f, 373cb37, 7b71298, 4205b29,
ffd00df). Tiap commit: tsc 0 error, build sukses, pm2 restart online,
test suite (baseline 2 pre-existing failure — reasoning-v2 I-V2-6 +
engine-config-v2 circular dep — tetap konsisten sepanjang 5 commit,
total test naik 219→230→239→239→247). git diff --stat gabungan
(rentang fca533f^..ffd00df) DIVERIFIKASI LIVE hanya menyentuh 3 file
source: fallback.service.ts, tier-match.ts, tier-match.test.ts — scope
tidak melebar sepanjang 5 sub-task. E2E curl production store-f7140b5c
untuk tiap tier (regresi + bug-fix case) + DB readback throwaway
Prisma tx untuk B4.4/B4.5 (FAQ/knowledge confidence, pola sama TASK
C1), semua dummy data dihapus setelah verifikasi (0 remaining).
Temuan sampingan (dicatat, BUKAN bug dari B4 — dicatat di §3): kata
'mau' di ORDER_INTENT_KEYWORDS (fast-path.ts) bisa short-circuit
sebelum trySop sempat dicek untuk kalimat seperti "barang rusak mau
retur" — ditemukan saat B4.2, di luar scope, item antrian terpisah.
Threshold tryFAQ/tryKnowledge masih [DUGAAN] belum tervalidasi data
nyata (canary FAQ/knowledge kosong).
Keputusan: P1 — Semantic authority "Langkah 2+" RESMI SELESAI. Next:
P2 — Truth boundary (executor menolak harga tidak sama dengan DB).
Siapa yang setuju: owner (Panji), Claude — berdasarkan git log/diff/
test suite mentah yang di-cross-check live (bukan cuma ringkasan
laporan-taskB4.md), termasuk mengonfirmasi 1 inkonsistensi kecil di
laporan gabungan (tabel scope B4.4 sempat menyebut tier-match.test.ts
ikut berubah, padahal laporan asli B4.4 dan angka test count
membuktikan tidak — dicatat sebagai catatan minor, tidak mengubah
verdict TASK B4 selesai).

### 10 Agu 2026 — P3 (Context boundary) selesai: T1-T4 tertutup, T5 tetap RENDAH belum digarap
Konteks: Audit read-only laporan-taskP3-audit.md konfirmasi klaim lama
(RAILS §2): updateExtractedEntities jalur v2 NO-OP (WorkspaceV2 object
dikirim ke fn yang ekspek array, `.length` undefined -> guard selalu true).
Ditemukan juga T2 (TINGGI, kolom extractedEntities campur ARRAY/OBJECT
tergantung penulis terakhir -> data hilang), T3 (SEDANG, v2 buta state v1
lama), T4 (SEDANG, race condition read-modify-write tanpa lock).
Keputusan: T1 fix pakai kolom baru `workspace_v2` (bukan reuse
extractedEntities) - alasan: reuse kolom yang sama cuma nambah lapisan
campuran baru, bukan menutup akar masalah (persis pola yang bikin T2
muncul). Dipecah 4 sub-task, commit per unit sesuai §1.9:
- P3.1 (c164729): migration kolom workspace_v2 + v2 persist ke sana,
  bukan lewat updateExtractedEntities. Bukti before/after: pending status
  "active" tetap "active" (NO-OP lama) vs jadi "resolved" & persisted
  (kode baru), llmCalls:0.
- P3.2 (3780453): loadWorkspace migrasi sekali dari legacy
  extractedEntities -> workspace_v2 saat v1->v2 switch (mapLegacyEntitiesToWorkspace).
  Bukti: tanpa mapper llmCalls:1 (minta ulang), dengan mapper llmCalls:0
  (pending lama langsung resolve).
- P3.3 (eb74929+105fe52): shape kanonik extractedEntities disatukan jadi
  OBJECT (parseEntities/mergeEntities array dihapus). Re-audit pasca P3.1/
  P3.2 konfirmasi tidak ada lagi penulis v2 ke kolom ini. Bukti round-trip:
  trackedEntities + pendingClarification sama-sama preserved setelah fix
  (sebelumnya saling timpa).
- P3.4 (099967a): optimistic locking (atomicCas, updatedAt compare +
  updateMany count-check, retry max 5x) pada semua RMW extractedEntities/
  workspace_v2 - dipilih ketimbang prisma.$transaction karena butuh filter
  non-unique (updatedAt) yang $transaction+update tidak dukung. Race test
  10 iterasi: BEFORE bothSaved=0/cartLost=10, AFTER bothSaved=10/cartLost=0.
Verifikasi gabungan: npm run test:chat baseline tetap 2 failed suites/
1 failed test (tidak nambah) di P3.1-P3.4. tsc 0 error, build sukses,
pm2 restart online tiap sub-task. dist di-rebuild ulang & commit terpisah
(fd08ba3) setelah ketahuan tertinggal - pola sama seperti insiden B3/C1,
kebiasaan cek git status menyeluruh terbukti perlu lagi.
Sisa: T5 (RENDAH, fallback tier tryDiscussedItems overlap nulis kolom
sama) BELUM digarap, tidak masuk P3.4 (di luar scope RMW utama). appendMessage
(kolom lastMessages, race serupa T4 tapi beda kolom) BELUM digarap, item
antrian terpisah, dicatat robot di laporan P3.4 §6.
Siapa yang setuju: owner (Panji), Claude - berdasarkan commit log +
race test + test suite mentah, cross-check live.

### 10 Agu 2026 — P4 selesai: extractAndSaveOrder (second-brain) dihapus
Konteks: Audit P4.0 konfirmasi extractAndSaveOrder() adalah interpreter LLM
ketiga (Gemini, beda provider/config dari v1/v2 Groq) yang parse ulang pesan
customer TANPA validateCartOpsAgainstDb, nulis baris orders 'pending' phantom
(totalPrice null) ke tabel yang sama dipakai v1/v2. Bisa kepilih jadi
activeOrder di turn berikutnya, ganggu SEMUA tenant produksi (bukan cuma
canary, karena jalur v1 default).
Fix: dihapus total (bukan dipertahankan persist-only) - order.service.ts
(-144 baris: EXTRACTION_PROMPT/RETRY_PROMPT/attemptExtraction/
extractAndSaveOrder), call-site conversation.service.ts:769, mock no-op
golden-dataset.test.ts. createOrder/syncCartStateToDraftOrder/
addConfirmedItemToOrder TIDAK disentuh (jalur v1/v2 benar).
Bukti DB before/after (harness in-process, dev DB, bukan curl WA live -
demi keamanan data customer riil): 2 baris (draft@36000 + phantom
pending@null) -> 1 baris (draft@36000, qty dari DB). Simbol
extractAndSaveOrder dikonfirmasi hilang dari source DAN dist/ (grep -c = 0).
tsc 0 error, build sukses, test baseline tetap 2 failed suites/1 failed
test (golden-dataset tetap pass setelah mock dihapus). Commit 0db56bf.
Temuan luar-scope BELUM ditangani (masuk antrian terpisah, BUKAN bagian
P4): activeOrder (conversation.service.ts:829) dan tryTotal/lastOrder-
fallback (fallback.service.ts:649-661) tidak diskriminatif draft vs
pending - createOrder (:393) masih bisa hasilkan baris pending yang
kepilih jadi order aktif meski bukan dari extractAndSaveOrder lagi.
**P4 RESMI SELESAI 10 Agu 2026.**

### 11 Agu 2026 — P4.2 selesai: diskriminasi draft vs pending di activeOrder/tryTotal

Konteks: Setelah P4.1 menghapus `extractAndSaveOrder` (phantom `pending`
tanpa harga DB), tersisa `createOrder` (order.service.ts:213) yang masih
menulis `orderStatus: 'pending'`. Pending dari `createOrder` **valid** —
harga divalidasi DB via `productService.getProductById` (bukan phantom/LLM).
Tapi `activeOrder` (conversation.service.ts:829) dan `tryTotal`/`lastOrder`
fallback (fallback.service.ts:649) masih tidak bedakan `draft` (current
working cart) vs `pending` lain — bisa memilih baris `pending` jadi order
aktif dan menimpa harga keranjang yang sedang dibangun.

Verifikasi SCOPE 1 (createOrder): hanya dipanggil dari test files, tidak
dari production code. Production flow pakai `addConfirmedItemToOrder`/
`syncCartStateToDraftOrder` (draft, harga DB) + `finalizeDraftOrder`
(→ waiting_address). Pending dari `createOrder` punya harga DB valid —
bukan phantom. createOrder tidak diubah (tidak ada bug).

Fix (2 source file + 6 dist file rebuild):
1. `activeOrder` (conversation.service.ts): query `draft` eksklusif dulu,
   fallback ke `notIn [shipped,delivered,cancelled]` HANYA bila tidak ada
   draft.
2. `tryTotal`/`lastOrder` (fallback.service.ts): query `draft` eksklusif
   dulu, fallback ke `[pending,waiting_payment,paid,waiting_address,confirmed]`
   HANYA bila tidak ada draft. Plus perbaiki bug pre-existing
   `JSON.parse(lastOrder.items as string)` yang gagal karena Prisma `Json`
   type mengembalikan JS array (bukan string) → catch mengembalikan items=[]
   → "keranjang kosong" selalu. Fix: handle `Array.isArray` dan `typeof
   string` secara eksplisit.

Bukti DB (harness in-process, dev DB, mock LLM):
- conv-A: 2 rows (draft@36000 + pending@24000, createdAt ASC)
- "total belanja saya berapa" → "GRAND TOTAL: Rp 36.000" (draft, bukan 24.000)
- "terima kasih banyak" → interpreter prompt: `status=draft` (bukan pending)
- tsc 0 error, build sukses, test baseline tetap 2 failed/1 failed (golden pass).
Commit terpisah.**

### 10 Agu 2026 — P4.2 selesai: activeOrder/tryTotal diskriminasi draft vs pending (I-3)
Konteks: Satu-satunya temuan P4.0 yang masih terbuka setelah extractAndSaveOrder
dihapus (P4.1) - activeOrder (conversation.service.ts) dan tryTotal/lastOrder
fallback (fallback.service.ts) tidak bedain orderStatus 'draft' (harga current
working cart) vs 'pending' (createOrder, ternyata VALID harga DB, bukan phantom
- diverifikasi dulu sebelum diubah, bukan diasumsikan).
Fix: activeOrder & lastOrder query eksklusif pilih draft dulu, fallback ke
notIn/in status lama HANYA kalau tidak ada draft sama sekali.
Temuan sampingan dalam scope (fallback.service.ts, file yang sama): bug
pre-existing JSON.parse(lastOrder.items as string) selalu gagal karena Prisma
Json type return array bukan string -> tryTotal SELALU jawab "keranjang
kosong" apa pun isi draft-nya. Diperbaiki dalam commit sama karena tanpa ini
efek P4.2 di tryTotal tidak bisa dibuktikan (acceptance #6 butuh ini).
Bukti: draft@36000 vs pending@24000 sama conversationId - "total belanja
saya berapa" -> jawab 36000 (draft), bukan 24000 (pending). Interpreter
prompt juga confirm activeOrder=draft. tsc 0 error, build sukses, test
baseline tetap 2 failed/1 failed (sama P4.1), pm2 online. Commit 947fdaf.
**P4 RESMI SELESAI TOTAL (audit + P4.1 + P4.2) 10 Agu 2026.**
Sisa dari BUG-BELUM-DIBERESKAN.md yang BUKAN bagian P4 (dicatat, ditunda
owner): II-4 (seed test data woltel/brambang), III-1/III-2 (dist+logs
ter-track di git, tunggu investigasi alur deploy).

### 10 Agu 2026 — P5.1 selesai: 5 bug objektif reply composition
Konteks: Audit P5.0 (read-only, commit 1be0516) pisahkan temuan composer-v2
jadi BUG (5, objektif rusak) vs GAYA (6, preferensi bahasa, tunggu owner).
Fix 5 BUG: I-1a (subtotal hitung qty=0 sebagai 1, padahal display filter -
sekarang konsisten filter qty>0 di keduanya), I-2 (v2 path tidak apply
truncateTo2Sentences seperti v1 - root cause reply terpotong, bukan string
"adari" spesifik yang tidak ketemu di repo saat audit, tapi mekanisme
truncation-nya nyata), #3 (silent drop message ke-4+ sekarang di-log warn),
#4 (qty<=0 di DraftCartOp render "x1" bukan "x0"), #5 (reply_draft spasi-
doang sekarang trim() dulu sebelum truthy check).
Bukti: I-1a subtotal 49000->44000 (item qty=0 ke-exclude), I-2 unit test
reply 3+ kalimat -> truncated 2. tsc 0 error, build sukses, test baseline
tetap (2 failed suites/1 failed test pre-existing + 5 unit test baru pass).
pm2 online. Commit 0e99fbd.
6 temuan GAYA BELUM disentuh (menunggu keputusan owner terpisah): regex
truncate salah anggap '?' interjeksi BI sebagai akhir kalimat, topic-switch
message generic, konsistensi v1/v2 truncate (sudah sebagian ke-cover I-2),
'x' vs '×' qty display, larangan harga di reply_draft (desain arsitektur),
tone/emoji ESCALATE_REPLY.
**P5.1 SELESAI. P5 BELUM TOTAL TUTUP - nunggu keputusan 6 item GAYA.**
Siapa yang setuju: owner (Panji), Claude.

### 10 Agu 2026 — P5.2 selesai + P5 TOTAL TUTUP
3 fix GAYA sesuai keputusan owner: regex truncate '?' tidak split kalau
diikuti huruf kecil/koma (interjeksi BI), simbol qty seragam 'x' ASCII,
ESCALATE_REPLY emoji dihapus. Commit bd607f6. tsc/build/test baseline OK
(+8 test baru pass, 2 pre-existing tetap).
3 GAYA sisa diputuskan owner: topic-switch message tetap generic (effort
vs gain kecil), konsistensi v1/v2 truncate otomatis selesai lewat P5.1/
P5.2, larangan harga di reply_draft dipertahankan (desain lama, resiko
inkonsistensi kalau diubah).
**P5 (Response naturalness) RESMI SELESAI TOTAL 10 Agu 2026.**

### 19 Agu 2026 — P6-1/P6-2/P6-3 selesai + TEMUAN: actionsRouter tidak di-mount (P0→P6-2 gap) + P6-5 golden coverage

Konteks: Audit P6-6/P6-7/P6-8 merekonsiliasi status structured actions.
- P6-1 (`2f834a5`): `ADD_TO_CART` end-to-end pakai `productId` otoritatif, skip
  round-trip `productId→name→productId` (CartOp extended `productId?`, executeOps
  branch resolve-by-id vs by-name; path LLM tak berubah). Terverifikasi source+diff
  (`git show 2f834a5`) dan `npm run build` exit 0 di HEAD.
- P6-2 (`3cb91c9`): `REMOVE_FROM_CART` + `UPDATE_CART_QUANTITY` sudah typed action
  (reuse Stage-1/Stage-2 idempotensi; removeLine/updateQuantity `tx?` optional).
- P6-3 (`ced2fc9`): `CANCEL_ORDER` typed action (delegasi ke transitionOrder, target
  Order bukan OrderItem; CartAuthority tak disentuh) + **fix bug actionsRouter**.
- 🔴 TEMUAN: `routes/actions.ts` dibuat di `e5ee299` tapi `app.use('/api/pwa',
  actionsRouter)` TIDAK ADA di `index.ts` sampai `ced2fc9` → endpoint
  `POST /api/pwa/:storeSlug/action` 404 / unreachable via HTTP nyata sejak P0 (P6-1
  ADD, P6-2 REMOVE/UPDATE ikut terdampak). Ketahuan lewat curl HTTP asli ke canary
  (test suite lolos karena panggil executeAction() in-process). Diverifikasi keempat
  action reachable via HTTP setelah mount. Tidak ada klaim keliru "sudah jalan di
  production" (RAILS §1.3).
- P6-5 (`dba92b8`, `79734f3`): golden dataset coverage P3/P4/P5 + mutation test
  (revert 1 baris fix → case jadi MERAH), naik 18/18 → 23/23; test:chat 267/267 tetap.

Keputusan: P6-1/P6-2/P6-3 RESMI SELESAI; gap actionsRouter tertutup & terverifikasi
HTTP; P6-5 RESMI SELESAI. **P6-4 TIDAK ADA sebagai commit terpisah** dalam range
`e5ee299..HEAD` — pekerjaan §6.4 (golden dataset) tercatat selesai di P6-5
(`dba92b8`). Perlu konfirmasi owner: apakah penomoran P6-4 disengaja di-skip/digarap
bersama P6-5, atau gap penomoran yang perlu diluruskan (JANGAN diasumsikan).

Alasan: rekonsiliasi dokumen agar STATUS/STATE tidak kontradiktif (UPDATE-SINCE-
REPORT.md sebelumnya masih punya bagian "§6.2/§6.3 TIDAK BERUBAH" yang kedaluwarsa).
Siapa yang setuju: owner (Panji), Claude — berdasarkan git log/diff mentah + build
exit 0 + curl HTTP canary, bukan ringkasan.

### 19 Agu 2026 — P7 SELESAI: WA cart mutation konvergensi ke idempotency lock (structured-actions FOR UPDATE)

Konteks: P7-DESIGN.md (final, `058bce5`) menyetujui WA cart mutation di-converge ke
jalur locking YANG SAMA dengan structured actions (PWA): reuse `claimAction` /
`executeClaimedAction` (FOR UPDATE + re-check + SAVEPOINT) via 1 adapter tipis, TANPA
sentuh interpreter/reasoning/CartAuthority/claimAction/FOR UPDATE/SAVEPOINT/Redis
dedup/mutex/Zod. `actionId` deterministik WA = `wa:${conversationId}:${messageId}`
(actionType `WA_CART_MUTATION`, terpisah dari key PWA).

- UNIT1 (`0e6a5fa`): `processCustomerMessage` + call site `message-processor.service.ts`
  terima `messageId` (optional, non-WA/test tanpa messageId → fallback direct, no
  regression). tsc 0 error; test:chat 267/267, test:golden 26/26 tetap.
- UNIT2 (`3e56ef1`): export `executeWaCartMutation(ops, storeId, customerId,
  conversationId, messageId)` + konstanta `WA_CART_MUTATION` di `action-registry.ts`.
  HANYA memanggil `claimAction`+`executeClaimedAction` yang SUDAH ADA; mutasi delegate
  ke `cartAuthority.executeOps(ops, ..., tx)` (sama seperti P0–P6). Return value
  dibedakan: `applied` / `already_applied` / `error`. diff hanya file ini (+94 LOC).
- UNIT3 (`f51ed24`): ganti `executeCartOps` v1 → `executeWaCartMutation`: :511 resolver
  EXECUTE + :673 LLM langsung. :548 ROLLBACK TIDAK diubah (sudah aman per P7-DESIGN §8 Gap 3).
- UNIT4 (`0f4315d`): ganti `executeCartOps` v2 → `executeWaCartMutation`: :238 resolved
  EXECUTE + :321 plannedActs (line re-verifikasi: desain 236/325 sudah geser ke 238/321
  setelah UNIT1 +1 baris). Keempat situs mutasi (:238/:321/:511/:673) kini converge;
  ROLLBACK :548 tetap `executeCartOps([])` (legacy restoreFromSnapshot).
- UNIT5 (`b47f13c`): test kontrak idempotensi WA baru (`wa-cart-idempotency.test.ts`, 6
  test). Membuktikan Gap 2: redeliver `messageId` SAMA → FOR UPDATE menangkap → tetap 1
  OrderItem (v1 single-op + v2 batch); `messageId` BEDA isi sama → tetap 2 (tidak
  over-dedup). Plus engine-wiring v1 resolver: `messageId` di-thread → row
  `WA_CART_MUTATION` COMPLETED + redeliver sama → no double-apply. test:chat 267/267,
  test:golden 26/26, test:structured baseline tetap; test baru 6/6.
- UNIT6 (`<commit ini>`): doc — BUG-BELUM-DIBERESKAN III-9 (`LEASE_FINAL_MS=750` vs
  kontrak §6A.5 30–60 detik) di-cross-ref sebagai MASIH TERBUKA post-P7 (P7 tidak ubah
  nilai itu, per RAILS §1.4).

Bukti ringkas: tsc 0 error; `npm run build` exit 0; git diff --stat UNIT2 hanya
`action-registry.ts` (+94). Range `0e6a5fa..b47f13c` (5 unit commit, implementation
murna penambahan tipis di executor + 1 adapter; tidak ada duplikasi claim/FOR UPDATE).
Baseline test:chat 267→267, test:golden 26→26 (tidak ada regresi).

Keputusan: P7 RESMI SELESAI. Tidak ada logic luar scope yang diubah; residual
(`LEASE_FINAL_MS`, redeliver `messageId` beda, content-window fallback) dicatat,
bukan diperbaiki. Siapa yang setuju: owner (Panji), Claude — berdasarkan git
log/diff mentah + tsc/build/test, bukan ringkasan.

### 19 Agu 2026 — P8-1/P8-2: regression gate hijau penuh + fix test-isolation CANCEL_ORDER

Konteks: P8-1 (READ-ONLY gate di HEAD `7a589ed`) ditemukan 1 failure di
structured-actions (`P6.3.2: CANCEL_ORDER invalid payload rejected before
execution`). Sisa gate hijau: tsc 0 error, build exit 0, test:chat 267/267,
test:golden 23/23, pm2 api online (tidak crash loop).

Root cause P8-2 (DIVERIFIKASI dari kode, bukan tebakan): BUKAN handler bug.
`executeAction` (action-registry.ts:1301-1325) sudah `requestSchema.safeParse()`
dan throw `ApiError(ERR_VALIDATION)` SEBELUM memanggil handler — jadi untuk
payload invalid (`orderId: 'not-a-uuid'`) handler `handleCancelOrder` TIDAK
pernah dipanggil dan `claimAction()` (STAGE 1 INSERT) TIDAK pernah jalan.
Keempat handler mutasi (ADD_TO_CART/REMOVE/UPDATE/CANCEL_ORDER) punya pola
IDENTIK — CANCEL_ORDER TIDAK beda pola.

Penyebab sebenarnya: assertion P6.3.2 di structured-actions.test.ts:1039
`findMany({ where: { actionType: 'CANCEL_ORDER' } })` TANPA filter `storeId`.
DB test SHARED: ada row `ActionIdempotency` `storeId='store-f7140b5c'`
(pattern `store-${crypto.randomUUID().slice(0,8)}` dari src/routes/auth.ts:31,
registration/e2e flow) yang bocor lintas file. Cleanup `before` file ini hanya
hapus prefix `test-action-v2*` → row asing survive → false negative.

Fix (TEST-ONLY, scope sempit): assertion di-scope ke `storeId` file ini sendiri
(`findMany({ where: { actionType: 'CANCEL_ORDER', storeId } })`). TIDAK disentuh
action-registry.ts/handler; TIDAK dihapus row `store-f7140b5c` (itu milik test
flow lain/canary, bukan urusan file ini). Setelah fix: structured-actions
38/38 (P6.3.2 hijau), test:chat 267/267, test:golden 23/23, tsc 0, build 0,
pm2 api online. Commit `7e547c6`.

KNOWN ISSUE (task terpisah, BUKAN P8-2): test DB shared antar file/flow lemah
isolasinya — row ActionIdempotency dari auth.ts registration flow bisa bocor ke
assertion test lain yang query tanpa storeId filter. Indikasi umum, bukan cuma
P6.3.2; kemungkinan ada test lain false positive/negative pola sama. Follow-up:
audit semua assertion actionType-wide/store-wide di structured-actions.test.ts
+ sibling files (p1/p2/p3/p5) untuk pola sama, lalu perbaiki test
hygiene/isolation (namespaced/transactional teardown).

Alasan: tutup siklus P8 dengan bukti mentah + catat known issue tanpa memperlebar
scope ke luar file test yang diizinkan.
Siapa yang setuju: owner (Panji), Claude — berdasarkan git log/diff/build/test
mentah.

### 19 Agu 2026 — INSIDEN: `git reset --hard` hapus doc edit uncommitted task sebelumnya

Konteks: saat cleanup test TASK III-1-B, dijalankan `git reset --hard 73f607b`
untuk mengembalikan `main` ke commit sehat setelah simulasi merge (post-merge
hook). Reset ini ikut membuang edit doc yang SENGAJA ditahan "belum di-commit"
dari TASK III-2-A dan III-2-B: RAILS.md §Item hygiene + §9 Agu Temuan hygiene,
dan BUG-BELUM-DIBERESKAN.md III-2 row. Penyebab: `git reset --hard` membuang
SEMUA perubahan working tree yang tidak ter-commit, termasuk doc — bukan cuma
source. Edit tersebut terpaksa di-rekonstruksi dari laporan sesi sebelumnya
([DIREKONSTRUKSI, bukan diff asli]).

Keputusan/Root cause: doc edit ditahan "belum di-commit" alih-alih di-commit
segera → rentan hilang kalau ada operasi reset/checkout keras di tengah jalan.
Ini bukti tambahan bahwa aturan §1.5 (commit sebelum mulai task baru, git
status bersih) BERLAKU JUGA UNTUK DOC, bukan cuma source. Ke depan: commit
doc edit secepat source (atau lebih awal), jangan ditahan "nanti".

Alasan: pelajaran proses langsung dari insiden ini sendiri; konsisten dengan
§1.5 agar tidak berulang.
Siapa yang setuju: owner (Panji), Claude — [DIREKONSTRUKSI, bukan diff asli]
dari laporan sesi sebelumnya.

---

## 6.x LOG RETROAKTIF — cluster structured actions / P4 / P8 (POST-HOC, 19 Agu 2026)

> **⚠️ PENTING — jangan disamarkan sebagai laporan tepat waktu.** Entri di bawah
> dicatat RETROAKTIF lewat TASK VERIFY-CLUSTER + DOCS-SYNC (19 Agu 2026), BUKAN
> saat commit aslinya dikerjakan. Commit asli (cluster `25d0f43..c6be2d8`) di-push
> di sesi SEBELUMNYA tanpa bukti RAILS §1.2 real-time — persis pola insiden P6 lama.
> Setiap entri wajib membawa marker:
> **[LOG RETROAKTIF — commit asli tidak dilaporkan real-time dengan bukti RAILS §1.2,
> ditutup post-hoc via TASK VERIFY-CLUSTER 19 Agu 2026].**
>
> Catatan SHA: entri §6 bertanggal "19 Agu 2026" SEBELUM blok ini (P6-1/P6-2/P6-3,
> P8-1/P8-2, INSIDEN reset) mencantumkan SHA **pra-filter-repo** (`2f834a5`,
> `3cb91c9`, `ced2fc9`, `dba92b8`, `7e547c6`, `e5ee299`) yang SUDAH TIDAK ADA
> setelah `git filter-repo` (469804a→73f607b). SHA BENAR di working tree saat ini
> ada di bawah ini.

### [RETROAKTIF] 19 Agu 2026 — P6-1: ADD_TO_CART productId envelope (skip name round-trip)
**[LOG RETROAKTIF — commit asli tidak dilaporkan real-time dengan bukti RAILS §1.2, ditutup post-hoc via TASK VERIFY-CLUSTER 19 Agu 2026]**
- Commit: `4224331` (`feat(P6-1): ADD_TO_CART productId envelope, skip name round-trip`).
- Isi: `CartOp` extended (`productId?` optional); `handleAddToCart` kirim `productId`
  otoritatif langsung ke `CartAuthority.executeOps`; `executeOps` branch
  `resolveProductById` (skip `resolveProductByName`) — path LLM berbasis nama TIDAK berubah.
- Acceptance (diverifikasi ulang TASK VERIFY-CLUSTER): tsc 0 error, build 0, test:chat
  267/267, test:golden 23/23, structured-actions 38/38 (§8.4b spy: productId TIDAK panggil
  `resolveProductByName`; §8.4c NL fallback tetap; §8.5 tenant isolation). DB readback:
  ADD via productId → OrderItem benar.

### [RETROAKTIF] 19 Agu 2026 — P6-2: REMOVE_FROM_CART + UPDATE_CART_QUANTITY typed actions
**[LOG RETROAKTIF — commit asli tidak dilaporkan real-time dengan bukti RAILS §1.2, ditutup post-hoc via TASK VERIFY-CLUSTER 19 Agu 2026]**
- Commit: `8dc22a3` (`feat(P6-2): typed REMOVE_FROM_CART + UPDATE_CART_QUANTITY actions`).
- Isi: kedua action typed, delegate ke `cartAuthority.removeLine`/`updateQuantity`
  (signature `tx?` optional, reuse Stage-1/Stage-2 idempotensi — TIDAK ada Stage-2 kedua).
- Acceptance: structured-actions.test.ts P6.2.1–P6.2.6 hijau; DB readback: OrderItem
  hilang (REMOVE) / qty berubah (UPDATE).

### [RETROAKTIF] 19 Agu 2026 — P6-3: CANCEL_ORDER typed action + fix actionsRouter mount gap
**[LOG RETROAKTIF — commit asli tidak dilaporkan real-time dengan bukti RAILS §1.2, ditutup post-hoc via TASK VERIFY-CLUSTER 19 Agu 2026]**
- Commit: `2c604cc` (`P6-3: add CANCEL_ORDER typed action + fix actionsRouter never-mounted gap`).
- Isi: `CANCEL_ORDER` delegate ke `transitionOrder` (target `Order`, bukan `OrderItem`;
  `CartAuthority` tak disentuh) + **fix bug**: `app.use('/api/pwa', actionsRouter)` di-mount
  di `index.ts` (gap sejak foundation `25d0f43`).
- Acceptance: structured-actions.test.ts P6.3.1–P6.3.8 hijau; DB readback: Order.status=
  `cancelled`. Keempat action (ADD/REMOVE/UPDATE/CANCEL) terverifikasi reachable via HTTP.

### [RETROAKTIF] 19 Agu 2026 — P4-2: CONTACT_ADMIN typed action
**[LOG RETROAKTIF — commit asli tidak dilaporkan real-time dengan bukti RAILS §1.2, ditutup post-hoc via TASK VERIFY-CLUSTER 19 Agu 2026]**
- Commit: `b610e69` (`P4-2: add CONTACT_ADMIN action + handler + contract tests`).
- Isi: `CONTACT_ADMIN` (human takeover / "Hubungi CS") — idempotensi via status-guard
  (`existing.status === 'human_takeover'` → `already_applied`) + `executeHandoff` (bukan
  FOR UPDATE, by design untuk human-takeover, bukan cart/order mutation).
- Acceptance: structured-actions-contact-admin.test.ts 4/4 hijau; DB readback:
  Conversation.status=`human_takeover`.

### [RETROAKTIF] 19 Agu 2026 — P4-3: wire 5 PWA quick actions ke /action (typed)
**[LOG RETROAKTIF — commit asli tidak dilaporkan real-time dengan bukti RAILS §1.2, ditutup post-hoc via TASK VERIFY-CLUSTER 19 Agu 2026]**
- Commit: `73f607b` (`P4-3: wire 5 PWA quick actions to /action (typed)`).
- Isi: PWA quick-action buttons (ADD_TO_CART / REMOVE / UPDATE / CANCEL / CONTACT_ADMIN)
  mengirim ke `POST /api/pwa/:storeSlug/action` — konvergen ke action contract.

### [RETROAKTIF] 19 Agu 2026 — P8-1: regression/release gate hijau penuh
**[LOG RETROAKTIF — commit asli tidak dilaporkan real-time dengan bukti RAILS §1.2, ditutup post-hoc via TASK VERIFY-CLUSTER 19 Agu 2026]**
- Commit: `d114526` (`docs: log P8-1/P8-2 gate results + test isolation known issue`).
- Isi: gate di HEAD hijau — tsc 0, build 0, test:chat 267/267, test:golden 23/23, pm2
  api online (no crash loop). 1 known issue: test DB shared isolation (lihat P8-2).

### [RETROAKTIF] 19 Agu 2026 — P8-2: fix test-isolation CANCEL_ORDER
**[LOG RETROAKTIF — commit asli tidak dilaporkan real-time dengan bukti RAILS §1.2, ditutup post-hoc via TASK VERIFY-CLUSTER 19 Agu 2026]**
- Commit: `dd7e7f2` (`test: scope P6.3.2 idempotency assertion to own storeId — P8-2`).
- Isi: assertion `findMany` di-scope ke `storeId` file sendiri (row asing `store-f7140b5c`
  dari auth.ts registration flow bocor lintas file). TIDAK sentuh handler/action-registry.
- Acceptance: structured-actions 38/38 (P6.3.2 hijau); known issue isolation test DB lemah
  tetap open (task terpisah).

### [RETROAKTIF] 19 Agu 2026 — P6.4 / P6.5: golden dataset coverage P3/P4/P5
**[LOG RETROAKTIF — commit asli tidak dilaporkan real-time dengan bukti RAILS §1.2, ditutup post-hoc via TASK VERIFY-CLUSTER 19 Agu 2026]**
- Commit: `e2d391e` (test golden coverage P3/P4/P5), `55c66c5` (mark §6.4 RESOLVED +
  mutation-test proof), `58d6de0` (rekonsiliasi RAILS §6 / UPDATE-SINCE §6.2/§6.3).
- Isi: case baru P6-5/P3 (workspace_v2 persist), P6-5/P4 (1 draft Order, 0 phantom pending),
  P6-5/P5a/b/c (subtotal qty-filter + reply truncate + simbol `x` ASCII). Mutation test:
  revert 1 baris fix → case MERAH (bukti case benar-benar mendeteksi regresi).
- Acceptance: test:golden naik 18/18 → 23/23; test:chat 267/267 tetap; tsc 0; build 0.
- Catatan: **P6-4 TIDAK ADA sebagai commit terpisah** — pekerjaan §6.4 tercatat di P6-5
  (`e2d391e`/`55c66c5`). Penomoran P6-4 disengaja di-gabung ke P6-5 (per catatan §6 lama);
  perlu konfirmasi owner kalau dianggap gap penomoran.

### [RETROAKTIF] 19 Agu 2026 — III-1-B + III-2-A/B (hygiene) & P8-CI-FIX (gate lengkap)
**[LOG RETROAKTIF — commit asli tidak dilaporkan real-time dengan bukti RAILS §1.2, ditutup post-hoc via TASK VERIFY-CLUSTER 19 Agu 2026]**
- Commit `bcddfcd` (III-2-A/B purge + III-1-B post-merge hook + tsconfig noEmitOnError):
  `logs/*.log` di-exclude + di-purge dari history (backup bundle `garuda-backup-20260819.bundle`);
  git hook `post-merge` auto-build terpasang (mitigasi stale dist).
- Commit `c6be2d8` (P8-CI-FIX): `test:structured` (glob `src/tests/structured-actions*.test.ts`,
  115 test) masuk `.github/workflows/test.yml` → CI gate lengkap: test:chat + test:golden
  + test:structured. Verifikasi lokal: 115 tests / 7 suites pass.
- Acceptance (TASK VERIFY-CLUSTER + P8-CI-FIX): semua suite hijau; pm2 api online.
