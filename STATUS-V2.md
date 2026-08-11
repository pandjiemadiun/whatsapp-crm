# STATUS ENGINE V2 — 9 Aug 2026 00:05 WIB


## KONTEKS BESAR
Canary engine v3.2 di toko store-f7140b5c. Tujuan: buktikan 3 bug asli fix
(multi-add, negasi, total) sebelum rollout ke tenant lain.


## YANG JALAN (verified produksi)
- Flag v2 aktif; branch v2 terpanggil (log "Engine v2 active")
- Fast-path tier: katalog, total, hapus cart, greeting
- storeId fix (produk tampil benar)
- Resolved (jawaban klarifikasi) dengan total benar
- Circuit breaker v2->v1 bekerja


## YANG MASIH RUSAK
1. FLAGSHIP: multi-add ("mau wortel kangkung kentang") disergap tier
   disambiguasi produk -> klarifikasi; LLM tidak dipanggil (llmCalls=0).
2. Receipt tampil item qty 0 ("Brambang (0x)").
3. Reply resolved terpotong ("adalah?") - kosmetik.
4. Test reasoning-v2 "terminal->fallback" outdated (harusnya expect reasoned).


## LANGKAH SESI BERIKUTNYA
1. Baca fast-path.ts + fallback.service.ts. Cari ResponseSource PERSIS dari
   reply "Boleh dibantu dipastikan Kak, produk mana yang dimaksud?".
2. Buat fast-path return hit:false pada source tersebut.
   Alternatif robust: jika pesan mengandung >=2 nama produk katalog -> hit:false.
3. Verifikasi log: multi-add harus outcome=reasoned, llmCalls=1.
4. Filter qty<=0 di receipt.
5. Update test reasoning-v2 yang outdated.


## FAKTA PENTING
- webhook secret: <lihat DB: stores.webhookSecret>
- device/gateway: 6281231944200
- fonnteToken: sudah di-restore (asli)
- Redis flag: store-f7140b5c:engine = v2
- Test gratis: curl webhook + baca dashboard /dashboard/conversations
## DARI DOKUMEN LAMA — MASIH VALID, BELUM DIKERJAKAN
- I11: kamus slang normalizer (toralin→total) — typo masih lolos tier total
- I12: guard nama produk di normalizer — belum diverifikasi
- Golden dataset + test invarian permanen I8-I15 — baru test unit parsial
- Eskalasi ke pemilik toko setelah retry klarifikasi — **SELESAI & VERIFIED (TASK C1, commit 718c375)**: escalation sekarang set `conversation.status='human_takeover'`+`humanTakeoverAt` di kedua cabang ESCALATE (conversation.service.ts:419, 506) via `markHumanTakeover`, pakai balasan jujur (`composeEscalateReply`). Bukti DB readback Prisma: BEFORE {status:'open',humanTakeoverAt:null} → AFTER {status:'human_takeover',humanTakeoverAt:ISO}. Unit test `composeEscalateReply`/`escalateStatusUpdate` pass; full suite tetap 20p / 2 pre-existing-fail. Lihat catatan audit penuh + Stage 2 dilampir di bawah.
- Keputusan terbuka: "dua duanya" jika opsi >2; retry LLM dihitung panggilan atau tidak

## ROADMAP SETELAH ENGINE V2 STABIL: PWA WEB CHATBOX
- Blueprint lengkap ada di chat 9/8 00:50 (simpan sbg 04_PWA_BLUEPRINT.md).
- Prinsip: zero-friction auth (uid URL->localStorage), <300KB, multi-tenant
  qlobot.web.id/c/<slug>, UI mirip WA.
- 3 endpoint: GET /api/pwa/:slug/init, GET .../history?uid=, POST .../message
  (POST menembak pipeline AI sama -> gratis tanpa Fonnte).
- 5 milestone: skeleton -> session handoff -> 2-way chat -> manifest+katalog -> push.
- Bonus: M1-M3 = test harness gratis pengganti Fonnte.
- CATATAN: uid map ke conversationId existing (store:<nomor>); channel WA/WEB
  field terpisah, JANGAN timpa field source.

## UPDATE 9/8 10:45 — BUG FLAGSHIP (MULTI-ADD) CLOSED
1. fast-path: guard multi-produk+order-verb -> hit:false, ke LLM.
2. validator-v2 defensif + reasoning.ts try/catch; silent fallback v1 hilang.
3. executor: intent order/buy diterima + iterasi SEMUA entity per act.
4. composer-v2: reply tidak pernah kosong.
Acceptance lulus; Halo/katalog/total tanpa regresi.
NEXT: golden dataset I8-I15 + test WA kondisi nyata.

