# P7-DESIGN: Idempotency WA cart mutation via jalur locking yang SAMA (DESAIN, bukan implementasi)

> Tujuan: rancang skema `actionId` deterministik + reuse `claimAction`/`executeClaimedAction`
> (FOR UPDATE + SAVEPOINT) untuk WA cart mutation, tanpa ubah CartAuthority / interpreter /
> reasoning / action-registry (request Zod PWA). P7 = konvergensi di EXECUTOR.
> Baca: P7-AUDIT-FINDINGS.md (gap b), RAILS §1 (WA teks-forever, anti-broadcast),
> PROJECT-CONTRACT-STRUCTURED-ACTIONS.md §3 (Q1–Q5).

---

## 1. RE-BASELINE: lokasi PERSIS situs mutasi cart (POST-P9, commit `91e0768`)

| # | Situs (post-P9) | Engine | Baris | Bentuk saat ini | Perlu idempotency? |
|---|-----------------|--------|------|-----------------|--------------------|
| 1 | v1 LLM langsung (add/remove) | `v1` (default) | `conversation.service.ts:673` | `this.executeCartOps(valid, pipelineCtx, normalizedMsg)` | **YA** |
| 2 | v1 resolver EXECUTE (klarifikasi) | `v1` | `conversation.service.ts:511` | `this.executeCartOps(dbValid, {conversationId,storeId,customerId}, customerMessage)` (P9) | **YA** |
| 3 | v2 resolved EXECUTE | `v2` (canary) | `conversation.service.ts:236` | `this.executeCartOps(dbValid, {...}, customerMessage)` | **YA** (gap sama) |
| 4 | v2 plannedActs | `v2` | `conversation.service.ts:325` | `this.executeCartOps(ops, {...}, customerMessage)` | **YA** (gap sama) |
| 5 | v1 resolver ROLLBACK | `v1` | `conversation.service.ts:548` (+`:553` `restoreFromSnapshot`) | `executeCartOps([])` lalu `restoreFromSnapshot` (P9) | **TIDAK** — aman: pending di-clear duluan, retry "ga jadi" tak nemu pending → bukan ROLLBACK lagi |

Catatan re-baseline kritis:
- `conversation.service.ts` line number dari P7-AUDIT (`:661` dll) sudah bergeser setelah P9. Angka di atas diverifikasi ulang terhadap working tree `91e0768`.
- **`messageId` TIDAK sampai ke `processCustomerMessage`.** `webhooks.ts` → `messageProcessorService.processMessage({storeId, customerId, text, messageId})` → memanggil `conversationService.processCustomerMessage(storeId, customerId, conversationId, text)` **tanpa** `messageId`. Jadi untuk menghitung `actionId` deterministik berbasis `messageId`, `messageId` harus di-thread ke `processCustomerMessage` (lihat §5).

---

## 2. SKEMA `actionId` DETERMINISTIK UNTUK WA

WA tidak generate UUID client-side (beda dengan PWA yang kirim `actionId` di body `/action`).
`actionId` WA harus diturunkan di server dari identitas pesan yang STABIL saat redeliver.

**Rumus (final):**
```
actionId = `wa:${conversationId}:${messageId}`
idempotencyKey (di claimAction) = `${storeId}:${customerId}:${actionType}:${actionId}`
```
- `actionType` ∈ `{ADD_TO_CART, REMOVE_FROM_CART}` (map: CartOp.type 'add'→ADD_TO_CART, 'remove'→REMOVE_FROM_CART).
- Semua `cart_ops` dari SATU pesan dibatch ke SATU claim (satu `actionId`), agar replay = all-or-nothing.

**Sifat yang dipenuhi (sesuai brief):**
- ✅ Redeliver pesan SAMA (Fonnte/GOWA kirim ulang `messageId` sama) → `actionId` sama → `claimAction` → `already_applied` (status COMPLETED) → **tidak double-add**.
- ✅ Dua pesan BEDA yang kebetulan isi sama ("tambah ayam" diketik 2x customer) → `messageId` beda → `actionId` beda → 2x claim → **tetap nambah 2x** (bukan dianggap duplikat).
- ✅ Cross-instance: `ActionIdempotency` adalah row DB (bukan in-process) → FOR UPDATE berlaku di semua replika.

**CAVEAT (bukan blocker, catat sebagai residual risk):** kalau provider redeliver dengan `messageId` BEDA tapi isi sama, `actionId` ikut beda → tetap double-add. Penanganan murni provider/webhook-layer (stabilkan `messageId` di `webhooks.ts`/`messageProcessorService`, atau fallback content-hash berbatas-waktu). Brief P7 mengasumsikan "redeliver = messageId sama", jadi skema di atas menutup gap realistis. Tidak menambah content-window (akan melanggar "genuine duplicate tetap nambah 2x").

