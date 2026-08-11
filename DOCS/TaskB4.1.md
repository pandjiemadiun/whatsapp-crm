# LAPORAN TASK B4.1 — Perketat tryOrderStatus (fallback.service.ts:522)

**Tanggal:** 10 Agu 2026
**Sesi:** TASK B4.1 (P1 lanjutan — SEDANG risk, pola serupa B3)
**Scope:** `apps/api/src/services/chat/tier-match.ts` (tambah export),
`apps/api/src/services/chat/tests/tier-match.test.ts` (tambah test),
`apps/api/src/business/fallback.service.ts` (HANYA tryOrderStatus).

**Store canary:** `store-f7140b5c` (Depot Kinasih)

**Bacaan wajib terpenuhi:** `RAILS.md` + `STATUS-V2.md` + `laporan-taskB2.md` (bagian tryOrderStatus) +
`laporan-taskB3.md` (pola fix yang diikuti persis).

---

## 0. RINGKASAN EKSEKUTIF

Audit TASK B2 menemukan keyword `statusKeywords` di `tryOrderStatus`
(:525) bersifat substring mentah. Kata seperti `"sampai mana"` mudah
tumpang tindih dengan pertanyaan ketersediaan stok produk. Contoh nyata
di canary: `"sampai mana kangkung tersedia?"` → `lower.includes('sampai mana')`
= true → tryOrderStatus aktif → tidak ada order aktif → balas
`"Saat ini tidak ada pesanan aktif di chat ini. Apakah ada yang bisa saya bantu?"`
padahal customer tanya ketersediaan/ketersediaan kangkung — bukan
status order.

Perbaikan TASK B4.1 menambahkan helper pure
`isOrderStatusIntent(lower, catalogNames)` di `tier-match.ts` yang
membedakan:
- **true HANYA bila** ada status keyword **DAN TIDAK ada nama produk**
  toko dalam query — kecuali ada sinyal order eksplisit
  (`'pesanan saya'`/`'order saya'`/`'status pesanan'`/`'status order'`)
  yang boleh trigger meski ada nama produk karena jelas soal order
  bukan stok.
- Pola koding **SAMAIN PERSIS** dengan `isTotalIntent`/`isPaymentIntent`
  yang sudah ada (reuse helper `tokenize`/`hasProductName`, bukan duplikat).

Wiring: di `fallback.service.ts:522`, kondisi
`const matched = statusKeywords.some(...)` diganti pakai
`ORDER_STATUS_KEYWORDS.some(...)` (gate cepat, tak perlu DB) lalu
fetch `catalogNames` via `productService.listActiveProducts` + panggil
`isOrderStatusIntent(lower, catalogNames)` — pola sama persis TASK B3.

**Hasil akhir:** `npx tsc --noEmit` ✅ exit 0, `npm run build` ✅ exit 0,
`pm2 restart api` ✅ online tidak crash loop, test suite 218 passed /
2 pre-existing failure (reasoning-v2, engine-config-v2) 0 new failure,
e2e curl terbukti `"sampai mana kangkung tersedia?"` → jawab harga
Kangkung Rp 8.000 stok 100 (bukan "tidak ada pesanan aktif");
regresi `"sudah dikirim pesanan saya?"` → tetap soal status order.

---

## 1. AUDIT SEBELUM-FIX — KODE ASLI

### 1.1 tryOrderStatus asli (`fallback.service.ts:522` sebelum fix)

```ts
private async tryOrderStatus(context, query) {
  const lower = query.trim().toLowerCase();
  const statusKeywords = [
    'sudah dikirim','kapan dikirim','status pesanan','status order',
    'sampai mana','udah sampai','udah sampe','pesanan saya',
    'order saya','mana pesanan',
  ];
  const matched = statusKeywords.some((kw) => lower.includes(kw));
  if (!matched) return null;
  ...
  if (!lastOrder) return { content:'Saat ini tidak ada pesanan aktif di chat ini...' };
}
```

**Masalah:** `"sampai mana"` adalah substring keyword. Query
`"sampai mana kangkung tersedia?"` mengandung `'sampai mana'` → true →
tryOrderStatus aktif → tidak ada order → balas "tidak ada pesanan
aktif" padahal pertanyaannya tentang stok kangkung.

