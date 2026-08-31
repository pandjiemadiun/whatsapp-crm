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
10. **DILARANG `git commit --amend` / `git push --force` commit yang SUDAH
    di-push ke origin.** Kalau ada koreksi setelah push, BUAT COMMIT BARU
    terpisah (jangan ubah sejarah). Alasan: amend/force-push setelah clone
    lain sempat `pull` hash lama berpotensi konflik/kehilangan sejarah di
    sesi/clone lain. (Ditambahkan setelah insiden hash `e6c7157`→`84ad070`
    kemarin di-rewrite lewat amend + force-push.)

11. **DILARANG memulai sesi tanpa cek `git ls-files | grep -x .env`**
    (harus KOSONG) sejajar dengan `git status` di awal sesi (§1.6). Insiden
    22 Agu 2026 baru ketahuan karena kebetulan ada task merge — tanpa cek
    eksplisit ini, exposure secret bisa tidak terdeteksi bertahun-tahun.

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

**Commit terakhir diketahui:** `2e64c0a` (shipping UNIT6 — PWA checkout UI ongkir + receipt)
**Cek selalu:** `git log --oneline -5` dan `git status` di awal sesi —
JANGAN percaya angka commit di file ini kalau belum di-cross-check live,
bisa saja sudah ada sesi lain sesudah file ini terakhir ditulis.

