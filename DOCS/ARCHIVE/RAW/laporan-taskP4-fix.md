# Laporan Task P4 — FIX: Hapus `extractAndSaveOrder` (second-brain interpreter)

| Field | Value |
|---|---|
| Task | **P4.1** — Hapus `extractAndSaveOrder()` interpreter LLM ketiga |
| Tanggal selesai | 10 Agu 2026 16:43 UTC (commit `0db56bf`) |
| HEAD sebelum | `e1ee6c2` "docs: log P3 completion detail in RAILS.md §6 + STATUS-V2.md" |
| Commit | `0db56bf fix(P4): remove extractAndSaveOrder second-brain interpreter` |
| Scope | **Hapus saja** (bukan audit). 3 source file. Tidak disentuh: `createOrder`, `syncCartStateToDraftOrder`, `addConfirmedItemToOrder`. |
| Auditor / safety | Audit read-only P4.0 ada di `laporan-taskP4-audit.md` (terlampir/commit). |

---

## 1. Ringkasan eksekutif

`extractAndSaveOrder()` adalah **interpreter LLM ketiga** (Gemini, lewat
`adapters.ai.generate`) yang mem-parse **kembali** pesan customer ASAL-USAHA
(setelah v1/v2 sudah memprosesnya) dan menulis baris `orders` baru ke tabel yang
**sama** dipakai v1/v2 — **tanpa** `validateCartOpsAgainstDb`, **tanpa** harga
dari DB, dengan `orderStatus: 'pending'`.

Ini menghasilkkan **phantom order**:

- **I13 violation** — baris punya `totalPrice: null`, items
  `[{product, quantity}]` tidak divalidasi DB (kontras interpreter.ts:144 /
  conversation.service.ts:628 yang selalu pull price dari DB).
- **I8 accounting gap** — LLM ke-3 tidak increment `llmCallCount` / tidak masuk
  `stagesReached`, jadi cost & kuota tidak terukur.
- **Ghost activeOrder** — `activeOrder` (conversation.service.ts:829) dan
  `tryTotal`/`lastOrder`-fallback (fallback.service.ts:649-661) tidak
  membedakan `draft` (harga dari DB) vs `pending` (ekstraksi palsu, harga
  null) → bisa memilih baris `pending` palsu jadi order aktif di turn berikutnya
  (bukti: laporan §4 Skenario A).

Di path v2 (engine v2 / shadow), fungsi ini **sudah dead code** (bukti:
`adapters.ai.generate` tidak pernah terpanggil pada turn v2; hanya v1 yang
menginjaknya). Penghapusannya aman.

**Hasil:** phantom `pending` row hilang. Untuk pesan `"mau 3 ayam goreng"`,
DB readback **sebelum** 2 baris (1 `draft`@36000 + 1 phantom `pending`@null) →
**setelah** 1 baris (`draft`@36000, qty 3×12000 dari DB, **0 phantom**).

---

## 2. Scope perubahan

### 2.1 Dilakukan (3 source file)

#### 2.1.1 `apps/api/src/business/order.service.ts` — hapus 144 baris (:12–155)
Dihapus (konservasi `export class OrderService {` di :100 serta semua method
v1/v2 `createOrder`/`syncCartStateToDraftOrder`/`addConfirmedItemToOrder`):