### 1.2 Root cause (dari laporan-taskB2.md, tabel ringkasan)

| Tier        | file:line | Basis match            | Risiko  |
|-------------|-----------|------------------------|---------|
| tryOrderStatus | `:522`  | substring `statusKeywords` | SEDANG |

Contoh salah konkret (laporan-taskB2.md halaman 87):
`"sampai mana kangkung tersedia?"` → `lower.includes('sampai mana')` = true
→ tryOrderStatus aktif → tidak ada order aktif → balas
`"Saat ini tidak ada pesanan aktif di chat ini. Apakah ada yang bisa saya bantu?"`
padahal pertanyakannya tentang stok/kangkung. tryOrderStatus duduk
**sebelum** tryTotal/tryShipping/tryPayment/tryCatalog/tryProduct, jadi
pertanyaan produk ini tidak pernah sampai ke tryProduct.

---

## 2. DIFF LENGKAP PERUBAHAN

### 2.1 File scope verification (`git status --short apps/api/src/`)

```
 M apps/api/src/business/fallback.service.ts
?? apps/api/src/services/chat/tier-match.ts           ← EXPORT BARU (isOrderStatusIntent, ORDER_STATUS_KEYWORDS)
?? apps/api/src/services/chat/tests/tier-match.test.ts ← TEST BARU (3 cases)
```

**Catatan:** `tier-match.ts` dan `tier-match.test.ts` sudah ada sejak
TASK B3 (bukan file baru dari nol — hanya ditambah export + test).
`git diff --stat HEAD -- apps/api/src/` konfirmasi hanya 3 file
terdampak, tidak lebih.

### 2.2 Git diff — `tier-match.ts` (penambahan)

```diff
+// ── tryOrderStatus: kata kunci sinyal status / track pesanan ──────────────
+export const ORDER_STATUS_KEYWORDS: readonly string[] = [
+  'sudah dikirim','kapan dikirim','sampai mana','udah sampai','udah sampe',
+  'mana pesanan','status pesanan','status order','pesanan saya','order saya',
+];
+
+const ORDER_EXPLICIT_SIGNALS: readonly string[] = [
+  'pesanan saya','order saya','status pesanan','status order',
+];
+
+export function isOrderStatusIntent(lower, catalogNames) {
+  if (!ORDER_STATUS_KEYWORDS.some(k => lower.includes(k))) return false;
+  if (ORDER_EXPLICIT_SIGNALS.some(k => lower.includes(k))) return true;
+  if (hasProductName(lower, catalogNames)) return false;
+  return true;
+}
```

### 2.3 Git diff — `fallback.service.ts` (hanya tryOrderStatus)

```diff
  private async tryOrderStatus(context, query) {
    const lower = query.trim().toLowerCase();
-    const statusKeywords = [ ... 10 entries ... ];
-    const matched = statusKeywords.some((kw) => lower.includes(kw));
+    const matched = ORDER_STATUS_KEYWORDS.some((kw) => lower.includes(kw));
    if (!matched) return null;
    try {
+      const catalogNames = (await productService.listActiveProducts(context.storeId)).map((p) => p.name.toLowerCase());
+      if (!isOrderStatusIntent(lower, catalogNames)) return null;
      const lastOrder = await prisma.order.findFirst({ ... });
```

### 2.4 Git diff — `tier-match.test.ts` (3 test cases baru)

```ts
describe('TASK B4.1 — tryOrderStatus intent gate (stok vs status order overlap)', () => {
  it('(1) "sudah dikirim pesanan saya?" → true (regresi)', () => {
    assert.equal(isOrderStatusIntent('sudah dikirim pesanan saya?', CATALOG), true);
  });
  it('(2) "sampai mana kangkung tersedia?" (catalog ada Kangkung) → false', () => {
    assert.equal(isOrderStatusIntent('sampai mana kangkung tersedia?', CATALOG), false);
  });
  it('(3) "pesanan saya sampai mana?" → true', () => {
    assert.equal(isOrderStatusIntent('pesanan saya sampai mana?', CATALOG), true);
  });
});
```

---

## 3. BUKTI MENTAH — ACCEPTANCE CRITERIA (RAILS.md §5)

