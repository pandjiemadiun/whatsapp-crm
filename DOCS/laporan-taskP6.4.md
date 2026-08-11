# TASK P6.4 — Golden case untuk architecture gate (P3/P4/P5 coverage gap)

## Ringkasan

Menambah 3 golden case ke `apps/api/src/tests/golden-dataset.test.ts` —
masing-masing membuktikan satu architecture gate P3/P4/P5 yang **tidak
tercover** sebelumnya. Semua 3 case **PASS** (17/17 golden, 0 regression
pada test:chat). Scope HANYA file test — tidak ada perubahan source code.

**Status:** ✅ SELESAI — tsc 0 error, build 0 error, golden 17/17 pass,
test:chat baseline (2 failed/1 failed, 260 passed) **tidak berubah**.

---

## Verifikasi Akhir

| Sub-task | Case | Hasil | Commit |
|----------|------|-------|--------|
| P6.4a | Case P3: workspace_v2 persist antar-turn | ✅ GREEN | `dcf35c8` |
| P6.4b | Case P4: draft vs pending discrimination | ✅ GREEN | `d2e99ff` |
| P6.4c | Case P5: subtotal qty-filter + truncate | ✅ GREEN | `f9a8cdf` |

```
✅ npm run test:golden  → 17/17 pass, 0 fail   (14 → 17 naik)
✅ npm run test:chat    → 2 failed suites / 1 failed test / 260 passed  (baseline TIDAK berubah)
✅ npx tsc --noEmit     → exit 0, 0 error
✅ git diff --stat HEAD~3..HEAD → only golden-dataset.test.ts (+253 lines)
```

---

## Sub-task 1/3 — P6.4a: Golden case P3 (workspace_v2 persist)

**Commit:** `dcf35c8 test(P6.4a): golden case workspace_v2 persist antar-turn (P3 gate)`

### Desain test
- Aktifkan engine V2 via `setStoreEngine(STORE_ID, 'v2')` (Redis-based, helper
  `withEngineV2` yang otomatis reset ke 'v1' di finally).
- **Turn 1:** pesan "saya mau beli beras 1" → V2 interpreter path → `cannedV2`
  mock LLM response (act buy: beras qty=1) → `executeCartOps` → `saveWorkspace`
  → `updateWorkspaceV2` (conversation.service.ts:336-337).
- **Turn 2:** pesan "total berapa" → V2 fast path → `tryTotal` → baca
  `getCartFromDb` (confirmedItems persist turn 1).

### Bukti persist
**(a)** Direct DB check kolom `workspace_v2` ≠ null setelah turn 1.
Jika persist NO-OP (bug P3-audit §2), kolom akan null → test RED.

**(b)** Turn 2 "total berapa" berhasil menjawab **Rp 12.000** — ini hanya
mungkin bila cart (confirmedItems di `extractedEntities`) persisten dari
turn 1. Jika persist gagal → `tryTotal` balas "keranjang kosong" → RED.

### Temuan teknis — V2 path logging tidak capture ke `auditLogs`
- V2 path (`conversation.service.ts:214,282,364`) pakai logger format
  `'Engine v2 active'`, **bukan** `logPipelineAudit()` (format `'Pipeline audit'`).
- `auditLogs` di test file capture hanya `'Pipeline audit'` →
  `getAudit(auditLogs)` selalu return `{stagesReached:[]}` untuk V2.
- **Bukan bug** — ini by-design V2 canary. Di-test pakai `llmCallCount`
  counter + direct DB check sebagai ganti `audit.stagesReached`.

---

## Sub-task 2/3 — P6.4b: Golden case P4 (draft vs pending discrimination)

**Commit:** `d2e99ff test(P6.4b): golden case activeOrder draft vs pending (P4 gate)`

### Desain test
Reproduce manual test P4.2 (commit `947fdaf`) sebagai golden case permanen.

- Seed 2 row order ke 1 conversationId via `prisma.order.create`:
  - `ord-draft-p4`: status='draft', items=[beras qty:1 price:12000], total=12000
  - `ord-pending-p4`: status='pending', items=[beras qty:2 price:12000], total=24000
  (pending seed 10ms setelah draft agar `createdAt` lebih baru)
