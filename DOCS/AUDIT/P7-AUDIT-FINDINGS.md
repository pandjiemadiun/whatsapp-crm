# P7-AUDIT — GAP WA PATH vs STRUCTURED ACTION PATH (READ-ONLY)

> Tujuan: petakan PERSIS di lapisan mana gap antara jalur WhatsApp (WA) dan jalur
> structured action ada, berbasis fakta `file:line`. Tidak ada implementasi.
> Working tree `c6be2d8` (origin/main). Baca: RAILS.md §2.3 (CartAuthority = single
> source of truth), §2.5 (jangan rewrite Conversation Engine), PROJECT-STATE-REPORT §6.9/§8.1.

---

## 1. ALOUR WA (NATURAL LANGUAGE) — shape data per transisi

| # | Titik | File:line | Shape data yang lewat |
|---|-------|-----------|----------------------|
| 1 | Webhook masuk | `routes/webhooks.ts:103` (gowa) / `:262` (fonnte) | `processMessage({storeId, customerId(=phone), text, messageId, gateway, channel:'whatsapp', token?})`. `messageId` dari Fonnte=`body.message_id`, GOWA=`payload.id` (fallback `${convId}:${Date.now()}`). |
| 2 | Pipeline message-processor | `services/message-processor.service.ts:96` `processMessage` | Dedup = `messageQueueService.isDuplicate` (`message-queue.service.ts:184`, Redis `SET key '1' EX 300 NX`, key=`${storeId}:msg:${messageId}`). Lalu dead-end (:118), coalescing 5–15s (:154), **mutex in-process** `acquireLock` (`message-queue.service.ts:166`, `Set`-based, bukan shared). |
| 3 | Conversation engine dispatch | `business/conversation.service.ts:62` `processCustomerMessage` | `engine = getStoreEngine(storeId)` (`services/chat/engine-config.ts:22` → default **'v1'**). |
| 4a | v2 LLM intent | `conversation.service.ts:185` `understand()` → `services/chat/reasoning.ts:225` | `ReasoningOutcome` = `{outcome:'reasoned', result: InterpreterResultV2, plannedActs: ActV2[]}`. v2 `plannedActs` di-flatten + di-build jadi `CartOp` **manual** di `conversation.service.ts:318-323`: `{type: isRemove?'remove':'add', product: e.value /*NAMA*/, qty, price}`. **Tidak ada `productId`, tidak ada `actionId`.** |
| 4b | v1 LLM intent | `interpreter.ts:46` `runOneCall` | `InterpreterResult` = `{intent, cart_ops:[{type:'add|remove', product /*NAMA*/, qty, price}], confidence, ...}`. Validasi hanya `!parsed.intent || typeof parsed.confidence !== 'number'` (`interpreter.ts:99`). **`cart_ops` TIDAK di-Zod-validate.** |
| 5 | Validasi harga/eksistensi | `interpreter.ts:161` `validateCartOpsAgainstDb(ops, storeId)` | Manual: cek nama produk ada di DB + `qty` number≥1. Harga di-`override` dari DB. Return `{valid, invalid, missing}`. **Ini SATU-SATUNYA validasi struktural WA.** |
| 6 | Eksekusi mutasi (3-4 situs) | `conversation.service.ts:236,325` (v2) / `:661` (v1 LLM) via `executeCartOps` (:916) | `executeCartOps` → `cartAuthority.executeOps(ops, storeId, customerId, conversationId)` **TANPA `tx`** → buka `$transaction` sendiri (`cart-authority.ts:770` `prisma.$transaction(runOps)`). |
| 6' | Eksekusi mutasi resolver v1 (DAERAH ABU-ABU) | `conversation.service.ts:509` | `conversationContextService.modifyCart(conversationId,'add',{addedProduct, qty, price})` → **TIDAK** lewat `executeCartOps`/`CartAuthority`. Tulis ke `extractedEntities.confirmedItems` (legacy JSON), `conversation-context.service.ts:314-379` via `atomicCas`. |
| 7 | Resolusi produk di CartAuthority | `cart-authority.ts:505` `executeOps` | WA op **tanpa `productId`** → `resolveProductByName` (`cart-authority.ts:534`, **fuzzy**; `ProductAmbiguousError` → skip seluruh op). |