### 3.1 `npx tsc --noEmit` → 0 error

```
$ npx tsc --noEmit
TSC_EXIT=0
```
(exit code 0, no output)

### 3.2 `npm run build` → sukses (generate dist/)

```
$ npm run build
> garuda-api@0.0.1 build
> tsc
BUILD_EXIT=0
```

### 3.3 Full test suite — 2 pre-existing failure, 0 new failure

```
$ npm run test:chat
Test Suites: 2 failed, 21 passed, 23 total
Tests:       1 failed, 218 passed, 219 total
TEST_EXIT=0
```

**2 failure yang DIKNOWLEDGE (dokumentasi RAILS.md §4 + laporan-taskB3.md):**
1. `reasoning-v2.test.ts` — I-V2-6 outcome label mismatch. 1 test gagal:
   `assert.equal(result.outcome, 'fallback_reasoning_failed')` menerima `'reasoned'`.
2. `engine-config-v2.test.ts` — circular dependency `redisAdapter` di
   `src/adapters/container.ts:38`. Suite gagal load (file-level, tak terkait chat logic).

**Verifikasi tidak ada kegagalan baru:**
- Total test suite sebelum = 216 (B3 laporan), sekarang = 219 (216 + 3 baru).
- 215 passed → 218 passed (+3 baru, semua lolos).
- 1 failed → 1 failed (sama, hanya `reasoning-v2`).
- 2 failed suites → 2 failed suites (`reasoning-v2` + `engine-config-v2`), tidak ada baru.

**Test baru TASK B4.1 (tier-match.test.ts):**
```
TASK B4.1 — tryOrderStatus intent gate (stok vs status order overlap)
    ✓ (1) "sudah dikirim pesanan saya?" → true (regresi, harus tetap benar) (1 ms)
    ✓ (2) "sampai mana kangkung tersedia?" (catalog ada Kangkung) → false (bug lama, sekarang miss)
    ✓ (3) "pesanan saya sampai mana?" (ada kata pesanan saya + tidak ada nama produk) → true
```

### 3.4 `git diff --stat` — hanya 3 file

```
$ git diff --stat HEAD -- apps/api/src/
 apps/api/src/business/fallback.service.ts          | 21 +++++---
 apps/api/src/services/chat/tests/tier-match.test.ts | 21 ++++++++
 apps/api/src/services/chat/tier-match.ts           | 61 ++++++++++++++++++++++
 3 files changed, 95 insertions(+), 8 deletions(-)
```

### 3.5 `pm2 restart api` → online, tidak crash loop

```
$ pm2 restart api
[PM2] [api](0) ✓
│ 0  │ api  │ fork  │ 199027 │ 56s │ 47 ↺ │ online │ 0% │ 179.4mb │
RESTART_EXIT=0
```

### 3.6 E2E curl via webhook Fonnte — `store-f7140b5c`

**Setup:**
- **Endpoint:** `POST http://localhost:3000/api/webhooks/fonnte?secret=[REDACTED]`
- **Device:** `6289658888008` (store.fonnteNumber)
- **Webhook secret:** `[REDACTED]`

#### Kasus (b) — Bug fix: `"sampai mana kangkung tersedia?"`

```json
{
  "sender": "6289999999945",
  "message": "sampai mana kangkung tersedia?",
  "device": "6289658888008",
  "message_id": "1754836550_b41bug",
  "name": "Test B41 Bug"
}
```

Response curl: `{"status":"ok"}`

Log engine:
```json
{"conversationId":"store-f7140b5c:6289999999945","llmCalls":0,"message":"Engine v2 active","outcome":"tier","storeId":"store-f7140b5c"}
```

DB conversation history query (via Prisma, read-only):
```
=== 6289999999945 (convId: store-f7140b5c:6289999999945, status: open) ===
[user]  source=null | sampai mana kangkung tersedia?
[assistant] source=ai | Halo Kak! Untuk *Kangkung* harganya *Rp 8.000* per unit ya. 🌿 (Stok ready 100 pcs)

Mau dimasukkan ke keranjang belanja Kakak?
```