**Helper:** `computeWaActionId(conversationId, messageId): string` → `wa:${conversationId}:${messageId}` (letak: `conversation.service.ts`, private).

---

## 3. INTEGRASI KE `claimAction` / `executeClaimedAction` (FOR UPDATE SAMA)

`claimAction` (`:435`) dan `executeClaimedAction` (`:477`) saat ini `async function` **private** di `action-registry.ts`. Keduanya sudah implement FOR UPDATE (`SELECT ... FOR UPDATE` di `executeClaimedAction`) + re-check status + `SAVEPOINT` + `LEASE_FINAL_MS` (750ms) + `COMPLETED/FAILED` persist. **Jangan duplikasi logika ini.**

**Adapter tipis (REKOMENDASI):** tambah 1 fungsi `export` di `action-registry.ts`:
```
export async function executeIdempotentCartMutation(
  storeId, customerId, conversationId, actionType, actionId, ops: CartOp[]
): Promise<void> {
  const claim = await claimAction(storeId, customerId, actionType, actionId);
  if (!claim.claimed) {
    const ex = claim.existing;
    if (ex?.status === 'COMPLETED') return;            // already_applied
    if (ex?.status === 'FAILED') { log; return; }      // gagal → jangan ulang mutate
    if (ex?.status === 'CLAIMED' && new Date(ex.leaseUntil) > new Date()) return; // in-progress
  }
  await executeClaimedAction(storeId, customerId, conversationId, actionType, actionId,
    async (tx) => { await cartAuthority.executeOps(ops, storeId, customerId, conversationId, tx); });
}
```
- `executeMutation(tx)` meneruskan `tx` ke `cartAuthority.executeOps(..., tx)` → mutasi jalan DALAM transaksi yang sama dengan FOR UPDATE (atomic, serialisasi per actionId). `cartAuthority.executeOps` SUDAH menerima `tx?` opsional (`:505`) → reusable apa adanya.
- `ops` WA berbasis NAMA (tanpa `productId`) → lewat langsung ke `executeOps` (resolve-by-name), TIDAK sentuh request Zod PWA (`AddToCartRequestSchema` dll tetap hanya untuk PWA). Jadi WA dan PWA share FOR UPDATE + idempotency, tapi SKEMA VALIDASI tetap terpisah (sesuai audit P7 poin a: WA pakai `validateCartOpsAgainstDb`, bukan Zod).
- 4 situs mutasi (§1 #1–#4) ganti pemanggilan `this.executeCartOps(...)` → `await this.executeWaCartMutation(actionType, ops, ctx, messageId)`, di mana `executeWaCartMutation` (private di `conversation.service.ts`, ~15 baris) = hitung `actionId` lalu panggil `executeIdempotentCartMutation`.

**Alternatif (langsung reuse tanpa adapter):** export `claimAction`+`executeClaimedAction` dan panggil dari `conversation.service.ts`. Ditolak — mengekspos fungsi internal & mengulang logic status-check di banyak situs. Adapter tipis lebih bersih (1 tempat logic).

---

## 4. RACE: mutex in-process WA vs FOR UPDATE row lock

Keduanya BERBEDA tujuan → **DUA-DUANYA DIPERTAHANKAN (komplementer, bukan redundant):**

| Mekanisme | Cakupan | Menangani | Tidak menangani |
|-----------|---------|-----------|-----------------|
| Mutex in-process (`message-queue.service.ts:166` `acquireLock`, per-chat `Set`) | 1 instance | 2 `processMessage` chat sama berjalan concurrent (pipeline/LLM/ordering, coalescing) | cross-instance; **idempotency** (2 proses sequential pesan sama tetap dua kali mutate) |
| Redis dedup `messageId` 300s (`:184`) | multi-instance | redeliver `messageId` sama (sama instance maupun beda) | redeliver `messageId` beda |
| FOR UPDATE + `ActionIdempotency` (BARU) | multi-instance (DB) | idempotency mutasi + serialisasi + lease-recovery cross-instance | (butuh `actionId` stabil → lihat §2 caveat) |

Kesimpulan: mutex tetap untuk urutan/coalescing & hindari LLM ganda; FOR UPDATE menambah idempotency + atomicitas lintas-instance yang TIDAK bisa disediakan mutex. Tidak ada yang dihapus.

---

## 5. TITIK INTEGRASI PERSIS (file:line, post-rebase)

1. `webhooks.ts` — `messageId` sudah ada (gowa `:103`, fonnte `:262`); diteruskan ke `processMessage` (tidak berubah).
2. `message-processor.service.ts` (sekitar `:257` pemanggilan `processCustomerMessage`) — **tambah arg `messageId`** ke `conversationService.processCustomerMessage(storeId, customerId, conversationId, text, messageId)`.
3. `conversation.service.ts`:
   - signature `processCustomerMessage(storeId, customerId, conversationId, message, messageId)` — simpan `messageId` di `pipelineCtx` atau field lokal.
   - **baru** private `executeWaCartMutation(actionType, ops, ctx, messageId)` (~15 baris): `actionId = computeWaActionId(conversationId, messageId)` → `executeIdempotentCartMutation(...)`.
   - `:673` v1 LLM → ganti ke `executeWaCartMutation('ADD_TO_CART'|'REMOVE_FROM_CART', valid, ctx, messageId)`.
   - `:511` v1 resolver EXECUTE → `executeWaCartMutation('ADD_TO_CART', dbValid, ctx, messageId)`.
   - `:236`, `:325` v2 → `executeWaCartMutation(...)` (sama; v2 juga dapat idempotency).
   - `:548/:553` ROLLBACK → **tidak diubah** (sudah aman, clear-pending duluan).
4. `action-registry.ts` — **tambah** `export async function executeIdempotentCartMutation(...)` (~35–50 baris) yang memanggil `claimAction`+`executeClaimedAction` (private, reusable). Tidak ubah `claimAction`/`executeClaimedAction`/`executeAction`/request schema.

---

## 6. JAWABAN Q1–Q5 (PROJECT-CONTRACT-STRUCTURED-ACTIONS.md §3, final)

- **Q1 — Input classification:** Free-form human language (WA NL). BUKAN structured action. Kami REUSE mekanisme idempotency structured action (claim/FOR UPDATE), tapi TIDAK mengklasifikasikan WA sebagai structured action dan TIDAK mengubah interpreter/reasoning.
- **Q2 — Authority:** CartAuthority tetap pemilik otoritatif cart state/mutation (tidak berubah). `ActionIdempotency` hanya lapisan lock/bookkeeping, bukan authority.
- **Q3 — LLM necessity:** Mutasi cart TIDAK butuh LLM tambahan. Interpretasi sudah selesai di interpreter/reasoning; kita hanya tambah lock di executor. 0 LLM baru.
- **Q4 — Unnecessary LLM path:** N/A — tidak ada LLM baru. Boundary yang "dilewati" adalah: executor langsung panggil `claimAction`+`executeClaimedAction` (lock) sebelum `cartAuthority.executeOps`, bukan lewat `executeAction` PWA (yang punya Zod). Interpreter/reasoning tetap utuh (P7 = konvergen di executor).
- **Q5 — Regression boundary (WAJIB tidak berubah):**
  - CartAuthority internals (`executeOps`, `restoreFromSnapshot`) — tidak diubah.
  - Shape output interpreter/reasoning (`CartOp[]`) — tidak diubah.
  - Reply behavior / `renderCartSummary` / `getCartFromDb` — tidak diubah.
  - Redis dedup `messageId` + mutex in-process + coalescing — tetap ada (ditambah, bukan diganti).
  - `action-registry` request Zod (`AddToCartRequestSchema` dkk) + jalur PWA `/action` — tidak disentuh.
  - Branching engine v1/v2 — tidak diubah.
  - Perilaku untuk pesan BEDA = identik (tetap nambah). Hanya replay `messageId` SAMA yang jadi `already_applied` (tidak double-add) — ini perbaikan, bukan regresi.

---

## 7. ESTIMASI SCOPE DIFF (untuk keputusan implementasi nanti)

- `action-registry.ts`: +1 fungsi `executeIdempotentCartMutation` (~35–50 LOC). Tidak ubah fungsi existing.
- `conversation.service.ts`: +`executeWaCartMutation` (~15 LOC) + `computeWaActionId` (~3 LOC) + thread `messageId` (signature + 4 call-site swap, ~10 LOC) + `processCustomerMessage` param.
- `message-processor.service.ts`: +1 arg `messageId` ke `processCustomerMessage` (~1–2 LOC).
- `webhooks.ts`: tidak berubah (sudah kirim `messageId`).
- Tests: +1 file/section (retry `messageId` sama → 1 OrderItem; 2 `messageId` beda isi sama → 2 OrderItem).
- **TOTAL ~80–130 LOC di 4 file.** BUKAN rewrite Conversation Engine (sesuai RAILS §2.5). Murna penambahan tipis di titik konvergensi (executor) + 1 adapter di action-registry.

**Belum di-touch (di luar scope P7):** ROLLBACK idempotency (#5), content-window fallback untuk redeliver `messageId` beda (provider-layer), konvergensi validasi Zod WA↔PWA (audit poin a, task terpisah).

---

## 8. P7-DESIGN-GAPS — jawaban 3 gap (bukti file:line, READ-ONLY)

### Gap 1 — `actionType` value untuk WA (definisi eksplisit)

- Label PWA (semua `z.literal`, 1-op semantik) di `action-registry.ts`:
  `ADD_TO_CART` (:36), `REMOVE_FROM_CART` (:81), `UPDATE_CART_QUANTITY` (:120),
  `CANCEL_ORDER` (:167). Handler `executeMutation` satu operasi (lihat
  `handleAddToCart` ~:379 `type: 'ADD_TO_CART'`).
- WA satu pesan → `CartOp[]` multi-op (add+remove campuran) dibatch ke **SATU**
  claim (`actionId = wa:${conversationId}:${messageId}`, lihat §2). Maka WA
  **TIDAK** boleh reuse label PWA (bentrok semantik & mencampuradukkan key).

**DEFINISI FINAL (dipakai di kode nanti):**
```
// conversation.service.ts + action-registry.ts
export const WA_CART_MUTATION = 'WA_CART_MUTATION';
```
- `actionType` yang dikirim ke `claimAction(storeId, customerId, WA_CART_MUTATION, actionId)`
  SELALU `WA_CART_MUTATION` untuk seluruh `CartOp[]` dari satu pesan WA
  (baik ada add maupun remove di dalamnya).
- `idempotencyKey` jadi
  `${storeId}:${customerId}:WA_CART_MUTATION:wa:${conversationId}:${messageId}`
  — terpisah & tidak overlap dengan key PWA (`...:ADD_TO_CART:...`).
- Tidak ada mapping per-op ke `ADD_TO_CART`/`REMOVE_FROM_CART` untuk WA.
  Penentuan add vs remove tetap di dalam `ops` (`CartOp.type`), diproses oleh
  `cartAuthority.executeOps` seperti sekarang. Idempotency tingkat **PESAN**,
  bukan per-op.
- Bonus: redeliver pesan campuran add+remove → satu claim → replay aman
  (seluruh batch atomic), sejalan dengan pola `CANCEL_ORDER` (P6-2) yang sudah
  mem-batch REMOVE/UPDATE dalam satu claim.

### Gap 2 — kapan FOR UPDATE aktif vs Redis dedup 300s (skenario PERSIS)

- Redis dedup: `message-queue.service.ts:184` `isDuplicate` →
  `redisAdapter.setIfNotExists(key, '1', DEDUP_TTL_SECONDS)` (:192).
  Dipanggil di `message-processor.service.ts:110`; kalau duplicate →
  `return null` (:112) **SEBELUM** `processCustomerMessage` (:257). Jadi dedup
  menolak di pintu masuk, per `messageId`, TTL 300s.
- FOR UPDATE: `action-registry.ts:477` `executeClaimedAction` →
  `SELECT ... FOR UPDATE` (:486–493) pada baris `ActionIdempotency`, + re-check
  status (:598–622) + `LEASE_FINAL_MS = 750` (:22). Diambil via `claimAction`
  (:435) yang pakai key `storeId:customerId:actionType:actionId`.

**Skenario di mana duplicate LOLOS Redis dedup tapi BARU ketahan FOR UPDATE
(testable — ini yang harus disimulasikan, bukan sekadar re-test dedup):**
1. **TTL expired redeliver.** Pesan M (`messageId=X`) diproses t0; key
   `store:msg:X` expired di t0+300s. Fonnte/GOWA redeliver X di t>300s →
   `isDuplicate` (:184) → `setIfNotExists` buat key BARU → `wasSet=true` →
   `return !wasSet = false` (BUKAN duplicate) → lolos ke `processCustomerMessage`.
   Di executor, `claimAction(..., WA_CART_MUTATION, wa:conv:X)` → key sudah ada
   (COMPLETED dari proses pertama) → `executeClaimedAction` re-check status
   (:598) → `already_applied`, mutasi tidak dijalankan. **FOR UPDATE menangkap.**
2. **Redis fail-open / restart.** `isDuplicate` `catch` (:198) → `return false`
   (allow) bila Redis error/down → lolos. FOR UPDATE tetap menangkap karena key
   ada di DB (bukan Redis).
3. **Race cross-instance (Redis kehilang key).** Dua instance terima X bersamaan
   & Redis kehilang key (restart/ephemeral) → keduanya lanjut. `claimAction`
   pertama `INSERT` (CLAIMED); kedua temukan existing → `status === CLAIMED`
   + lease masih valid (:622) → return no-op. **FOR UPDATE serialisasi.**

- Catatan: skenario di mana FOR UPDATE JUGA miss = redeliver `messageId` BEDA
  (key beda) → sudah dicatat sebagai residual (§2 caveat), bukan scope test ini.
- **Test yang diminta:** simulasikan (1) dan (2) — set/matikan key Redis dedup
  (atau biarkan TTL lewat), lalu redeliver `messageId` SAMA, assert `OrderItem`
  tetap 1 (already_applied), bukan 2.

### Gap 3 — Rollback path (:548/:553) aman? Bukti trace (bukan asumsi)

Pertama kali confirmation ("ga jadi"/"iya") diproses:
- Resolver BAGIAN 2 ambil `pending` (:440 `getV1PendingClarification`),
  `if (pending)` (:447) true → ROLLBACK/EXECUTE → `clearPendingClarification(conversationId)` (:495)
  + `clearPreviousMutation` (:497) DIKERJAKAN **SEBELUM** reply. Pending jadi
  `null` di canonical `_compat` DAN `extractedEntities`.

Redeliver pesan confirmation YANG SAMA (pending sudah clear):
1. `:440` `getV1PendingClarification` → **null** (sudah di-clear :495, mirror ke canonical).
2. `:447` `if (pending)` → **FALSE** → SELURUH BAGIAN 2 (:447–623, incl.
   EXECUTE/ROLLBACK) **di-skip**.
3. Lanjut BAGIAN 1 normalizer (:625) → `normalize("iya")` → STAGE 3 tier
   (:648 `fallbackService.getResponse`) → "iya"/"ga jadi" tak cocok tier →
   `result` tetap null.
4. STAGE 4 LLM (:656 `!result` → `runOneCall` :661). runOneCall kirim "iya" ke LLM.
5. Mutasi HANYA bila `llmResult.cart_ops.length > 0` (:670) DAN
   `validateCartOpsAgainstDb` return `valid.length > 0` (:671–672).
   `validateCartOpsAgainstDb` (`interpreter.ts:161`) mewajibkan produk ADA di DB.
   - Jika isi confirmation murni ("iya"/"ga jadi", tak ada produk) → `valid` kosong
     → `:673 executeCartOps` TIDAK dipanggil (no-op).
   - Jika redelivered text kebetulan mengandung nama produk asli
     (mis. "iya tambah ayam 2 lagi deh") → `validateCartOpsAgainstDb` **LOLOS** dan
     **`:673 executeCartOps` AKAN terpanggil** — ini BUKAN no-op.
6. Clarification baru hanya kalau `llmResult.clarification` (:682) →
   `setPendingClarification` (re-ask, HARMLESS, bukan mutasi). Reply netral kalau
   `reply_draft` (:696).

**Kesimpulan:** redeliver confirmation TIDAK nyasar ke jalur mutasi LAIN yang
terpisah — dia jatuh ke situs **:673 (LLM langsung) yang SAMA** yang sudah
dibungkus wrapper P7 (Gap 1–2, `actionId = wa:${conversationId}:${messageId}`).
Jadi terlepas dari isi confirmation (produk ada atau tidak), redeliver dengan
`messageId` identik otomatis kena proteksi `already_applied` dari claim yang sama
→ **tidak dobel-mutasi**. Tidak butuh situs ke-5; aman karena fallback ke wrapper
P7 yang sudah ada, BUKAN karena (dan tidak mengandalkan) absennya produk.
Bukti tambahan: `messageId` redeliver identik → `actionId` identik →
`claimAction` temukan COMPLETED (lihat Gap 2) → `executeClaimedAction` re-check
(:598) → no-op.

**STATUS: AMAN — BUKAN gap.** Rollback path (:548/:553) tetap di luar scope
idempotency (desain awal §1 #5 benar). Tidak perlu masuk scope implementasi P7.
Catatan minor (bukan bug, opsional): redeliver confirmation memicu 1 LLM call
ekstra (biaya kecil); bisa dihindari dengan guard "affirmative/negation tanpa
pending → balas static" — di luar scope P7.