3 bug asli FIX: kentan hilang, negasi, total.
Test regresi permanen: 50 test v2 pass.
NEXT: golden dataset invarian I8-I15 untuk kunci permanen.

## UPDATE 9/8 — TASK A CLOSED: P0 SAFETY BOUNDARY (RAILS.md §3 P0)
Risiko paling bahaya dari audit 9/8 ("V2 mutate DB → exception → fallback v1 → 
proses ulang pesan sama → ANCAM dobel mutasi") DITUTUP di conversation.service.ts.

Mekanisme:
- `v2MutationExecuted` flag (false default) → di-set `true` BUKAN setelah 
  `executeCartOps` sukses (jalur resolved EXECUTE + reasoned/cartActs).
- Semua langkah post-mutation (saveWorkspace, composeReply, buildResult, 
  saveMessage) dibungkus local try/catch yang TIDAK melempar keluar:
  - kalau error → log CRITICAL + return safe reply statis (tanpa LLM) + return 
    early (tidak pernah menyentuh outer catch).
  - tanpa mutasi → error tetap di-lempar ke outer catch (v1 fallback dipertahankan)
    agar perilaku pre-mutation sementara yang lama tidak berubah.
Outer catch (circuit breaker v2->v1) TIDAK diubah.
Acceptance: test baru safety-boundary-v2.test.ts 5/5 pass (v1 never called, 
EXACTLY satu mutation, return reply tidak throw). npx tsc --noEmit 0 error, 
npx tsc OK, pm2 restart api online tanpa crash loop.
NEXT: golden dataset I8-I15 invarian untuk kunci permanen.

## TEMUAN TASK C1 — AUDIT ESKALASI KE PEMILIK TOKO (Stage 1, SELESAI)
Tanggal: 9 Agu 2026 (sesi ini)
Verdict: GAP NYATA — opsi (c). Eskalasi perclarification tidak memicu
tindakan ke owner, hanya balasan generik.

Bukti (file:line):
- validator-v2.ts:265-273 I-V2-4 (attempts>CLARIFICATION_MAX_ATTEMPTS)
  ok=false, retryable=false — logic benar & di-test validator-v2.test.ts:94.
  TAPI: reasoning.ts:224 `understand()` (yang memanggil validate/I-V2-4)
  HANYA dipanggil oleh SHADOW hook conversation.service.ts:657
  (background, fail-open) — bukan jalur keputusan produksi.
- Jalur produksi (conversation.service.ts) pakai runOneCall (line 582),
  bukan understand(). Eskalasi produksi = BAGIAN 2 pending resolver:
  * line 419-437 (resolvePending -> ESCALATE): kirim "Saya akan hubungkan
    ke pemilik toko." (source HUMAN) + RETURN EARLY.
  * line 506-524 (retry-exceeded): sama — cand message + return early.
- Pada KEDUA cabang: TIDAK ada pemanggilan prisma.conversation.update
  untuk status='human_takeover' / humanTakeoverAt.
  updateConversationStats (line 1037-1055) — yang SET 'status' — hanya
  dijalankan di jalur NORMAL, dan TIDAK pernah meng-set 'human_takeover'
  (konvensi hanya di-set oleh circuit breaker, lihat msg di line 1037).
- notifyHumanTakeover (message-processor.service.ts:485-498, yang SET
  status='human_takeover'+humanTakeoverAt) HANYA dipanggil oleh circuit
  breaker ketika LLM unavailable (line 217-220, 245-251) — trigger
  BERBEDA (infra LLM down), bukan "customer gagal klarifikasi 2x".
- Owner dashboard (admin/stores.ts:547) filter humanTakeoverAt != null;
  schema.prisma:150 punya kolom humanTakeoverAt DateTime?.
- Kesimpulan: opsi (a) status human_takeover TIDAK ter-set; opsi (b) tidak
  ada notifikasi WA/dashboard/email ke owner dari jalur clarify-retry;
  opsi (c) hanya cand balasan generik ("Saya akan hubungkan ke pemilik
  toko.") tanpa tindakan lanjutan. Ini yang dimaksud STATUS-V2.md lama
  "eskalasi — belum ada".

Stage 2 (fix) — dilakukan sesuai scope TASK C1:
- composer-v2.ts: tambah composeEscalateReply() (balasan jujur, bukan
  "kurang paham") + escalateStatusUpdate() payload konvensi existing.
- conversation.service.ts: kedua cabang ESCALATE/terminal panggil
  markHumanTakeover() (set status='human_takeover'+humanTakeoverAt)
  dan pakai reply yang jujur. Scope HANYA cabang escalate/terminal.
VERIFIED STAGE 1: audit+laporan selesai sebelum kode disentuh. Gap jelas
opsi (c) → diperbolehkan lanjut Stage 2 langsung per ketentuan TASK.

## DITEMUKAN SAAT KERJA — TASK P2 (Truth boundary), belum ditangani
1. `golden-dataset.test.ts` Case 1 (line 303): setelah TASK P2, resolver-EXECUTE
   (`conversation.service.ts:462` `validateCartOpsAgainstDb`) melewatkan ops
   untuk produk yang tidak ada di DB (`woltel`/`brambang` tidak terseed di
   `store-golden-test`, hanya `beras` yang di-seed via BASE_PRODUCTS). Perilaku
   P2 di sini TEPAT (skip produk tidak ada di DB, bukan reject transaksi total —
   lihat kontrak P2). Case 1 SEBELUMNYA "pass" hanya karena bug lama I13 yang
   mengeksekusi ops tanpa validasi harga DB. Test butuh `woltel`/`brambang`
   ditambahkan ke seed (atau BASE_PRODUCTS) agar kontraknya valid di bawah
   P2. DICATAT, belum diperbaiki — pemilikputuskan (owner flag, 10 Agu 2026).
   Bukti: `git stash` source-only → Case 1 PASS di HEAD (bug lama) → `pop` → FAIL
   (P2 benar). Bukan regresi kode; test-data issue yang terbuka semacamnya
   ekspos oleh perbaikan P2.
2. `golden-dataset.test.ts` Case B3-b (line 726): test bug — `assert.equal`
   (strict ===) dipakai pada array `audit.stagesReached`, selalu gagal karena
   reference inequality. PRE-EXISTING (ada di commit HEAD `2ab32ef`), bukan
   produk TASK P2. Bukti sama: `git stash` source-only → masih FAIL di HEAD.
   Routing tryProduct tetap benar (source=PRODUCT, content `kangkung`+harga,
   llmCalls=0 semua pass); hanya asersi array yang bug. DICATAT, belum
   diperbaiki per instruksi owner ("skip (b), jangan fix B3-b test bug").

## UPDATE — TASK P2 (truth boundary) SELESAI, 10 Agu 2026
- validateCartOpsAgainstDb dipasang di SEMUA titik eksekusi cart ops:
  resolver-EXECUTE (line 462, sudah ada di seed), interpreter LLM path
  (line 608, migrasi dari validateCartOps lama), v2 resolved-EXECUTE
  (line 214, wrap baru). Harga cart SELALU dari DB; produk tidak ada di DB
  tidak dieksekusi. `validateCartOpsAgainstDb` juga kini kembalikan
  `missing: string[]` agar missing_info tetap terisi.
- Bukti e2e (raw DB readback): pending cartOp `price:99999` (simulasi LLM)
  → confirmed_items `price:12000` (DB), llmCalls=0.
- tsc 0 error, build sukses, pm2 restart online (tidak crash-loop).
- Test: jest `src/services/chat/__tests__` = 2 failed/1 failed (baseline
  reasoning-v2 + engine-config-v2), TIDAK ada kegagalan baru. Golden suite
  (tsx) ada 2 red yang DICATAT bukan bug kode P2: lihat entry di atas.
- Lihat laporan-taskP2.md untuk seluruh acceptance verbatim.

## DITEMUKAN SAAT KERJA — TASK P3.0 (audit read-only, context boundary), belum ditangani
Audit read-only WorkspaceV2 vs legacy `ExtractedEntities`. Laporan penuh:
`laporan-taskP3-audit.md`. Ringkas:
1. **NO-OP v2 persist TERCONFIRM** (bukan dugaan): `saveWorkspace(workspace)`
   → objek `WorkspaceV2` (tidak punya `.length`) → `updateExtractedEntities`
   guard `if (!entities.length) return;` (conversation-context.service.ts:101)
   → `WorkspaceV2.length === undefined` → return segera (NO-OP). Call site:
   conversation.service.ts:232-233 (v2 resolved) & 316-317 (v2 reasoned).
   WorkspaceV2 **tidak pernah ditulis**, load di 141 selalu dapat object kosong
   → v2 kehilangan memori antar-turn. Klaim RAILS §2 benar. (RISIKO TINGGI)
2. **Shape kolom `extractedEntities` tak konsisten**: `updateExtractedEntities`
   pakai `parseEntities` (ARRAY, line 457) + `mergeEntities`, sementara
   `setPendingClarification`(318)/`modifyCart`(1397)/`parseExtractedEntities`(210)
   pakai bentuk OBJECT. Penulis array → parseExtractedEntities reset ke
   `{discussedItems:[], confirmedItems:[]}` → data hilang. (RISIKO TINGGI)
3. **Race last-write-wins**: kolom `extractedEntities` (1 row) ditulis v1 legacy,
   v2-via-modifyCart, + fallback.service.ts:997/1003, semua findUnique→update
   tanpa transaksi/lock. (RISIKO SEDANG — RAILS §2 sudah catat modifyCart
   non-transaksional)
4. v2 reasoned path tetap persist `confirmedItems` lewat `modifyCart` (1397),
   tapi `pendings`/`draft_cart`/`resolved_facts` v2 HILANG tiap turn.
   (RISIKO TINGGI — T1)
Saran urutan fix di §7 laporan-taskP3-audit.md. **Belum diperbaiki** — task ini
read-only saja per instruksi.


## UPDATE 10/8 — P3 (CONTEXT BOUNDARY) CLOSED
T1-T4 tertutup (workspace_v2 kolom baru, shape extractedEntities disatukan
OBJECT, v1->v2 migrasi legacy state, optimistic lock RMW). Commit
c164729/3780453/eb74929/099967a/fd08ba3. Test baseline tetap 2 failed/1
failed (tidak nambah). Race test T4: before 0/10 both-saved -> after 10/10.
Sisa belum digarap (di luar scope P3, item antrian): T5 fallback tier
overlap (RENDAH), appendMessage lastMessages race (belum diklasifikasi).
NEXT: P4 - Remove second brain (extractAndSaveOrder berhenti jadi
interpreter kedua untuk pesan yang sudah diproses v2).

## DITEMUKAN SAAT KERJA — TASK P4.0 (audit read-only, laporan laporan-taskP4-audit.md), belum ditangani
Audit read-only P4 menemukan bug luar scope (RAILS §1.4: catat, jangan fix).
Semua berkaitan dengan `orderService.extractAndSaveOrder()` (order.service.ts:101)
yang masih berjalan sebagai interpreter kedua/ketiga di jalur v1.
1. **I13 violation eksplisit**: baris `orders` yang dibuat `extractAndSaveOrder`
   (order.service.ts:128-139) tidak ada `unitPrice`/`totalPrice`, items
   `[{product, quantity}]` tidak divalidasi DB (kontras interpreter.ts:144 /
   conversation.service.ts:628). price=null di schema.prisma:214. → TASK terpisah.
2. **Provider/config drift**: extractAndSaveOrder pake `adapters.ai.generate`
   → `aiProviderManager` primary=**Gemini** (container.ts:30, manager.ts:63/34),
   temp 0.1, maxTokens 300, **tanpa jsonMode** (order.service.ts:77); sedangkan
   v1/v2 pakai `groqAdapter.generate` langsung, temp 0.2, maxTokens 250,
   jsonMode:true (interpreter.ts:88, reasoning.ts:115; groq.adapter.ts:104).
   Berarti Gemini bisa terpakai tiap turn hanya untuk ekstraksi order + output
   parse sering non-JSON → relayang via cleanJsonString/extractJsonFromText
   (order.service.ts:38-98) yang berbeda mekanisme v1/v2. → TASK terpisah.
3. **I8 accounting gap**: LLM ke-3 (`adapters.ai.generate` di extractAndSaveOrder)
   tidak increment `llmCallCount` (conversation.service.ts:402/616) dan tidak
   push ke `stagesReached` — cost/kuota tidak terukur. → TASK terpisah.
4. **`activeOrder`/`tryTotal` tidak diskriminatif** antara order `draft`
   (operasional, harga dari DB) vs `pending` (ekstraksi palsu, tidak ada harga):
   conversation.service.ts:829 (orderBy createdAt desc, notIn
   shipped/delivered/cancelled) dan fallback.service.ts:649-661 (lastOrder
   fallback) dapat memilih baris `pending` palsu sebagai order aktif. → TASK terpisah.
5. **Tidak ada test real** untuk `extractAndSaveOrder` — golden-dataset.test.ts:253
   mem-mock-nya ke no-op (komentar :15 "prevents real LLM in order extraction").
   Blind spot eksistensi. → TASK terpisah.

## UPDATE — TASK P4.1 CLOSED (hapus extractAndSaveOrder second-brain interpreter), 10 Agu 2026
Fix real (bukan audit saja). Menghapus seluruh jalur interpreter LLM ketiga
(Gemini, via `adapters.ai.generate`) yang menulis baris `orders` tanpa
`validateCartOpsAgainstDb`:

- `conversation.service.ts` — hapus call-site `void orderService.extractAndSaveOrder(...)`
  + komentar `// Non-blocking order extraction` di sekitarnya. (`orderService`
  import tetap dipakai `detectDoneOrdering`/`finalizeDraftOrder`.)
- `order.service.ts` — hapus: method `extractAndSaveOrder`, `attemptExtraction`,
  konstan `EXTRACTION_PROMPT`/`RETRY_PROMPT`, helper `extractJsonFromText`,
  `cleanJsonString`, `validateParsedOrder`, interface `ParsedOrder`.
  JANGAN disentuh: `createOrder`, `syncCartStateToDraftOrder`,
  `addConfirmedItemToOrder` (jalur v1/v2 yang benar).
- `golden-dataset.test.ts` — hapus no-op mock `OrderProto.extractAndSaveOrder`
  (setup lama :253, restore :271, `originalExtractOrder` :60, komentar :15).
  Mock `detectDoneOrdering` (yang masih dipakai) DIPERBOKAN.

Verification (acceptance P4.1):
- `tsc --noEmit` → 0 error. (`npx tsc` dari repo-root gagal karena typescript
  bukan dependency root; pakai binary lokal `apps/api/node_modules/.bin/tsc`.)
- `npm run build` → exit 0.
- `npm run test:chat` (full, 23 suites) → `2 failed, 21 passed, 23 total` /
  `1 failed, 246 passed, 247 total` = **BASELINE** (reasoning-v2 test +
  engine-config-v2 suite-init, pre-existing; lihat STATUS-V2.md:137-139 /
  RAILS.md:137-139). Bukan regresi. `golden-dataset.test.ts` tetap PASS
  setelah mock-nya dihapus.
- `pm2 restart api` → `online`, tidak crash-loop, `garuda-api-error.log` kosong
  pasca-restart.
- Proof DB (harness in-process `p4-verify.ts`: mock LLM, DB `garuda_dev`,
  **tidak** sentuh webhook WA real / customer riil): untuk pesan
  `"mau 3 ayam goreng"` (conv `conv-p4-verify`, store `store-p4-verify`,
  produk `ayam goreng` @12000):
  - BEFORE: 2 baris — 1 `draft` @ totalPrice 36000 (qty 3, price dari DB) +
    1 phantom `pending` @ totalPrice **null** (qty 1, price tidak ada).
  - AFTER: 1 baris — `{"orderStatus":"draft","totalPrice":36000,"items":[{"qty":3,"price":12000,"product":"ayam goreng",...}]}`,
    0 phantom `pending`. `orderService.extractAndSaveOrder exists: false`.
    Satu-satunya LLM call = interpreter v1 (Groq) → `cartOpsExecuted:1,
    llmCallCount:1`; `adapters.ai.generate` (Gemini) tidak pernah terpanggil.
  Query readback mentah: `SELECT orderStatus,totalPrice,items FROM "Order"
  WHERE "conversationId"='conv-p4-verify' ORDER BY "createdAt" ASC` → **1 row**
  `draft`@36000.

Catatan deviasi acceptance #6: tidak `curl` webhook WA langsung (bisa kirim pesan
ke customer/store riil lewat GOWA — ditolak karena grounds safety RAILS §3);
ganti dengan harness in-process yang sama pers invariant DB-nya, mock kedua LLM.

RILIEU / DITEMUKAN SAAT KERJA — penutupan TASK P4.1 atas entry audit §4
(laporan-taskP4-audit.md):
1. **I13 violation** (price null, items tak tervalidasi DB) di extractAndSaveOrder →
   **RESOLVED** (fungsi dihapus; tidak ada lagi kode interpreter yang menulis
   baris order tanpa harga DB).
2. **Provider/config drift** (Gemini vs Groq, tanpa jsonMode, temp/maxToken berbeda) →
   **RESOLVED** (fungsi dihapus).
3. **I8 accounting gap** (`llmCallCount`/`stagesReached` tidak increment untuk LLM
   ke-3) → **RESOLVED** (fungsi dihapus; cost/kuota lagi akurat).
5. **Tidak ada test real** untuk extractAndSaveOrder (hanya no-op mock) →
   **RESOLVED** (fungsi & mock-nya dihapus; golden tetap pass).
4. **`activeOrder`/`tryTotal` tidak diskriminatif** antara `draft` vs `pending` →
   **BELUM / TERBUKA** (masih relevan setelah penghapusan). `createOrder`
   (order.service.ts:393) masih menulis baris `orderStatus: 'pending'`, dan
   `activeOrder` (conversation.service.ts:829, orderBy createdAt desc,
   notIn shipped/delivered/cancelled) + `lastOrder`/`tryTotal` fallback
   (fallback.service.ts:649-661) tetap dapat memilih baris `pending` (bukan
   `draft`) sebagai order aktif. Perlu diskriminasi `draft` eksplisit di
   activeOrder/tryTotal agar tidak tertukar dengan baris `pending` sembarangan.
   → TASK terpisah (di luar scope penghapusan P4.1).

Catatan deviasi acceptance #4 (`git diff --stat`):
- SOURCE diff = tepat 3 file (`conversation.service.ts`, `order.service.ts`,
  `golden-dataset.test.ts`) — scope kode terpenuhi.
- `dist/` (8 file) REBUILD & DI-COMMIT: pm2 menjalankan `dist/index.js`
  (ecosystem.config.js:6) dan deploy produksi bergantukan `dist/` yang ter-commit
  tanpa build otomatis (RAILS §1.158). Membiarkan `dist` stale =
  `extractAndSaveOrder` tetap ter-compile → bug kembali setelah redeploy.
  Rebuild justru memperbaiki "dist/ tertinggal" (pola sama seperti pembersihan
  orphan dist di commit 5f502d1).
- `logs/*.log` tidak di-commit (RAILS §1.160, risiko data WA customer).
- `p4-verify.ts` (temp harness) dihapus sebelum commit.

## UPDATE 10/8 — P4 (REMOVE SECOND BRAIN) CLOSED
extractAndSaveOrder (interpreter LLM ketiga/Gemini, tanpa validasi DB)
dihapus total. DB proof: 2 baris (draft+phantom pending) -> 1 baris.
Commit 0db56bf. Test baseline tetap 2 failed/1 failed.
ANTRIAN BARU (bukan bug P4, ditemukan saat kerja): activeOrder/tryTotal
tidak diskriminasi draft vs pending order - createOrder masih bisa
hasilkan pending yang kepilih jadi order aktif. Perlu TASK terpisah
sebelum atau sejalan P5.

**UPDATE 11/8 — P4.2 CLOSED (diskriminasi draft vs pending)**
activeOrder (conversation.service.ts) dan tryTotal/lastOrder fallback
(fallback.service.ts) diubah: query `draft` eksklusif dulu, fallback ke
status non-terminal (pending+lsb) HANYA bila tidak ada draft sama sekali.
Plus perbaiki bug pre-existing `JSON.parse(lastOrder.items as string)`
di tryTotal — Prisma Json type kembalikan JS array, bukan string, jadi
parse selalu gagal → "keranjang kosong" selalu. Fix: handle
Array.isArray + typeof string.
Verifikasi: tsc 0 error, build sukses, test baseline 2 failed/1 failed
(golden pass), pm2 restart online. Manual test: 1 draft@36000 + 1
pending@24000 → "total belanja saya berapa" jawab Rp 36.000 (draft).
Commit terpisah.
NEXT: P5 - Response naturalness (composer-v2).

## UPDATE 10/8 — P4.2 CLOSED, P4 TOTAL SELESAI
activeOrder/tryTotal sekarang eksklusif pilih draft dulu. Bug sampingan
tryTotal JSON.parse ikut fix (dalam scope file yang sama). Commit 947fdaf.
Ditunda (owner): II-4 seed test, III-1/III-2 dist+logs hygiene.
NEXT: P5 - Response naturalness (composer-v2).

## UPDATE 10/8 — P5.1 (BUG OBJEKTIF REPLY) CLOSED
5 bug fix: subtotal/qty=0 konsisten, v2 truncate disamakan v1, silent-drop
di-log, qty<=0 display fix, reply spasi-doang di-trim. Commit 0e99fbd.
6 item GAYA nunggu keputusan owner (lihat RAILS §6).
NEXT: keputusan GAYA, lalu P6 (golden dataset architecture gate).