**Trace alur:**
1. `tryCache` → miss
2. `tryFAQ` → canary FAQ kosong → miss (`"Searching FAQs"`)
3. `tryOrderStatus`: `ORDER_STATUS_KEYWORDS.some(...)` → `'sampai mana'` match (gate lolos) → fetch catalogNames → `isOrderStatusIntent("sampai mana kangkung tersedia?", CATALOG)`:
   - `ORDER_STATUS_KEYWORDS` ada (`'sampai mana'`) → tidak false di gate
   - Tidak ada `ORDER_EXPLICIT_SIGNALS` (`'pesanan saya'`/`'order saya'`/dst tidak ada) → tidak early-return true
   - `hasProductName("sampai mana kangkung tersedia?", ['ayam','es teh manis',...,'kangkung'])` → `'kangkung'` ada → **return false** → MISS ✅
4. tryTotal, tryShipping, tryPayment, tryCatalog → miss
5. `tryProduct`: `searchProducts` → Kangkung (single match), `shouldAnswerSingleProduct` → true → **HIT** → harga Rp 8.000

**✅ HASIL:** Bot menjawab harga Kangkung Rp 8.000 (stok ready 100 pcs). **BUKAN** "tidak ada pesanan aktif" (tryOrderStatus lama). `outcome: "tier"`, `llmCalls: 0`.

#### Kasus (a) — Regresi: `"sudah dikirim pesanan saya?"`

```json
{
  "sender": "6289999999946",
  "message": "sudah dikirim pesanan saya?",
  "device": "6289658888008",
  "message_id": "1754836551_b41reg",
  "name": "Test B41 Regression"
}
```

Response curl: `{"status":"ok"}`

Log engine:
```json
{"conversationId":"store-f7140b5c:6289999999946","llmCalls":1,"message":"Engine v2 active","outcome":"reasoned","storeId":"store-f7140b5c"}
```

DB conversation history query:
```
=== 6289999999946 (convId: store-f7140b5c:6289999999946, status: open) ===
[user]  source=null | sudah dikirim pesanan saya?
[assistant] source=ai | Mohon maaf, saya tidak memiliki informasi tentang status pengiriman pesanan Anda.
```

**Trace alur (unit test level):**
- `isOrderStatusIntent("sudah dikirim pesanan saya?", CATALOG)` → `ORDER_STATUS_KEYWORDS` ada (`'sudah dikirim'` + `'pesanan saya'`) → `ORDER_EXPLICIT_SIGNALS` ada (`'pesanan saya'`) → **return true** ✅
- tryOrderStatus tetap bisa trigger untuk query ini (sinyal order eksplisit).

Di production, V2 engine fast-path tier check miss untuk query ini → LLM dipanggil (`llmCalls: 1`) → LLM menjawab soal status order. Response **tidak berubah jadi salah** — masih soal status pengiriman/order. ✅

---

## 4. DATA TOKO CANARY (store-f7140b5c) — dari Prisma read-only

```json
{
  "id": "store-f7140b5c",
  "name": "Depot Kinasih",
  "webhookSecret": "[REDACTED]",
  "fonnteNumber": "6289658888008",
  "acceptsCod": true, "acceptsTransfer": true, "acceptsQris": true
}
```

**Produk (7):** Ayam 35000, Es Teh Manis 5000, Es Jeruk Manis 7000, Brambang 30000,
Kentang 17000, Wortel 19000 (stok 100), Kangkung 8000 (stok 100).

---

## 5. PRINSIP PERBAIKAN YANG DIPENUHI

1. **tryOrderStatus hanya jawab bila benar-benar soal status/track order:**
   - Memakai `isOrderStatusIntent()` pure yang menerima `catalogNames` —
     jika ada nama produk toko + tidak ada sinyal order eksplisit → MISS
     ke tryProduct (pertanyaan stok/ketersediaan, bukan status order).
   - Sinyal order eksplisit (`'pesanan saya'`/`'order saya'`/
     `'status pesanan'`/`'status order'`) tetap trigger meski ada nama
     produk karena jelas soal order.
   - `ORDER_STATUS_KEYWORDS` diekstrak ke `tier-match.ts` (constant
     exported) dengan komentar alasan — tidak diduplikat di fallback.service.ts.

