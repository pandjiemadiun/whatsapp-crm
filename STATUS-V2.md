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

