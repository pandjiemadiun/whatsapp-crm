# CONSOLIDATED HISTORY — Arsip Laporan Forensik QloBot

> **Tujuan:** Histori tetap bisa ditelusuri tanpa membuka puluhan file terpisah.
> File asli TIDAK dihapus — semuanya ada verbatim di `DOCS/ARCHIVE/RAW/`
> (dan `RAW/PHASE-REPORTS/`, `RAW/AUDIT/`, `RAW/PROJECT/` untuk sub-kategori).
>
> **Catatan duplikasi:** Banyak file `DOCS/laporan-*.md` (root) adalah salinan
> byte-identik dari `DOCS/PHASE-REPORTS/laporan-*.md` — keduanya diarsipkan ke RAW.
>
> **Rentang waktu:** ~9 Agu – 17 Agu 2026 (era stabilisasi engine v2 + Gen 2 / G2).
> Status teknis terkini yang berlaku ada di `PROJECT-STATE-REPORT.md` (root repo).

## A. Stabilisasi Engine v2 (RAILS P0–P6) — forensik per-TASK

- **taskB2** (~9 Agu): Audit read-only 11 tier `fallback.service.ts`. Risiko TINGGI di
  tryTotal/tryPayment (tumpang tindih kata "bayar"), SEDANG di tryOrderStatus/trySop/
  tryShipping/tryFAQ. Fix: TASK B3+B4.
- **taskB3** (~9 Agu): Tutup overlap "bayar" via helper `tier-match.ts`
  (isTotalIntent/isPaymentIntent). Bukti e2e "berapa bayar kangkung" -> harga DB.
  Commit 4bd4414 + f314326.
- **taskB4.1–B4.5 / TaskB4.1** (~10 Agu): 5 tier SEDANG-risk fallback tertutup.
  Insiden crash robot -> full git reset --hard + git clean -fd (RAILS §1.8).
  Commit fca533f..ffd00df. P1 RESMI SELESAI.
- **taskP2** (10 Agu): Truth boundary — validateCartOpsAgainstDb di semua titik
  eksekusi cart ops; harga SELALU dari DB (I13).
- **taskP3.1–P3.4** (10 Agu): Context boundary — workspace_v2 kolom baru, shape
  extractedEntities OBJECT, migrasi legacy->v2, optimistic lock RMW.
  Commit c164729..fd08ba3.
- **taskP4 / taskP4-fix** (10 Agu): Remove second brain — extractAndSaveOrder
  (interpreter LLM ke-3 Gemini, tanpa validasi DB) DIHAPUS TOTAL. Commit 0db56bf.
  Plus P4.2 diskriminasi draft vs pending. P4 RESMI SELESAI.
- **taskP5-audit / taskP6-audit** (10–11 Agu): P5 reply composition (5 bug + 3 gaya).
  P6 = golden dataset sebagai architecture gate.
- **taskP6.1 / P6.2 / P6.3 / P6.4 / P6-BUKTI-MENTAH** (11 Agu): P6 forensik. Temuan
  kritis: golden-dataset.test.ts TIDAK tercakup test:chat, TIDAK ada CI. P6.1 seed
  woltel/brambang + assert.deepEqual. P6.3 buat .github/workflows/test.yml (gate
  test:chat + test:golden). P6.4 coverage P3/P4/P5 BELUM dikerjakan penuh.

## B. PWA Web Chatbox — fase 0–20

- **taskPWA0-audit .. taskPWA20** (9–19 Agu): Seri implementasi chatbox PWA apps/pwa
  (Vite+React+Tailwind v4). FASE 1 web realtime (Socket.IO), FASE 2 structured message,
  FASE 3 dashboard human messaging, FASE 4 web push (VAPID), deploy qlobot.web.id
  (PWA.19), slug management (PWA.16), 23 fix tsc (PWA.17), 5 bug chat UI (PWA.20).
  SELESAI deploy production.
- **fase1..fase5-*.md** (era Gen 2 fase 1–5): inspeksi & forensic web realtime,
  structured payload, dashboard human handoff, web push, UI/UX implementation.

## C. G2 Generation 2.0 — arsitektur & audit

- **G2-A-baseline-report.md** (14 Agu): Baseline & safety freeze Gen 2 (aktif, tetap
  di luar ARCHIVE sebagai referensi).