- Pesan "total berapa" → `tryTotal` fast path (0 LLM).
- **Assert:** reply match **12.000** (draft) dan **tidak** ada **24.000** (pending).

### Architecture gate value
Jika fix P4.2 (`activeOrder` prefer 'draft' dulu, `tryTotal` draft-first)
di-revert ke query lama `notIn: ['shipped','delivered','cancelled']` —
pending yang lebih baru (24.000) akan terpilih → **RED**. Case ini menjaga
fix P4.2 tetap berada.

---

## Sub-task 3/3 — P6.4c: Golden case P5 (reply composition invariants)

**Commit:** `f9a8cdf test(P6.4c): golden case reply composition subtotal+truncate (P5 gate)`

### Case (a) — Subtotal qty=0 tidak dihitung
- Seed order draft: items=[{beras, qty:1, price:12000}, {brambang, qty:0, price:8000}].
- "total berapa" → `tryTotal` → filter `qty > 0` → subtotal = **12.000**.
- **Assert:** "12.000" ada, "20.000" (12000+8000 tanpa filter) **tidak ada**.
- Memverifikasi P5.1 fix I-1a (`conversation.service.ts:254`,
  `fallback.service.ts:694`: `filter(qty > 0)`).

### Case (b) — reply_draft 3+ kal → truncate ≤ 2 kal
- Interpreter path (V1): canned `reply_draft` = 3 kalimat panjang.
- **Assert:** reply akhir ≤ 2 kalimat (`split(/(?<=[.!?])\s+/)` count).
- Memverifikasi P5.1 I-2 (`truncateTo2Sentences`, interpreter.ts:233,
  conversation.service.ts:350 safety-net).

### Case (c) — qty<=0 display "x1" (CATATAN: tidak bisa di-test di golden dataset)
- composer-v2.ts:79-81: `displayQty = op.qty > 0 ? op.qty : 1` (guard x1 bukan x0).
- **Tidak dapat di-test di golden dataset** karena:
  1. V2 engine flow (`executeCartOps` → `modifyCart` pada
     `extractedEntities.confirmedItems`, bukan `workspace_v2.draft_cart`).
  2. composer-v2.ts hanya display `draft_cart_ops` (bukan confirmedItems),
     dan V2 execute path tidak populate draft_cart_ops ke DB state yang
     terbaca oleh composer di golden dataset.
  3. Unit-level guard ini sudah tercover di `composer-v2.test.ts:P5.1 #4`.
- **Bukan bug** — ini keterbatasan integration test scope. Dicatat eksplisit
  agar tidak dipaksakan jadi test palsu yang selalu hijau.

---

## Constraint compliance
- ✅ Hanya `apps/api/src/tests/golden-dataset.test.ts` yang diubah (253 lines).
- ✅ Tidak ada perubahan pada file source (conversation.service.ts,
  fallback.service.ts, composer-v2.ts, dst).
- ✅ Mengikuti pola/style test case yang sudah ada: `BASE_PRODUCTS` (beras
  12000, woltel 10000, brambang 8000), `createConv`/`processMsg`/`withProduct`
  helpers, `prisma.conversation.delete().catch()` cleanup, `node:assert`.
- ✅ RAILS §1.9: commit terpisah per sub-task (3 commit).
- ✅ RAILS §5 definisi selesai: tsc + build + test:golden + test:chat + git clean.

## Catatan proses eksternal (bukan aktivitas P6.4)
Sekitar commit P6.2 (`6afd64a`), proses eksternal lain menghapus 22 file
lama (TASK-*.md, laporan-task*.md) dari working tree dan memindahkan ke
DOCS/. Working tree kini menandai file tersebut sebagai `D` (deleted).
Ini **bukan** aktivitas P6.4 — file laporan lama sudah ter-commit di git
history dan tetap ada di `DOCS/`. Perlu keputusan terpisah terhadap owner
apakah restore permanen, delete, atau hold di DOCS/.