**Konvergensi WA ke CartAuthority = PARSIAL.** Jalur v1-LLM, v2-resolved, v2-plannedActs → `executeOps` ✓. Tapi jalur **v1-resolver (EXECUTE) → `modifyCart` legacy** ✗ (lihat §3.c-2).

---

## 2. ALOUR STRUCTURED ACTION (PWA /action) — shape data per transisi

| # | Titik | File:line | Shape data |
|---|-------|-----------|-----------|
| 1 | Gateway | `routes/actions.ts:23` POST `/:storeSlug/action` | `{uid, action}` → `getOrCreateWebSession` (server-resolve identity, **tidak percaya client**). |
| 2 | Dispatch + **Zod validate** | `action-registry.ts:1387` `executeAction` | `definition.requestSchema.safeParse(request)` (Zod per-action). Contoh `AddToCartRequestSchema` (`action-registry.ts:34`): **`actionId: uuid()`, `type:'ADD_TO_CART'`, `payload:{productId: uuid(), quantity: int().positive()}`**. Gagal → `ApiError ERR_VALIDATION`. Lalu `authorize()`. |
| 3 | CLAIM (idempotency) | `action-registry.ts:435` `claimAction` | `INSERT ActionIdempotency(status=CLAIMED)` key=`${storeId}:${customerId}:${actionType}:${actionId}`. **P2002 unique** (`action-registry.ts:441,461`) → kalau ada, baca existing (COMPLETED→`already_applied`, FAILED→error, CLAIMED+lease valid→409). |
| 4 | EXECUTE (FOR UPDATE) | `action-registry.ts:477` `executeClaimedAction` | `SELECT ... FOR UPDATE` baris idempotency (:487), **re-check status** (:504), `SAVEPOINT cart_action` (:520), `executeMutation(tx)`, sukses→`COMPLETED`, bisnis-error→`ROLLBACK TO SAVEPOINT`+`FAILED` (:552). Lease `LEASE_FINAL_MS=750` (:22) untuk recovery CLAIMED. |
| 5 | Mutasi via CartAuthority (tx dipakai) | `action-registry.ts:637` `executeMutation` → `handleAddToCart` | Build `CartOp {type:'add', productId, product, qty}` → `cartAuthority.executeOps(ops, ..., tx)` **DENGAN `tx`** (bagian dari tx FOR UPDATE, `cart-authority.ts:742-770`). |

**Structured path selalu:** Zod (actionId UUID + productId UUID + qty) → P2002 claim → FOR UPDATE + status re-check → SAVEPOINT → `executeOps` dalam tx yang sama.

---

## 3. GAP KONKRET (bukti `file:line`)

### (a) Validasi intent LLM — Zod SAMA/setara? **TIDAK.**
- Zod schema (`AddToCartRequestSchema` dkk, `action-registry.ts:34-336`) **hanya dikonsumsi** oleh `executeAction` → `definition.requestSchema.safeParse` (`action-registry.ts:1398`). WA **tidak pernah** memanggil `executeAction`.
- WA v1: validasi ad-hoc — cek `intent`+`confidence` (`interpreter.ts:99`) lalu `validateCartOpsAgainstDb` (eksistensi nama + qty, `interpreter.ts:161`). `cart_ops` tidak di-Zod-parse.
- WA v2: `validate()` (`validator-v2.ts`, dipanggil `reasoning.ts:294`) + build op manual (`conversation.service.ts:318`) + `validateCartOpsAgainstDb`.
- **Selain itu**, Zod structured mewajibkan `actionId` & `productId` **UUID** + `quantity int().positive()`. WA ops **sama sekali tidak punya `productId`/`actionId`** — cuma nama produk + qty number mentah. Jadi validasi WA **bukan setara**: lebih lemah (no UUID format, no positive-int guarantee handled by schema) DAN kurang presisi (nama vs UUID → lihat §3.c-3).