- **G2-B-core-hardening + AUDIT/G2-B-*** (14 Agu): webhook security (HMAC), AI provider
  boundary, retry/circuit, dead code cleanup.
- **G2-C-cartauthority + AUDIT/G2-C-*** (14 Agu): CartAuthority jadi single cart
  authority (Order/OrderItem sebagai cart draft).
- **G2-D1..D7 + AUDIT/G2-D-*** (14–15 Agu): conversation state refactor — v1/v2 cutover,
  compatibility reader, v1/v2 write/read migration, legacy cleanup.
- **G2-E0..E3 + G2-F1** (14–17 Agu): storefront UI/UX (design system, first impression,
  order-state checkout, legacy cart-order convergence) + end-to-end commerce audit.
- **AUDIT/G2-LOGIC-CLEANUP-LEDGER.md** (15 Agu, 141KB): Ledger besar cleanup logika G2.

## D. Audit comparison & project context

- **AUDIT/chatbox-qlabot / backend-improvement-qlobot-vs-openship / G2-C / G2-B-***
  (14 Agu): Perbandingan QloBot vs OpenShip (reference, bukan dependency) + review
  arsitektur cart authority & core hardening.
- **AUDIT/review-fonnte-api / fonnte-master-pool-review** (14 Agu): Review Fonnte API.
- **PROJECT/Project Context + ARCHIVE/Roadmap besar chat / ARCHIVE/*blueprint* /
  ARCHIVE/updated-implementation-plan** (era awal): konteks & blueprint chatbox awal
  (superseded oleh G2 roadmap/blueprint di MASTER/).

## E. Catatan penutup

Semua file di atas diarsipkan ke DOCS/ARCHIVE/RAW/ pada 18 Agu 2026. Isinya terangkum
tinggi di PROJECT-STATE-REPORT.md. Bila butuh bukti verbatim, buka file asli di RAW/.
Jangan percaya ringkasan ini sebagai pengganti bukti mentah.

## F. Era 19 Agu 2026 — cluster verification, hygiene hook & CI gate lengkap

- **Cluster structured actions (P0-P5 foundation + P6-1/P6-2/P6-3 + P4-2/P4-3) ter-commit
  & ter-push** — `25d0f43` (foundation: schema.prisma + migrasi ActionIdempotency +
  action-registry + routes/actions + kontrak), `4224331` (P6-1: ADD_TO_CART productId
  envelope, skip name round-trip), `8dc22a3` (P6-2: REMOVE_FROM_CART + UPDATE_CART_QUANTITY),
  `2c604cc` (P6-3: CANCEL_ORDER + fix actionsRouter mount gap sejak foundation),
  `b610e69` (P4-2: CONTACT_ADMIN), `73f607b` (P4-3: wire 5 PWA quick actions ke /action).
- **Golden coverage P3/P4/P5 (P6.4/P6.5)** — `e2d391e` (tambah case), `55c66c5` +
  `58d6de0` (mark §6.4 RESOLVED + mutation-test proof), test:golden naik 18/18 → 23/23.
- **P8-1/P8-2 regression gate** — `d114526` (log gate hijau) + `dd7e7f2` (fix test-isolation
  CANCEL_ORDER, scope assertion ke storeId sendiri); structured-actions 38/38.
- **III-2-A/B history purge** — `bcddfcd`: `logs/*.log` di-exclude + di-purge dari git
  history (backup bundle `garuda-backup-20260819.bundle`); **III-1-B post-merge auto-build
  hook terpasang** (mitigasi stale dist di produksi).
- **INSIDEN doc-edit hilang** — `git reset --hard 73f607b` buang edit doc uncommitted
  (pelajaran: commit doc secepat source, jangan ditahan).
- **P8-CI-FIX** — `c6be2d8`: `test:structured` (glob `src/tests/structured-actions*.test.ts`,
  115 test) masuk `.github/workflows/test.yml` → CI gate lengkap: test:chat + test:golden
  + test:structured.
- **🔴 TEMUAN proses (POST-HOC):** seluruh cluster di atas di-kerjakan & di-push di sesi
  sebelumnya TANPA dilaporkan real-time dengan bukti RAILS §1.2 (mirip insiden P6 lama).
  Ditutup via TASK VERIFY-CLUSTER + DOCS-SYNC 19 Agu 2026 (lihat `RAILS.md` §6 entri
  RETROAKTIF + `PROJECT-STATE-REPORT.md` §10).