> **Stream kerja sesi 21 Agu 2026 (range `2a93924..2e64c0a`, BELUM dilaporkan
> real-time — lihat §6 entri "21 Agu 2026" + DOCS-SYNC ini). Tiga stream besar,
> masing-masing sudah di-commit per-unit (RAILS §1.9) tapi DOKUMEN belum
> disinkron sampai sekarang:**
> 1. **Monitoring / observability (G2-G):** `dd20696` (baseline audit G2-G,
>    `AUDIT-BASELINE-G2-G.md`) + `b18b6d5` (endpoint `GET /api/admin/metrics/system`
>    — memory/latency/error-rate, in-memory rolling window, single-instance).
> 2. **Shipping-cost full-stack (RajaOngkir Komerce):** `490e853` (foundation cost
>    adapter + Redis cache 7d + quota guard) → `3d501dc` (location reference service
>    provinces/cities/subdistricts, 30d cache) → `a6c62ec`/`d7c57aa` (store origin
>    location fields + dashboard cascading dropdown) → `1f3452d`/`a2c6665` (migrasi
>    adapter ke Komerce v2, subdistrict-native) → `270e4ba`/`7130b4a`/`99b119c`
>    (Product.weight gram NOT NULL + magic-paste + form) → `2f27779`/`3aa78fd`/
>    `2d9a1a3` (public `/api/pwa-locations` + order destination fields + PWA
>    cascading dropdown) → `75344b5`..`2e64c0a` (shipping UNIT1–UNIT6: schema +
>    order-weight helper + `GET /shipping-options` + `POST /select-shipping` +
>    auto-reset ongkir + PWA checkout UI + receipt).
> 3. **Store NOT NULL registration (pre-launch hardening):** `03bce76` (schema
>    phoneNumber/address/origin* NOT NULL) → `a8b3928` (storeRegisterSchema wajib +
>    handler wiring) → `525e271` (dashboard form registrasi cascading) → `b5f50fc`
>    (dummy valid store di 13 test upsert) → `d3c7855` (tolak field wajib kosong di
>    PUT profile, bukan null-write/crash).
> Detail status teknis lengkap di PROJECT-STATE-REPORT.md §4.4–§4.6.

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
- [x] **P7 — WA cart mutation idempotency (konvergensi ke structured-actions lock)**:
      4 situs mutasi WA (v1 LLM/:673, v1 resolver EXECUTE/:511, v2 resolved/:238,
      v2 plannedActs/:321) di-converge ke `executeWaCartMutation` yang reuse
      `claimAction`/`executeClaimedAction` (FOR UPDATE + re-check + SAVEPOINT, sama
      persis dengan PWA). `actionId=wa:${conversationId}:${messageId}`, actionType
      `WA_CART_MUTATION`. ROLLBACK/:548 + interpreter/reasoning/CartAuthority TIDAK
      disentuh. Range `0e6a5fa..00daf1b` (5 unit commit). **P7 RESMI SELESAI 19 Agu
      2026** — test:chat 267/267, test:golden 26/26, test baru WA idempotensi 6/6.

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
- UNIT6 (`00daf1b`): doc — BUG-BELUM-DIBERESKAN III-9 (`LEASE_FINAL_MS=750` vs
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

- **G2-F6a + G2-F6b (20 Agu 2026):** Penutup item minor G2-F sesudah F5.
  - **F6a:** `Order.paymentRejectReason` (String?, nullable) via migrasi + schema; `payment-verify`
    terima field `reason?` opsional → simpan ke `paymentRejectReason` kalau ada, null kalau tidak
    (JANGAN wajibkan, JANGAN placeholder). Dashboard `PaymentVerification` dapat dialog reject dengan
    textarea alasan OPSIONAL (boleh dikosongkan, tidak blocking). `OrderManager` menampilkan
    `paymentRejectReason` di detail order (histori/audit). Approve flow tidak disentuh.
  - **F6b:** endpoint `POST /api/orders/:id/cod-settle` (reuse authMiddleware) — GUARD: HANYA jalan
    kalau `paymentMethod==='cod'` DAN `paymentStatus==='unpaid'`, selain itu 400. Efek:
    `paymentStatus='paid'` + `paymentVerifiedAt` + `verifiedByAdminId`. **TIDAK** memanggil
    `transitionOrder()` — `orderStatus` tidak berubah (sesuai DECISION-COD-SETTLEMENT-DEFERRED.md).
    Settlement otomatis DILARANG. GET `/api/orders` dapat filter `?paymentMethod=` (additive).
    Dashboard: halaman BARU `CODOrders.tsx` (terpisah dari Payment Verification) dengan tab
    Belum Lunas (unpaid) / Sudah Lunas (paid) + tombol "Tandai Lunas" → `cod-settle`; nav "COD"
    terpisah di samping "Verifikasi Pembayaran". `payment-report`/`payment-verify` tidak disentuh.
  - **DECISION-COD-SETTLEMENT-DEFERRED.md DIUPDATE:** tambah bagian "UPDATE 20 Agu 2026 (G2-F6b)"
    — Opsi (A) SEBAGIAN diimplementasi (admin manual tandai COD lunas + visibilitas terpisah); yang
    TETAP DEFERRED: integrasi ke `orderStatus`/fulfillment (cod-settle sengaja tidak panggil
    transitionOrder) + Opsi (B) mekanisme fulfillment/delivery terpisah (belum ada).
  - **Keputusan:** G2-F resmi DITUTUP TOTAL (F1–F6). Bukti: tsc 0, build OK, test:payment 37/37
    (F6a: reject+reason tersimpan / tanpa reason null; F6b: cod-settle sukses/non-cod/sudah-paid/
    tenant-isolation + filter ?paymentMethod=cod), migration diterapkan, pm2 restart. Commit
    `8ee1104` (F6a) + `50d4d25` (F6b). TIDAK ada perubahan logic `payment.service.ts`/
    `order-transition.ts` selain field mapper `paymentRejectReason` (F6a).

---

### 29 Agu 2026 — PV-P2c-URGENT: VARIANT_REQUIRED guard dipindah ke CartAuthority (single domain authority)
Konteks: Audit PV-P2c (WA text representation) menemukan gap kritis: produk `hasVariants=true` bisa di-add ke cart via WA path (`executeWaCartMutation` → `cartAuthority.executeOps`) TANPA variantId, dan `resolvePriceAndStock` diam-diam fallback ke parent-product price. Guardian `VARIANT_REQUIRED` HANYA ada di handler-layer `action-registry.ts:handleAddToCart` (PWA path) — WA path bypass total. Integritas data cart terancam: customer bisa di-charge harga parent, dapat `variantId=null` di OrderItem.
Keputusan: Pindahkan guard ke `CartAuthority.resolvePriceAndStock` (single domain authority per §2.3/§6A.1). Semua path (PWA, WA, addLine, checkout) sekarang wajib lewat guard ini. Handler-layer guard di `action-registry.ts` tetap ada sebagai defense-in-depth (fail-fast sebelum transaction). PV-P2c asli (text display) ditunda — tutup gap data integrity dulu.
Alasan: WA path tidak punya variant extraction di LLM schema/prompt, tapi data cart harus tetap authoritative. Kalau guard hanya di handler, WA path akan selalu bypass. Single authority = satu titik kebenaran.
Siapa yang setuju: Claude — real-time, dilaporkan saat commit. Commit `0425f8d`.

---

### 29 Agu 2026 — PV-P2c full stack closure: WA variant support (TEXT+LLM-A+LLM-B) — RESOLVED
Konteks: Audit PV-P2c awal menandai "WA variant belum tersentuh" — chat WA tak pernah handle varian (`hasVariants`): inquiry dibalas "masukkan ke keranjang", LLM tak pernah resolve teks varian (warna/ukuran) ke `variantId` (I13: LLM tak tahu `variantId`).
Keputusan: Tutup end-to-end per-unit + dist rebuild + pm2 restart:
- **PV-P2c-TEXT** (`71ba429`): `fallback.service.ts` `tryProduct` — inquiry `hasVariants` ("ada sepatu?") redirect ke storefront (`PUBLIC_PWA_URL || 'https://qlobot.web.id'` → `/c/<slug>`), bukan "masukkan ke keranjang"; marker "(ada varian)".
- **PV-P2c-LLM-A** (`a454ec1`): skema LLM `variant` = deskriptif teks (bukan `variantId`/I13); `DraftCartOp.variant` (`types-v2.ts`), `INTERPRETER_SCHEMA` (`interpreter.ts`), `FEW_SHOTS`[8..10] + rule `n` (`prompts-v2.ts`). (catatan: rule `n` + FS#9-11 + test 7a tidak dipisah hunk-level — Batch-2 & B3.1 berada pada line/objek yang sama; digabung ke LLM-A per fallback.)
- **PV-P2c-LLM-B** (`ba2acf5`): `CartAuthority.resolveVariantByLabel` (DB-driven, tenant+product-scoped via `product_variants.attributes`+`sku`) + injection di `executeOps` add-path; `conversation.service.ts:314` `variant: e.metadata?.variant ?? null`; single error surface `resolvePriceAndStock` (`VARIANT_REQUIRED`, guar­d sejak `0425f8d`). Unit `cart-authority.test.ts` (4) + golden T1-T4/7b-7e.
- **dist rebuild** (`a5289ae`); `pm2 restart api` → online; baselines green: chat 271/0, golden 37/0, structured 118/0, payment 46/0, shipping 8/0; `tsc --noEmit` + `npm run build` exit 0.
- **E2E live** (curl `POST /api/messages/handle`, store Canary `store-f7140b5c`, api port 3000, LLM key dari env api — bukan test key terpisah; seed product `Sepatu` hasVariants + variant `merah/size L` pada canary, sebelumnya 0 produk):
  - (a) "ada sepatu?" → `source:"product"`, balasan `…cek di toko web kami: https://qlobot.web.id/c/store-f7140b5c` + "(ada varian)", tidak ada "masukkan ke keranjang".
  - (b) "saya mau sepatu merah size L" → `source:"ai"`, balasan `🛒 Ditambahkan ke keranjang: sepatu x1`; draft `OrderItem` conv `e2e-conv-b` punya `variantId=b619cdf8-e533-41f9-ab6c-69da089175f7` (attrs `{"size":"L","color":"merah"}`) — `resolveVariantByLabel` match teks LLM → variantId.
Alasan: single error surface (§2.3/§6A.1) sudah ada sejak `0425f8d` (URGENT); PV-P2c full stack melengkapi layer representasi WA (storefront redirect inquiry) + LLM variant text → DB-driven `variantId` — menutup gap "WA variant belum tersentuh".
Siapa yang setuju: owner (Panji), AI CLI (Kilo).

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

### 20 Agu 2026 — G2-F1/F2/FIX-A/FIX-B: Order payment (manual transfer/QRIS) + baseline chat flaky
- Konteks: G2-F (Checkout/Order/Payment) dikerjakan sebagai endpoint manual-transfer/QRIS
  (tanpa payment gateway). G2-F1 tambah field paymentMethod/paymentStatus/paymentProofUrl/
  paymentReportedAt/paymentVerifiedAt/verifiedByAdminId ke Order + perbaiki bug
  `updateOrderStatus()` yang bypass `transitionOrder()`. G2-F2 tambah `POST /api/pwa/:storeSlug/
  payment-report` (customer) + `POST /api/orders/:id/payment-verify` (admin) dengan kontrak:
  approve memanggil `transitionOrder(targetOrderStatus)` dalam 1 transaksi, COD ditolak 400.
  FIX-A ubah `verifiedByAdminId` dari `storeId` → `req.user.email`. FIX-B investigasi read-only
  baseline `test:chat` (reasoning-v2 + engine-config-v2) yang dulu gagal.
- Keputusan: G2-F1 + G2-F2 + FIX-A SELESAI & VERIFIED (tsc 0, build 0, payment.test 10/10,
  seluruh suite hijau, pm2 api online). Provider = manual transfer/QRIS only; COD settlement
  DEFERRED (DECISION-COD-SETTLEMENT-DEFERRED.md). FIX-B: baseline chat dikonfirmasi FLAKY
  (bukan permanent-fail) — 5/5 run terpisah PASS (270/270); `container.ts:38` (`const cache =
  redisAdapter`) tidak berubah sejak 7 Agu & tidak ada commit terkait di antara baseline dan
  sekarang. Catatan: cycle import `container.ts`↔adapter sudah diputus di sisi adapter via
  FIX-5/III-10 (dynamic import) sehingga TDZ tidak lagi reproduksi.
- Alasan: per-instruction, lanjut G2-F3 (PWA) setelah backlog commit bersih; baseline chat TIDAK
  ditandai RESOLVED (status flaky, investigasi init-order redisAdapter belum dilakukan).
- Siapa yang setuju: owner (Panji), Claude.

### 20 Agu 2026 — KOREKSI entri di atas (G2-F2-DOCS-CORRECT)
- **Koreksi hash FIX-5:** entri di atas merujuk FIX-5/III-10 dengan hash `60eb1f3`. Hash
  tersebut **STALE/dangling** — hash benar di `main` adalah `6385322`
  (`6385322 refactor(adapters): break container cycle import via dynamic import (FIX-5, III-10)`).
- **Koreksi kesimpulan II-2 (engine-config-v2):** pernyataan "tidak ada commit terkait / flaky,
  root cause container.ts:38 TIDAK berubah sejak 7 Agu" adalah **SALAH**. Root cause (cycle import
  `container.ts`↔3 adapter) SUDAH ditangani FIX-5 (`6385322`, III-10) **SEBELUM** investigasi FIX-B
  dilakukan. FIX-B kemarin salah scope grep — hanya mengecek `container.ts`, tidak mengecek 3 file
  adapter (`cloudinary.adapter.ts`, `r2.adapter.ts`, `gowa.adapter.ts`) yang sebenarnya diubah
  (static `import { adapters }` → dynamic `await import('../container.js')` di dalam `getAdapters()`).
  Lihat BUG-BELUM-DIBERESKAN.md II-2 (sekarang RESOLVED).
- **II-1 (reasoning-v2): BELUM dikoreksi status-nya di sini** — status final menunggu hasil
  investigasi terpisah (G2-F2-DOCS-CORRECT Bagian B). Lihat BUG-BELUM-DIBERESKAN.md II-1.

### 20 Agu 2026 — interpreter maxTokens fix (G2-F3 testing, opportune)
- **Temuan:** saat testing G2-F3, chat selalu balas `"Maaf kak, saya kurang paham. Bisa
  diulang?"` (dead-end `conversation.service.ts:711`). Akar: Gemini 3.6-flash thinking
  tokens (~140) vs `interpreter.ts` `maxTokens: 250` lama → JSON ter-potong → `JSON.parse`
  gagal → `runOneCall` null → dead-end tiap pesan. Groq tidak pernah fallback (Gemini 200).
- **Fix:** `interpreter.ts` `maxTokens -> 1024` + `extractJson()` hardening. Commit
  `81ea8a6`. Verifikasi E2E PWA `/message` + 40/40 test pass.
- **Konteks (RAILS §1.4 exception):** ditemukan opportunistically saat testing G2-F3, di
  luar scope TASK G2-F3 asli. Exception §1.4 berlaku karena genuinely blocking (chat
  sepenuhnya mati), bukan nice-to-have, dan sudah diverifikasi lengkap (root cause +
  bukti E2E + test) SEBELUM dilaporkan — bukan sekadar di-skip.
- **Dampak:** TIDAK ADA customer terdampak, website belum rilis. Ini konteks severity
  (bug production-blocking secara teknis, tapi belum ada trafik nyata), BUKAN alasan
  untuk melewati proses investigasi/verifikasi.

### 20 Agu 2026 — G2-F4: Dashboard payment verification UI + `valid-next-states` endpoint
- **Konteks:** G2-F4 tambah halaman dashboard "Verifikasi Pembayaran" yang menampilkan order
  `paymentStatus='pending_verification'` (tenant-scoped via storeId, filter `?paymentStatus=`
  di `GET /api/orders`) + bukti transfer (gambar/link), method, dan `paymentReportedAt`.
  Approve WAJIB memilih `targetOrderStatus` eksplisit dari daftar transisi valid yang di-fetch
  dari endpoint baru `GET /api/orders/:id/valid-next-states` (reuse `getAllowedTransitions`,
  single source of truth). Reject panggil `POST /:id/payment-verify` `{decision:'reject'}`.
- **Keputusan:** G2-F4 SELESAI & VERIFIED — tsc 0, dashboard build 0, e2e baru
  `payment-verify-routes.e2e.test.ts` 7/7, `payment.test.ts` 10/10 (tanpa regresi), pm2
  api+dashboard restart, manual live approve/reject + DB readback before/after. Commit `ed41e0c`.
- **OPEN ITEM KECIL (bukan bug):** reject TIDAK wajib pakai reason. Ini keputusan scope G2-F2
  yang sudah LOCKED — `verifyPayment` reject hanya terima `{decision:'reject'}`, tidak ada field
  reason, dan endpoint dilarang diubah (kontrak final). Kalau owner mau reason wajib di reject,
  itu perubahan kontrak TERPISAH (bukan bagian G2-F4). Frontend juga TIDAK auto-retry/tebak ulang
  kalau backend tolak target — pesan error backend ditampilkan apa adanya.
- **Alasan:** backend (G2-F2) MEWAJIBKAN admin kirim `targetOrderStatus` eksplisit saat approve
  (tidak boleh ditebak sistem). Maka dashboard wajib sediakan UI pemilihan dari transisi valid,
  bukan satu tombol "Confirm" polos. Hardcode state machine di frontend ditolak (risiko drift);
  endpoint `valid-next-states` jadi single source of truth supaya UI mengikuti backend bila
  ALLOWED_TRANSITIONS berubah. Tidak ada field/table baru — `valid-next-states` murni read endpoint.
- **Siapa yang setuju:** owner (Panji), AI CLI.

### 20 Agu 2026 — G2-F5: CI coverage audit + golden dataset checkout/payment
- **Audit (BAGIAN A, read-only):** seluruh suite test G2-F (F2/F3/F4) TIDAK pernah dijalankan
  CI sejak masing-masing dibuat — gap tersembunyi paling lama ~4h28m.
  - `apps/api/src/business/tests/payment.test.ts` (G2-F2, 10 test) — ada di `src/business/tests/`,
    TIDAK di-wire ke script npm manapun → TIDAK ter-cover sejak `ebc4637` (01:46 UTC).
  - `apps/api/src/tests/pwa-checkout.test.ts` (G2-F3, 8 test) — di `src/tests/` tapi tidak masuk
    list explicit `test:golden` maupun glob `test:structured` (`structured-actions*`) → TIDAK
    ter-cover sejak `16a954b` (05:05 UTC).
  - `apps/api/src/tests/payment-verify-routes.e2e.test.ts` (G2-F4, 7 test) — sama, tidak masuk
    `test:golden`/`test:structured` → TIDAK ter-cover sejak `ed41e0c` (06:02 UTC).
  - `test:chat` (jest) HANYA jalankan `src/services/chat/__tests__/**` + `src/services/chat/tests/**`
    (lihat `jest.config.cjs`), sehingga file node:test di luar chat otomatis tidak ke-cover.
  - Ini pola sama persis II-6 / P8-CI-FIX (`c6be2d8`): seluruh cluster fitur payment/checkout
    (F2+F3+F4) bisa regresi tanpa CI merah.
- **Fix (BAGIAN B):** `apps/api/package.json` tambah script `test:payment` (list explicit 4 file:
  `payment.test.ts` + `pwa-checkout.test.ts` + `payment-verify-routes.e2e.test.ts` +
  `golden-payment.e2e.test.ts`) — domain-based naming, bukan phase-based. `.github/workflows/test.yml`
  tambah step `Run test:payment` SETELAH `Run test:structured` (MUST pass, 0 failure), ikuti pola
  P8-CI-FIX. Verifikasi lokal full sequence test:chat (270/270) → test:golden (26/26) →
  test:structured (115/115) → test:payment (30/30), semua exit 0, tanpa interaksi antar-suite.
- **Golden dataset (BAGIAN C):** file BARU `apps/api/src/tests/golden-payment.e2e.test.ts` (5 case,
  mutation-tested pola P6-5) — dipisah dari `golden-dataset.test.ts` (chat-pipeline) agar tidak
  mengganggu baseline 26/26 dan scope-nya jelas ke `test:payment`. Case:
  (a) draft→checkout transfer→payment-report→verify approve(target=paid)→paymentStatus=paid +
  orderStatus berubah; (b) COD checkout→tetap waiting_address, payment-report order COD→400;
  (c) verify reject→paymentStatus=rejected, orderStatus TIDAK berubah; (d) verify approve TANPA
  targetOrderStatus→400; (e) verify approve targetOrderStatus TIDAK VALID→rollback penuh,
  paymentStatus tetap pending_verification.
- **Mutation test (WAJIB, ×5):** tiap case dibuktikan guard-nya load-bearing — revert 1 baris fix
  di `payment.service.ts` → case jadi MERAH, kembalikan → HIJAU. Target mutasi:
  (a) `paymentStatus:'paid'` di tx update → case (a) gagal assert paid;
  (b) guard `order.paymentMethod==='cod'` → case (b) dapat 200 bukan 400;
  (c) `paymentStatus:'rejected'` di reject → case (c) gagal assert rejected;
  (d) guard `if(!targetOrderStatus) throw` → case (d) dapat 200 bukan 400;
  (e) `catch` `InvalidOrderTransitionError` di-swallow (hilang rollback) → case (e) dapat 200 +
  paymentStatus 'paid' bukan 400/pending_verification. SEMUA mutasi di-revert (payment.service.ts
  tidak ada perubahan permanen — `git diff` bersih).
- **Keputusan:** G2-F5 SELESAI & VERIFIED — tsc 0, test:payment 30/30, full CI sequence hijau,
  mutation ×5 proven. Commit `e293040`. TIDAK ada perubahan logic `payment.service.ts`/
  `order-transition.ts`/`payment-verify` (hanya test + CI).

---

## 6.x LOG POST-HOC — cluster G2-G monitoring + shipping-cost full-stack + Store NOT NULL (DOCS-SYNC 21 Agu 2026)

> **⚠️ PENTING — jangan disamarkan sebagai laporan tepat waktu.** Entri di bawah
> dicatat RETROAKTIF lewat TASK DOCS-SYNC (21 Agu 2026), BUKAN saat commit
> aslinya dikerjakan. Commit asli (range `2a93924..2e64c0a`) SUDAH di-push di
> sesi SEBELUMNYA tanpa bukti RAILS §1.2 real-time — pola SAMA dengan insiden
> P6 / III-1-B lama. Setiap entri wajib marker:
> **[LOG POST-HOC — commit asli dikerjakan & di-push tanpa laporan real-time
> dengan bukti RAILS §1.2, ditutup post-hoc via TASK DOCS-SYNC 21 Agu 2026].**
> Bukti RAILS §5 (tsc 0 / `npm run build` / test) ada di pesan commit masing-masing;
> doc ini mensinkronkan STATE, bukan mengulang bukti mentah.

### [POST-HOC] 21 Agu 2026 — G2-G baseline audit + monitoring (system metrics)
**[LOG POST-HOC — commit asli dikerjakan & di-push tanpa laporan real-time dengan bukti RAILS §1.2, ditutup post-hoc via TASK DOCS-SYNC 21 Agu 2026]**
- Commit: `dd20696` (`docs: save G2-G realtime/scale baseline audit`) +
  `b18b6d5` (`feat: basic system metrics endpoint`).
- Isi: (1) `AUDIT-BASELINE-G2-G.md` — pemetaan kondisi realtime/scale SEKARANG
  (Socket.IO in-memory adapter, Redis usage, pm2 config, health/monitoring,
  gap kritis multi-instance). READ-ONLY, belum ada implementasi. (2) Endpoint
  `GET /api/admin/metrics/system` (di bawah `adminAuthMiddleware`) mengembalikan
  `memory` (rss/heap/external), `uptime`, `requests` (snapshot rolling window
  in-memory dari `metrics.middleware.ts`). **Sengaja dipisah dari `/api/health`**
  (LB probe tetap SELECT 1 ringan). In-memory → **single-instance only**, belum
  ada agregasi lintas pm2 instance.
- Keputusan: G2-G RESMI masuk fase "baseline terpetakan", breakdown sub-fase
  (realtime hardening / scale) BELUM diputuskan. Monitoring dasar tersedia untuk
  diagnostik manual. Siapa yang setuju: owner (Panji), Claude.

### [POST-HOC] 21 Agu 2026 — Shipping-cost full-stack (RajaOngkir Komerce)
**[LOG POST-HOC — commit asli dikerjakan & di-push tanpa laporan real-time dengan bukti RAILS §1.2, ditutup post-hoc via TASK DOCS-SYNC 21 Agu 2026]**
- Range: `490e853`..`2e64c0a` (foundation → UNIT1–UNIT6), dengan dependency
  `3d501dc`/`a6c62ec`/`d7c57aa`/`1f3452d`/`a2c6665`/`270e4ba`/`7130b4a`/
  `99b119c`/`2f27779`/`3aa78fd`/`2d9a1a3`.
- Isi (provider-agnostic, interface di `shipping-cost-provider.interface.ts`):
  - **Foundation (`490e853`):** `RajaOngkirStarterAdapter` + `CachedShippingCostService`
    (Redis cache 7d) + quota guard harian. Saat itu BELUM di-wire ke checkout.
  - **Location reference (`3d501dc`):** `RajaOngkirLocationAdapter` — search
    province/city/subdistrict via RajaOngkir, 30d cache. Endpoint admin/merchant
    `.../locations/provinces|/cities|/subdistricts`.
  - **Store origin (`a6c62ec`/`d7c57aa`):** `Store.originProvinceId/Name`,
    `originCityId/Name`, `originSubdistrictId/Name` (RajaOngkir IDs); profile
    GET/PUT extend; dashboard cascading dropdown origin.
  - **Komerce v2 migration (`1f3452d`/`a2c6665`):** adapter diarahkan ke
    **RajaOngkir Komerce API** (search-based province/city/subdistrict) + cost
    adapter migrasi ke **Komerce v2** (subdistrict-native, flat response parser).
    Ini yang MENGKOREKSI keputusan COD: owner mengevaluasi RajaOngkir sbg
    kandidat Opsi (B) fulfillment → TERNYATA RajaOngkir = kalkulator ongkir,
    BUKAN pelacak status kirim (lihat DECISION-COD-SETTLEMENT-DEFERRED.md,
    bagian "Opsi (B) RESMI DITUTUP", commit `09b257a`).
  - **Product weight (`270e4ba`/`7130b4a`/`99b119c`):** `Product.weight` (gram,
    **NOT NULL default 0 placeholder**), API-required untuk produk baru;
    magic-paste ekstrak weight + flag `needsWeightInput`; dashboard form wajib
    Berat + warning.
  - **Public locations + order destination (`2f27779`/`3aa78fd`/`2d9a1a3`):** mount
    **PUBLIC** `GET /api/pwa-locations/*` (tanpa auth, `pwaLocationsLimiter`
    30 req/15m untuk lindungi quota harian) + Order destination fields
    (province/city/subdistrict, nullable, backward-compatible) + PWA checkout
    cascading dropdown.
  - **UNIT1–UNIT6 (`75344b5`..`2e64c0a`):** (1) nullable `Order.shippingCost` +
    `shippingService` (schema+migration+types); (2) `getOrderWeightGrams` read-only
    helper (sum weight produk × qty) + test; (3) `GET /api/pwa/:slug/shipping-options`
    read-only + limiter + tests; (4) `POST /api/pwa/:slug/select-shipping`
    server-recomputed cost (pakai origin store + destination + berat order) + tests;
    (5) auto-reset ongkir saat destination berubah di checkout + tests; (6) PWA
    checkout UI cek ongkir + tampil di receipt (kwitansi).
- Keputusan: shipping-cost SELESAI ter-wiring end-to-end ke checkout PWA
  (origin store + destination customer + berat order → pilihan kurir → simpan
  `shippingCost`/`shippingService` di Order). RajaOngkir/Komerce tetap
  **cost calculator**, BUKAN tracking; Opsi (B) COD ditutup. Risiko disengaja
  diterima owner: caching hasil cost bisa membawa ban dari RajaOngkir (interface
  swap-able). Siapa yang setuju: owner (Panji), Claude.

### [POST-HOC] 21 Agu 2026 — Store NOT NULL registration (pre-launch hardening)
**[LOG POST-HOC — commit asli dikerjakan & di-push tanpa laporan real-time dengan bukti RAILS §1.2, ditutup post-hoc via TASK DOCS-SYNC 21 Agu 2026]**
- Range: `03bce76` → `a8b3928` → `525e271` → `b5f50fc` → `d3c7855`.
- Isi: (1) **Schema NOT NULL (`03bce76`):** `Store.phoneNumber`, `address`,
  `originProvinceId/Name`, `originCityId/Name`, `originSubdistrictId/Name` → NOT
  NULL. Migration isi placeholder empty-string untuk row dev/test nullable lalu
  ALTER SET NOT NULL (aman di prod baru = 0 row). (2) **Register schema
  (`a8b3928`):** `storeRegisterSchema` wajib phoneNumber (format HP ID), address,
  origin* (string wajib, `.trim()` tolak whitespace-only → 400); `/register`
  kirim field tervalidasi ke `store.create`; `/login` auto-create dihapus
  (redirect ke `/register`). (3) **Dashboard form (`525e271`):** `RegisterSaaS.tsx`
  tambah No. HP + Alamat + 3 dropdown kaskade (fetch `/api/pwa-locations/*`
  PUBLIC) — tombol Daftar disabled sampai lengkap & valid. (4) **Test data
  (`b5f50fc`):** 13 file test upsert tambah dummy valid NOT NULL store. (5)
  **Null-write fix (`d3c7855`):** `PUT /api/auth/profile` + `PUT /api/profile`
  ganti pola `field = value || null` → kalau field DIKIRIM tapi kosong → 400
  "tidak boleh dikosongkan"; field TIDAK dikirim (undefined) → skip. Field
  nullable lain (description, businessCategory) tetap `|| null`.
- Keputusan: registrasi toko SEKARANG wajib phone+address+lokasi (asal & tujuan
  checkout), pre-launch data hygiene. Tidak ada customer terdampak (belum rilis).
  Siapa yang setuju: owner (Panji), Claude.

### 22 Agu 2026 — INSIDEN KEAMANAN: `.env` ter-track di git history + purge + recovery
**[LOG — diverifikasi INDEPENDEN via git + filesystem, 22 Agu 2026, lihat BUG-BELUM-DIBERESKAN §VII]**

- **Temuan:** `git check-ignore .env` KOSONG (tidak di-ignore), `git ls-files | grep -x .env`
  mengembalikan `.env` (TER-TRACK), dan `git log --all --oneline -- .env` menunjukkan
  `.env` pernah di-commit sekali di `a417632` ("Webhook secret validation + migrasi VPS 7
  Agustus"). `a417632` ADALAH ancestor `origin/main` → snapshot `.env` (berisi secret asli:
  `DATABASE_URL`, `GROQ_API_KEYS`, `GEMINI_API_KEY`, `CLOUDINARY_*`, `R2_*`,
  `FIELD_ENCRYPTION_KEY`, `CLOUDFLARE_WORKER_*`, `WEBHOOK_SECRET`, `BACKUP_ENCRYPTION_KEY`,
  dll) SUDAH ter-push ke GitHub `pandjiemadiun/whatsapp-crm`. Exposure sudah keluar dari
  server lokal.
- **Purge (III-2-B pola sama):** `git bundle create
  /home/ubuntu/backups/garuda-backup-pre-env-purge-20260821.bundle --all` (verified OK)
  lalu `git filter-repo --path .env --invert-paths --force`. WARNING: `git filter-repo`
  menghapus file `.env` ASLI dari disk (checkout tree baru tanpa `.env`) — efek samping
  yang harus di-recovery.
- **Force-push:** `git remote add origin ...` (filter-repo hapus remote otomatis) lalu
  `git push origin --force --all` → `6385322...3d86fe2 main -> main (forced update)` +
  branch `task-pwa-shipping` baru di-push. Verifikasi remote BERSIH: clone fresh
  `/tmp/verify-clean`, `git log --all -- .env` KOSONG, `.env` tidak tracked di remote.
- **Merge:** `git checkout main && git merge task-pwa-shipping --no-ff` → merge commit
  **`ea1f0c2`** (HEAD `main` SEKARANG, terverifikasi `git log origin/main -3`). Pre-purge
  local `main` = `525e271`; post-purge `main` = `3d86fe2`; final merge = `ea1f0c2`.
- **Recovery `.env` dari proses hidup:** `pm2 pid api` = `1032975` (masih jalan).
  `sudo cat /proc/1032975/environ | tr '\0' '\n' > /tmp/env-recovered-raw.txt` (136 baris)
  lalu filter 25 variabel aplikasi → `/home/ubuntu/garuda/.env`. Dua variabel
  (`RAJAONGKIR_API_KEY`, `RAJAONGKIR_DAILY_QUOTA`) TIDAK ada di env proses (belum pernah
  di-inject ke pm2) → owner tambahkan manual kemudian (`RAJAONGKIR_DAILY_QUOTA=100` +
  `RAJAONGKIR_API_KEY` dari owner). Backup di LUAR git:
  `/home/ubuntu/backups/env-recovered-20260821.env` (chmod 600).
- **Proteksi:** `.env` SUDAH ada di `.gitignore` (baris 2); `.env.example` (placeholder,
  tanpa nilai asli) dibuat & ter-track (`8ba77c9`). `.env` asli TIDAK boleh di-commit lagi.
- **Keputusan:** server `api` restart sukses (online, pid berganti), full regresi hijau
  (test:chat 270/270, test:golden 26/26, test:structured 115/115, test:payment 46/46).
  **ROTATE semua secret DITUNDA sampai sebelum GO-LIVE** per keputusan owner (rotate
  seluruh secret kecuali `RAJAONGKIR_API_KEY` yang tidak pernah ter-expose).
- Siapa yang setuju: owner (Panji), Claude — diverifikasi independen 22 Agu 2026.

### 22 Agu 2026 — G2-H Release Readiness: closure cluster (real-time, dilaporkan saat commit)

Konteks:
G2-H (gate terakhir release readiness) dikerjakan sebagai serangkaian unit terverifikasi:
audit 10-item → shipping test CI → backup restore rehearsal + fix → VAPID/web-push env →
smoke-fase4 fixture → rate-limiter gaps. Semua bukti dari commit asli (`git show --stat`) +
runtime log, dilaporkan saat commit (BUKAN post-hoc / retroaktif).

Keputusan:
- `e16679d` — `test:shipping` di-wire ke CI (script + step setelah `test:payment`, MUST pass 0
  failure) + fix hardcoded quota date (`wibDateKey()`). SHIPPING-CI-GAP (VI-1) RESOLVED.
- `0d29aaf` — backup restore rehearsal NYATA menemukan `restoreDatabase` pipa dump custom-format
  ke `psql` (gagal); diganti `pg_restore --clean --if-exists` (idempoten) + manifest upsert +
  `backup:create` clean exit. RESOLVED (bukti: full restore sandbox DB EXIT 0, row-count +
  checksum cocok). Ini bukti kenapa rehearsal restore penting — dry-run tidak menangkap format mismatch.
- `be8aff4` — smoke-fase4 Store fixture diperbaiki untuk field NOT NULL. RESOLVED (smoke 63/63,
  termasuk "web push sent").
- VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT + FASE4 web-push notification: env-only, terverifikasi
  via runtime log "FASE4 notification service initialized" + smoke 63/63. RESOLVED (tanpa commit source).
- `10be048` — generalLimiter (sebelumnya DEAD CODE, tidak pernah dipasang) di-mount sebagai global
  safety net (15m/1000/IP) + 11 endpoint publik tanpa proteksi dapat limiter (reuse existing:
  orderMutationLimiter / conversationLimiter / pwaProductsLimiter). RESOLVED.
- SSL/HTTPS: certbot terverifikasi manual — certificate valid, expiry 2026-11-05, auto-renew via
  certbot.timer aktif. RESOLVED (infra-only, tanpa kode).

Alasan:
G2-H Release Readiness praktis SELESAI. Dua item SENGAJA DEFERRED (bukan bug blocking):
(1) Rotate seluruh secret — `VII-A`, DITUNDA sampai sebelum GO-LIVE (per keputusan owner, sudah
di-record di entri `.env` 22 Agu di atas); (2) BACKUP_ALERT_EMAIL env sudah terisi tapi TIDAK ADA
email sender terpasang di manapun di `src` (no SMTP/nodemailer) → alert kegagalan backup TIDAK akan
terkirim; ini GAP terbuka baru (Medium, silent-failure), dilaporkasi sebagai item terpisah di
BUG-BELUM-DIBERESKAN §VI-5 + PROJECT-STATE §6.10.

Siapa yang setuju: owner (Panji), AI CLI (Kilo).

### 28 Agu 2026 — Admin security cluster: public registration exposure + engine.ts unauthenticated routes (real-time, dilaporkan saat commit)

Konteks:
POST /api/admin/auth/register terbuka ke publik internet tanpa gate (konfirmasi live via curl
mengembalikan 201 untuk request tanpa auth). Kombinasi dengan temuan AUDIT-BASELINE
(admin tidak punya store-ownership scoping — Finding 1-4) berarti siapapun di internet bisa
self-register sebagai admin dan langsung dapat akses global ke semua merchant stores. Terbongkar
saat verifikasi live POST /register mengembalikan 201 untuk email test
`exposure-check-DO-NOT-USE@example.invalid`.

Temuan terpisah: `src/routes/admin/engine.ts` (4 route yang mengontrol versi AI engine yang
memproses pesan customer — v1 vs v2, canary metrics) sama sekali TIDAK ada auth middleware-nya,
masuknya langsung dari `app.use('/api/admin/engine', ...)` tanpa `adminAuthMiddleware`.

3 baris `admin_users`Existing diaudit: `metrics-test@garuda.local`, `m2@garuda.local`,
`exposure-check-DO-NOT-USE@example.invalid` — None belonged to owner, semua di-deactivate
(`isActive=false`, tidak di-hard-delete, audit trail preserved). Owner kemudian registrasi
akun super_admin baru (`pandjie@yahoo.com`).

Keputusan:
- `b64babf` — gating bootstrap-once pada POST /register: route TERBUKA hanya ketika
  belum ada super_admin aktif (count=0), kemudian LOCKED permanen. Saat bootstrap mode,
  role WAJIB diset `super_admin` terlepas dari apa yang dikirim di request body (tested:
  kirim `role=support_admin` tetap dapat `super_admin`). Setelah super_admin pertama
  ter-create, route memerlukan `adminAuthMiddleware` + `requireAdminRole(['super_admin'])`
  untuk setiap registrasi selanjutnya. Verified via live curl: 201 di bootstrap state,
  401 di locked state.
- `ae40461` — `adminAuthMiddleware` ditambahkan ke semua 4 route engine.ts. GET routes
  (read-only metrics/config) cukup `adminAuthMiddleware` (any authenticated admin).
  POST `/:storeId` (mutates engine version untuk seluruh store) ditambahkan
  `requireAdminRole(['super_admin'])` — konsisten dengan pola `config.ts` PUT/DELATE +
  `backups.ts` restore/delete yang sama-sama memerlukan super_admin untuk aksi destruktif.
  Verified via live curl: 401 tanpa auth, 200/403 dengan auth sesuai role.

Alasan:
Keduanya adalah security-critical gap yang confirmed live, bukan teori. Admin panel di-
akses oleh owner's own team (internal-only, confirmed oleh owner) — store-ownership scoping
( Finding 1-4 ADMIN-TENANT-ISOLATION-AUDIT-BASELINE.md ) SENGAJA DITUNDA, bukan lupa:
belum ada admin kedua, membangun RBAC sekarang adalah solving for user yang belum ada.
Owner separately setting up Cloudflare Access (infra-level, di luar repo ini) sebagai lapisan
tambahan di depan /admin — ini adalah owner's own action, bukan bagian dari commit repo.

Siapa yang setuju: owner (Panji), AI CLI (Kilo).
---

## §6. Real-time log (29 Agu 2026)

### 08:32–09:15 UTC — Stock Integrity Fix (PV-P1-08) + Tenant Isolation

- **Status:** ✅ Implementation complete, verified
- **Commits pending:** All source changes built, tests passing
- **Key changes:**
  - `cart-authority.checkout()`: atomic decrement via `updateMany` CAS (`stock >= qty`), `autoCancelAt` timestamped
  - `order.service.cancelOrder()`: stock restore before transition (`restoreStockForOrderItems`)
  - `routes/orders.ts:PUT /:id/status`: cancel path now restores stock
  - `scheduleAutoCancel.ts`: new 15-min cron for idle orders, skips `pending_verification`
  - `ORDER_AUTO_CANCEL_HOURS` env var added (default 24h)
- **Test coverage:** 13 new tests passing (unlimited skip, decrement, race, cancel, auto-expire)
- **Regression:** test:chat 271/271 unchanged, all other suites 0 failures

### Pending commit:
  - [ ] Commit source changes
  - [ ] Update `DECISION-CANCEL-ORDER-STATE-MACHINE.md` (amendment for handleCancelOrder → cancelOrder flow)
  - [ ] Push with verified diff stat

---

## §6. Real-time log (30–31 Agu 2026)

### 02:00–05:50 UTC — Tenant isolation re-audit + merchant push + dead code removal

- **Status:** ✅ Implementation complete, verified, pushed
- **Commits pushed:** `9852477`, `e0715f8`, `0c7beb7`, `55216e0`, `1f0c215`, `fc2e6cf`
- **Key changes:**
  - **Tenant isolation re-audit (CRITICAL):** Owner-insisted deliberate re-audit found 2 real bugs:
    - Cross-tenant message injection via `POST /api/messages/handle` (IDOR) — `processCustomerMessage` upserted conversation by PK alone, ignoring storeId mismatch. Fixed: ownership check BEFORE upsert (throw 403) + `storeId` added to WHERE clause of all internal conversation update/findUnique calls (`9852477`).
    - Unprotected GOWA webhook — `gowaTrustMiddleware` existed but never mounted; store lookup compared plaintext against encrypted `phoneNumber`. Fixed: mounted middleware (loopback-only) + added `phoneNumberHash` column (HMAC-SHA256) for indexed lookup (`e0715f8`).
  - **Duplicate phone registration validation:** Pre-check via `phoneNumberHash` + catch-block mapping for 409 vs 400 responses (`0c7beb7`).
  - **Merchant push notifications:** `StorePushSubscription` table + `push.service.ts` (shared sendPush) + `merchant-push.service.ts` (order/payment/message listeners, dedup against admin socket presence). Dashboard: manifest.json, sw.js, MerchantNotificationPrompt. Verified on real device (FCM 201) (`55216e0`, `1f0c215`).
  - **message.handler.ts removal:** Confirmed dead code (zero callers) via two independent audits (Qwen external + internal). Removed rather than deprecated-in-place given bypass-pipeline risk (`fc2e6cf`).
- **Test coverage:** 480/480 regression tests pass (chat 271, golden 37, structured 118, payment 46, shipping 8).
- **pm2 env audit:** Clean, 2 minor findings (GITHUB_PAT, WEBHOOK_SECRET unused).
- **External audit (Qwen) cross-check:** 13/14 claims false (gitingest silently dropped `cart-authority.ts`, `action-registry.ts`, `conversation.service.ts` from digest with no warning). 1 valid (message.handler.ts dead code, now removed).

### Lesson learned (matches §10.3 actionsRouter precedent):

Passing tests ≠ real isolation. The tenant-isolation bugs were found via deliberate re-audit AFTER initial "all clear" reports. Third-party audit tools can silently drop critical files from their digest — always verify the tool's input actually contains the files you care about before trusting OR dismissing findings.