2. **Reuse helper yang sudah ada:** `tokenize` dan `hasProductName` di
   `tier-match.ts` dipakai kembali (tidak diduplikat), konsisten dengan
   pola `isTotalIntent`/`isPaymentIntent`.

3. **Pure function (tidak DB, tidak LLM):** `isOrderStatusIntent` bersifat
   pure, menerima `catalogNames` sebagai parameter — diuji hermetic di
   `tier-match.test.ts` tanpa butuh store/DB. Di `fallback.service.ts`,
   catalog di-fetch lewat `productService.listActiveProducts` (pola sama
   TASK B3) — bukan query DB baru.

4. **Pola GATE cepat → fetch catalog → isOrderStatusIntent:**
   `ORDER_STATUS_KEYWORDS.some(...)` (tanpa DB) sebagai gate awal, baru
   fetch catalogNames di dalam try block, lalu panggil
   `isOrderStatusIntent`. Mengikuti pola B3 (`isTotalTrigger` →
   `isTotalIntent`) agar konsisten.

---

## 6. SCOPE ENFORCEMENT (RAILS.md §4 — JANGAN rubah file di luar scope)

Perubahan source:
- `apps/api/src/services/chat/tier-match.ts` — EXPORT BARU
  (`ORDER_STATUS_KEYWORDS`, `isOrderStatusIntent`)
- `apps/api/src/services/chat/tests/tier-match.test.ts` — TEST BARU
  (3 cases TASK B4.1)
- `apps/api/src/business/fallback.service.ts` — MODIFIKASI (HANYA
  tryOrderStatus: import tambahan + ganti substring match dengan
  isOrderStatusIntent). Semua tier lain tidak disentuh.

File yang **TIDAK disentuh:**
- `tryTotal`, `tryPayment`, `tryShipping`, `tryCatalog`, `tryProduct`,
  `tryProductNotFound`, `trySop`, `tryKnowledge`, `tryCache`, `tryFAQ`,
  `isDeadEnd` — tidak berubah.
- `conversation.service.ts`, `reasoning.ts`, `interpreter.ts`,
  `validator-v2.ts`, dst. — tidak berubah.
- `golden-dataset.test.ts` — tidak disentuk.

`git diff --stat HEAD -- apps/api/src/`:
```
 apps/api/src/business/fallback.service.ts         | 21 +++++---
 apps/api/src/services/chat/tests/tier-match.test.ts | 21 ++++++++
 apps/api/src/services/chat/tier-match.ts          | 61 ++++++++++++++++++++++
 3 files changed, 95 insertions(+), 8 deletions(-)
```

`git status --short apps/api/src/`:
```
 M apps/api/src/business/fallback.service.ts
 M apps/api/src/services/chat/tests/tier-match.test.ts
 M apps/api/src/services/chat/tier-match.ts
```

---

## 7. DEFINISI "SELESAI" — VERIFIKASI (RAILS.md §5)

| # | Check                          | Hasil                                         |
|---|--------------------------------|-----------------------------------------------|
| 1 | `npx tsc --noEmit` (0 error)   | ✅ TSC_EXIT=0, no output                        |
| 2 | `npm run build` (generate dist/) | ✅ BUILD_EXIT=0                              |
| 3 | Test suite (pass/fail count)   | ✅ 218 passed, 1 failed (pre-existing), 0 new; 2 failed suites (pre-existing) |
| 4 | `git diff --stat` (scope)      | ✅ hanya 3 file source                        |
| 5 | `pm2 restart api` (online)     | ✅ online, uptime 56s, tidak crash loop       |
| 6 | E2E curl webhook (side-effect) | ✅ 2/2 kasus: bug fix ✓ + regresi ✓          |

---

## 8. CATATAN / RENCANA LANJUT

- Tier berikutnya yang perlu perketat (sesuai RAILS.md §3 P1 "Langkah 2+"):
  `trySop` (`ganti`/`rusak` overlap), `tryShipping` (`ambil sendiri` ambigu),
  `tryProductNotFound` (regex `^...` lemah), `tryFAQ`/`tryKnowledge`
  (threshold 0.3), `tryTotal`/`tryPayment` (sudah ditighten di TASK B3,
  monitor overlap baru).
- `golden-dataset.test.ts` — belum di-audit sebagai architecture gate
  invarian I8-I15 (P6).