### (b) Idempotency — setara `actionId`+FOR UPDATE? **TIDAK. Mekanisme berbeda.**
- WA mengandalkan **3 lapis transport-level**, bukan logical idempotency:
  1. Dedup `messageId` Redis NX 300s (`message-queue.service.ts:184`) — key per **messageId**.
  2. Mutex per-chat **in-process** `Set` (`message-queue.service.ts:166`) — **tidak shared antar instance**.
  3. Coalescing 5–15s (`message-processor.service.ts:154`).
- WA **TIDAK PUNYA**: `actionId`, record `ActionIdempotency`, constraint P2002 unik, status `CLAIMED/COMPLETED/FAILED`, `FOR UPDATE`, lease (`action-registry.ts:22,441,477,487`).
- **Apakah cukup?** Cukup untuk redelivery **dengan messageId SAMA** (ditangkap dedup). TAPI ada celah nyata:
  - Fonnte/GOWA kerap redeliver dengan **messageId BEDA** (retry setelah partial failure) → dedup **miss**.
  - Multi-instance: mutex in-process → 2 replika bisa proses concurrent bila messageId beda.
  - Mutasi `executeOps` **tidak punya idempotency logis**: replay intent NL yang sama → **re-add (qty++)**. Structured: replay actionId sama → `already_applied` (tidak double). Ini beda mendasar.
  - Tidak ada `COMPLETED/FAILED` persist → bila gagal transient, WA drop/fallback; structured return status deterministik + bisa di-retry aman.

### (c) Risiko konkret vs teoretis

**KONKRET (reachable, bukan opini):**
1. **Double-mutation pada redelivery messageId beda.** User: "tambah ayam goreng" → Fonnte retry dgn id baru → 2× `processMessage` → 2× `executeOps(add)` → qty cart dobel. Coalescing cuma bantu kalau dalam window 5–15s & instance sama. Structured: 2 request walau beda, actionId sama → 2nd `already_applied`. Bukti: `message-queue.service.ts:184` (dedup per messageId), `cart-authority.ts:550-608` (add selalu increment/increase qty).
2. **Resolver v1 EXECUTE tidak lewat CartAuthority.** `conversation.service.ts:509` → `modifyCart` → `extractedEntities.confirmedItems` (`conversation-context.service.ts:314`). Engine default = **v1** (`engine-config.ts:22`), jadi ini jalur mutasi AKTIF default untuk mayoritas toko. Ini **membantah klaim §2.3 "CartAuthority single source of truth untuk keduanya"** — ada cabang WA yang tulis ke legacy JSON, bukan `OrderItem`. Read-nya pun beda: `getCartFromDb` baca `extractedEntities` (`conversation.service.ts:944`), bukan `OrderItem`. Divergensi nyata WA↔structured + WA-v1-resolver↔WA-v1-LLM.
3. **Ambiguitas nama produk.** WA op tanpa `productId` → `resolveProductByName` fuzzy (`cart-authority.ts:534`); `ProductAmbiguousError` → **skip seluruh op silently** (`cart-authority.ts:536-544`). Structured pakai `resolveProductById` via UUID (exact, `cart-authority.ts:531`) → tidak pernah skip gara-gara ambiguitas nama.

**TEORETIS / STRUKTURAL (gap nyata, dampak observed belum terdokumentasi):**
4. **Tidak ada FAILED-state persist untuk WA** → tidak ada kontrak error/retry deterministik yang setara PWA; semantik error WA vs PWA beda untuk skenario sama.
5. **Tidak ada FOR UPDATE / lease recovery.** Bila proses crash mid-`executeOps`, tidak ada recovery record (structured punya CLAIMED+lease).
6. **Race over-stock pada concurrent add.** `executeOps` cek stok `existingQty + qty < stock` (`cart-authority.ts:568`) **best-effort**, bukan terkunci terhadap add concurrent dari 2 `processMessage` (masing-masing buka `$transaction` sendiri, `cart-authority.ts:770`). Structured: mutasi jalan dalam tx yang juga pegang `FOR UPDATE` pada baris idempotency → serialisasi per action.