| Region | Asli | Konten |
|---|---|---|
| interface | :12–16 | `ParsedOrder` (`intent`, `items`, `destination`) |
| konstan prompt | :18–30 | `EXTRACTION_PROMPT` (prompt Indonesia, minta JSON) |
| konstan prompt | :32–36 | `RETRY_PROMPT` |
| helper | :38–58 | `extractJsonFromText` (regex `/\{[\s\S]*\}/`) |
| helper | :60–66 | `cleanJsonString` (strip ```json / backtick) |
| helper | :68–73 | `validateParsedOrder` (type guard) |
| helper | :75–98 | `attemptExtraction` — panggil `adapters.ai.generate` (Gemini), temp 0.1, maxTokens 300, **tanpa jsonMode** |
| method | :101–155 | `extractAndSaveOrder(...)` — `void orderService.extractAndSaveOrder(...)` |

**Baris bersalah kunci (asli :128–139, di dalam method):**
```ts
// Only save to DB if intent is 'buy'
if (parsed.intent === 'buy') {
  const items = parsed.items || [];   // items = [{product, quantity}] — TANPA price
  await prisma.order.create({
    data: {
      storeId, conversationId, customerId,
      items: items as any,             // ← tidak divalidasi DB
      currency: 'IDR',
      orderStatus: 'pending',          // ← phantom, notIn shipped/delivered/cancelled
      shippingAddress: parsed.destination || null,
      notes: null,                     // ← totalPrice tidak di-set → schema.prisma:214 price null ✓
    },
  });
}
```
*`order.service.ts` setelah edit: impor :1–11 → `export class OrderService {` → Stage 4 draft-lifecycle (tak berubah).*

#### 2.1.2 `apps/api/src/business/conversation.service.ts` — hapus 3 baris (call-site)
Diff terhadap commit `e1ee6c2`:
```diff
@@ -765,9 +765,6 @@ export class ConversationService {
     await conversationContextService.appendMessage(conversationId, result.message);
     await conversationContextService.refreshSession(conversationId);

-    // Non-blocking order extraction — fire and forget, errors caught silently
-    void orderService.extractAndSaveOrder(conversationId, customerId, storeId, normalizedMsg).catch(() => {});
-
     // Done-ordering signal → finalize draft order to waiting_address
     if (orderService.detectDoneOrdering(normalizedMsg)) {
       await orderService.finalizeDraftOrder(conversationId);
```
(`orderService` impor **tetap** — dipakai `detectDoneOrdering`/`finalizeDraftOrder`.)

#### 2.1.3 `apps/api/src/tests/golden-dataset.test.ts` — hapus mock no-op (4 hunk)
Diff terhadap `e1ee6c2`:
```diff
@@ -12,7 +12,6 @@
  * Mocks:
  *   - groqAdapter.generate → canned JSON (I8: max 1 LLM per turn)
- *   - orderService.extractAndSaveOrder → no-op (prevents real LLM in order extraction)
  *   - orderService.detectDoneOrdering → false (prevents finalizeDraftOrder side-effects)
  *   - adapters.logger.info → captures 'Pipeline audit' entries
@@ -57,7 +56,6 @@
 const originalGenerate = groqAdapter.generate.bind(groqAdapter);
 const originalLoggerInfo = adapters.logger.info;
 const OrderProto = Object.getPrototypeOf(orderService);
-const originalExtractOrder = OrderProto.extractAndSaveOrder;
 const originalDetectDone = OrderProto.detectDoneOrdering;
@@ -248,9 +246,7 @@
   (groqAdapter as any).generate = mockGenerate;

-  // Mock orderService to prevent real LLM calls in extractAndSaveOrder
-  // and to prevent finalizeDraftOrder side-effects (detectDoneOrdering)
-  OrderProto.extractAndSaveOrder = async () => null;
+  // Mock orderService to prevent finalizeDraftOrder side-effects (detectDoneOrdering)
   OrderProto.detectDoneOrdering = () => false;
@@ -268,7 +264,6 @@
 after(async () => {
   (groqAdapter as any).generate = originalGenerate;
-  OrderProto.extractAndSaveOrder = originalExtractOrder;
   OrderProto.detectDoneOrdering = originalDetectDone;
   (adapters.logger as any).info = originalLoggerInfo;
```
Mock `detectDoneOrdering` **dipertahankan** (masih dipakai `finalizeDraftOrder`).

### 2.2 TIDAK disentuh (out-of-scope v1/v2)
- `createOrder` (order.service.ts:393) — masih menulis `orderStatus: 'pending'` (lihat §6 temuan #4).
- `syncCartStateToDraftOrder` — jalur `draft` yang benar, harga dari DB.
- `addConfirmedItemToOrder` — jalur v1/v2.

---

## 3. Verification — acceptance checklist

| # | Acceptance (task) | Cmd | Hasil | Catatan |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit -p apps/api` → 0 error | `./node_modules/.bin/tsc --noEmit` | **EXIT 0, tidak ada error** | `npx tsc` dari repo-root gagal (typescript bukan dependency root); pakai binary lokal `apps/api`. |
| 2 | `npm run build` → sukses | `npm run build` (`tsc` emit) | **BUILD_EXIT=0** | Membangun `dist/` (lihat §5). |
| 3 | `test:chat` baseline tak naik (2f/1f) | `npm run test:chat` (full, 23 suites) | **`2 failed, 21 passed, 23 total` / `1 failed, 246 passed, 247 total`** = BASELINE | 2 suite gagal = pre-existing `reasoning-v2` (1 test) + `engine-config-v2` (suite init `redisAdapter` ReferenceError, container.ts:38). `golden-dataset` (termasuk dalam 21 pass) **tetap pass** setelah mock-nya dihapus. Bukan regresi. |
| 4 | `git diff --stat` → 3 file sumber | `git diff --stat -- src/` | **exactly** `conversation.service.ts`, `order.service.ts`, `golden-dataset.test.ts` | `dist/` juga berubah (lihat §5 deviasi — di-commit karena prod deploy dari dist). |
| 5 | `pm2 restart api` → online, no crash-loop | `pm2 restart api` → `pm2 list` | `[api](0) ✓`, `online`, pid 235472, 0% cpu, `garuda-api-error.log` kosong; online 5m+ pasca-restart | |
| 6 | DB readback "mau 3 ayam goreng" → 1 baris | harness in-process `p4-verify.ts` | **SEEDED, 1 `draft`@36000, 0 `pending` phantom** | Lihat §4. |

> **Catatan tooling (RAILS §1.58):** acceptance #1 `npx tsc --noEmit -p apps/api`
> tidak berhasil di env ini karena `typescript` bukan dependency root (hanya di
> `apps/api/node_modules`); pakai ekuivalen lokal yang sama fungsinya.

---

## 4. Acceptance #6 — proof DB mentah (BEFORE → AFTER)

**Metode (customer-safe):** harness in-process `apps/api/p4-verify.ts` — memanggil
`conversationService.processCustomerMessage` langsung, **bukan** curl webhook WA
live. Mock kedua LLM (`groqAdapter.generate` = `cannedInterpreter` qty 3;
`adapters.ai.generate` = `cannedExtract` qty 1 — yang sekarang tidak pernah
terpanggil). DB `garuda_dev` (localhost), store `store-p4-verify`, conv
`conv-p4-verify`, produk `ayam goreng` @12000. **Tidak ada customer/riil WA yang
terdampak.**

### Query readback
```sql
SELECT "orderStatus", "totalPrice", "items", "shippingAddress"
FROM   "Order"
WHERE  "conversationId" = 'conv-p4-verify'
ORDER BY "createdAt" ASC;
```

### BEFORE — 2 baris (relevan dari sesi audit P4.0)
Row 1 — `draft` (v1 runOneCall, benar):
```json
{"orderStatus":"draft","totalPrice":36000,"items":[{"qty":3,"price":12000,"product":"ayam goreng","confirmedAt":"2026-08-10T16:16:36.447Z","mentionedAt":"2026-08-10T16:16:36.447Z"}]}
```
Row 2 — `pending` **phantom** (dari `extractAndSaveOrder`, harga null, qty 1):
```json
{"orderStatus":"pending","totalPrice":null,"items":[{"product":"ayam goreng","quantity":1}]}
```
Log penanda asal phantom:
```
16:16:36.477  info  Extracting order from message
16:16:36.481  info  Order saved from extracted intent items:1
```
Marker runtime: `orderService.extractAndSaveOrder exists: true`.

### AFTER — 1 baris (ini task, 16:35:15 UTC)
```
===== [AFTER processCustomerMessage] count=1 =====
{"orderStatus":"draft","totalPrice":36000,"items":[{"qty":3,"price":12000,"product":"ayam goreng","confirmedAt":"2026-08-10T16:35:15.262Z","mentionedAt":"2026-08-10T16:35:15.262Z"}],"shippingAddress":null}

--- ASSERTIONS ---
total order rows: 1
draft rows (v1 runOneCall): 1
phantom pending rows (extractAndSaveOrder): 0
```
Metadata turn:
```json
{"source":"interpreter","intent":"buy","stagesReached":["normalizer","tier3","llm"],"llmCallCount":1,"finalIntent":"buy","cartOpsExecuted":1}
```

**Delta:** 2 baris → **1 baris**. `totalPrice 36000` = 3 × `12000` (price dari DB, bukan dari LLM). `orderStatus: 'pending'` hilang. Gemini `adapters.ai.generate` tidak pernah terpanggil (satu-satunya LLM call = v1 interpreter Groq).

### Bukti simbol memang hilang
```
src/business/order.service.ts          : grep -c extractAndSaveOrder = 0
apps/api/dist/business/order.service.js: grep -c extractAndSaveOrder = 0   (artifact yang dijalankan pm2)
```
(`typeof orderService.extractAndSaveOrder === 'function'` → `false`; method
hilang dari prototype, sehingga p4-verify.ts:103 mencetak
`orderService.extractAndSaveOrder exists: false`.)

---

## 5. Deviasi dari acceptance literal (dan alasannya)

### 5.1 `git diff --stat` meliputi `dist/` (11 file)
Acceptance #4 berbunyi *"cuma conversation.service.ts, order.service.ts,
golden-dataset.test.ts"*. **Source-level diff memang tepat 3 file** ✓
(`git diff --stat -- src/`). Namun `npm run build` (acceptance #2) meregenerasi
`dist/`, dan `dist/` **ter-commit + dipakai langsung oleh runtime produksi**:

- `ecosystem.config.js:6` → `script: 'dist/index.js'` (pm2 "api").
- RAILS §1.158: *"deploy produksi bergantung pada dist/ yang ter-commit tanpa
  proses build otomatis."*

Maknanya: **jika `dist/` tidak di-commit (atau dikembalikan ke HEAD), produksi akan
tetap menjalankan `dist/business/order.service.js` yang masih berisi
`extractAndSaveOrder`** → bug **kembali** setelah `pm2 reload`/redeploy. Commit
`5f502d1` sebelumnya pun membersihkan dist-file *orphan* yang sama persis
alasan ini. Oleh karena itu `dist/` direbuild & **di-commit** bersama source;
ini memperbaiki (bukan mengekalkan) "dist/ tertinggal" (RAILS §1.158).

`logs/*.log` **tidak di-commit** (RAILS §1.160: risiko data WA/nomor customer
terlibat). `p4-verify.ts` (temp harness) **dihapus** sebelum commit.

### 5.2 Acceptance #6 tidak memakai `curl` webhook WA langsung
Ditolak karena **safety** (RAILS §3): `curl` ke GOWA gateway bisa mengirim
balasan ke customer/store riil. Diganti harness in-process yang **sama invariant
DB-nya** (processCustomerMessage langsung, mock LLM, dev DB). Invariant yang
diturunkan — "HANYA SATU baris order per conversationId" — terbukti sama.

---

## 6. Temuan luar-scope (dari audit §4 laporan-taskP4-audit.md) — status

Diperbarui di `STATUS-V2.md` (entry "DITEMU SAAT KERJA — TASK P4.0" → ditandai
penyelesaian P4.1).

| # | Temuan | Status setelah P4.1 |
|---|---|---|
| 1 | **I13 violation** — `orders` dibuat `extractAndSaveOrder` tanpa `unitPrice`/`totalPrice`, items tidak divalidasi DB (`price:null` di schema.prisma:214) | ✅ **RESOLVED** (fungsi dihapus; tak ada lagi kode interpreter yang menulis baris order tanpa harga DB) |
| 2 | **Provider/config drift** — Gemini (`adapters.ai.generate`, temp 0.1, maxTokens 300, **tanpa jsonMode**) vs Groq v1/v2 (temp 0.2, 250, jsonMode) | ✅ **RESOLVED** (fungsi dihapus) |
| 3 | **I8 accounting gap** — LLM ke-3 tidak increment `llmCallCount`/`stagesReached` | ✅ **RESOLVED** (fungsi dihapus; cost/kuota lagi akurat) |
| 4 | **`activeOrder`/`tryTotal` tidak diskriminatif** `draft` vs `pending` (conversation.service.ts:829; fallback.service.ts:649-661) | ⏳ **TERBUKA** — masih relevan. `createOrder` (:393) masih menulis baris `orderStatus: 'pending'`; `activeOrder` (orderBy createdAt desc, notIn shipped/delivered/cancelled) + `tryTotal`/`lastOrder`-fallback tetap dapat memilih baris `pending` (bukan `draft`) jadi order aktif. Perlu diskriminasi `draft` eksplisit di `activeOrder`/`tryTotal`. → TASK terpisah, di luar scope penghapusan P4.1. |
| 5 | **Tidak ada test real** untuk `extractAndSaveOrder` (hanya no-op mock di golden-dataset.test.ts:253) | ✅ **RESOLVED** (fungsi + mock dihapus; `golden-dataset` tetap pass) |

---

## 7. Commit

```
0db56bf fix(P4): remove extractAndSaveOrder second-brain interpreter   (HEAD)
e1ee6c2 docs: log P3 completion detail in RAILS.md §6 + STATUS-V2.md
```
Isi commit (16 file): `STATUS-V2.md`, 3 source file, 11 file `dist/` yang
direbuild, `+` `laporan-taskP4-audit.md` (audit read-only P4.0). `logs/*.log`
dan `p4-verify.ts` sengaja **tidak** masuk commit.

### Ringkasan angka
- Source diff: **3 file**, −153 line (−3 / −144 / −7±).
- Test: **baseline tidak berubah** (2 failed suites / 1 failed test; golden pass).
- DB proof: **2 baris → 1 baris**; phantom `pending`@null **hilang**; `totalPrice`
  draft = `36000` (3×12000 dari DB), tidak pernah ada nilai harga dari LLM.

P4 selesai: **audit (read-only) + 1 fix (penghapusan)** dalam satu commit, tidak
perlu dipecah lebih jauh (scope memang sempit — cumuan hapus).