### (d) Besar-kecil perubahan kalau WA DIPAKSA lewat `executeAction()`/registry

- **Conversation Engine (interpreter.ts / reasoning.ts / types) TIDAK di-rewrite** — dilarang §2.5. Titik konvergensi ada di **executor boundary**: `executeCartOps` (`conversation.service.ts:916`) + cabang resolver v1 (`:509`).
- **Opsi "thin convergence di executor" (sesuai §8.1-a: WA tetap NL, hasil interpreter diarahkan ke action contract sama):** di `executeCartOps`, ganti pemanggilan langsung `cartAuthority.executeOps` menjadi: mint `actionId` **deterministik** (hash `conversationId+intent+product+qty`) lalu panggil `executeAction('ADD_TO_CART'|'REMOVE_FROM_CART', request, ctx)`. Registry handler (`handleAddToCart` dkk, `action-registry.ts:583`) **sudah ada & reuse** — mereka sendiri sudah panggil `executeOps` dalam tx FOR UPDATE/idempotency. Jadi registry dipakai apa adanya, hanya situs panggil WA yang berubah.
- Plus perbaiki cabang resolver v1 (`:509`) supaya juga lewat `executeCartOps` (konvergensi ke CartAuthority) — ~10 baris.
- **Estimasi:** ~150–250 LOC tersentuh, TERBATAS pada `conversation.service.ts` (3–4 situs + signature `executeCartOps` opsional) + 1 helper `actionId` deterministik. **TIDAK** sentuh `interpreter.ts`/`reasoning.ts`/`action-registry.ts` core. => Ini **"penambahan tipis di titik konvergensi"**, BUKAN "rewrite Conversation Engine". Konsisten dengan larangan §2.5.

---

## 4. RINGKASAN GAP PER LAPISAN

| Lapisan | WA saat ini | Structured | Status gap |
|---------|-------------|------------|-----------|
| Validasi intent | Manual (`interpreter.ts:99`) + `validateCartOpsAgainstDb`; **tanpa Zod, tanpa UUID, tanpa productId** | Zod per-action (`action-registry.ts:34-336,1398`) wajib `actionId`+`productId` UUID + qty | 🔴 Tidak setara |
| Resolusi produk | Nama → `resolveProductByName` fuzzy (skip kalau ambigu) | UUID → `resolveProductById` exact | 🔴 Kurang presisi |
| Idempotency | Dedup messageId Redis + mutex in-process + coalescing; **tanpa actionId/FOR UPDATE/P2002/lease** | `claimAction` P2002 + `FOR UPDATE` + status re-check + lease 750ms | 🔴 Berbeda mekanisme, ada celah |
| Error handling | Drop/fallback, no persisted FAILED, no safe retry contract | `COMPLETED/FAILED` persist + 409 in-progress + SAVEPOINT rollback | 🟡 Berbeda semantik |
| Konvergensi CartAuthority | v1-LLM/v2 ✓ ; **v1-resolver ✗ (modifyCart legacy)** | Selalu via `executeOps` | 🔴 Cabang WA menyimpang |

---

## 5. KESIMPULAN FAKTA (tanpa usulan desain)
- Gap ada di **4 lapisan konkret**: validasi (Zod/UUID), resolusi produk (nama vs id), idempotency (transport vs logical), error-handling (drop vs persist).
- Risiko **konkret terbukti reachable**: (1) double-add pada redelivery messageId beda, (2) cabang v1-resolver menulis legacy `confirmedItems` bukan `OrderItem` (membantah §2.3), (3) skip silent pada nama produk ambigu. Risiko (4)(5)(6) struktural/teoretis tanpa observasi documented.
- Kalau diputuskan converge penuh, perubahan **kecil–sedang & terlokalisasi di executor** (`conversation.service.ts` + 1 helper), **bukan rewrite engine** → aman terhadap §2.5.
