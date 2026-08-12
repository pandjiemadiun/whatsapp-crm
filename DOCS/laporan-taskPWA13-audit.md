# Laporan Task P-PWA.13 — AUDIT READ-ONLY: Intercept pre-engine + 2 kelas link + slug management

**Task ini AMAN/AUDIT SAHAJA** (RAILS §1.4, §1.10): **tidak ada file source yang
diubah**. Satu-satunya file yang disentuh = laporan ini
(`DOCS/laporan-taskPWA13-audit.md`, **overwrite** draft katalog yang sudah ada).
Dibaca terlebih dahulu: `RAILS.md`, `STATUS-V2.md` (root),
`DOCS/05_PWA_IDENTITY_BLUEPRINT.md` (§1-§6).

Pre-read sudah dilengkapi sebelumnya: `RAILS.md` (§1 aturan / §2 verdict / §3
roadmap / §5 definisi selesai / §6 log keputusan) + `STATUS-V2.md` (state teknis) +
`05_PWA_IDENTITY_BLUEPRINT.md` (§1-§6).

> **Gate (`git status`):** *tracked source bersih.* Dirt yang ada hanya kategori
> RAILS §6: `apps/api/dist/**` (termasuk `apps/api/dist/routes/pwa.*`),
> `apps/api/logs/{combined,error}.log`, `.env` (test var non-secret), + DOCS
> pre-existing (`05_PWA_IDENTITY_BLUEPRINT.md`, `laporan-taskPWA3.md`,
> `laporan-taskPWA4.md`). **Tidak ada `M` pada `apps/api/src`, `apps/dashboard/src`,
> `apps/pwa/src`.** Yang satu-satunya vs. kategori §6 adalah file pelaporan ini
> sendiri (draft katalog yang kini *ditimpa*). Gate **pass** (tidak STOP).
> `apps/api` pm2 tetap online (pid 286707, `localhost:3000`, `GET /api/health`
> `{"status":"ok","message":"All systems operational"}`).

---

## Ringkasan peta arsitektur (WA inbound → compose → send)

- **WA inbound entry** = kontroler webhook → memanggil engine.
  - GOWA: `src/routes/webhooks.ts:21` POST `/api/webhooks/gowa` → dispatch ke
    `messageProcessorService.processMessage({...})` di `webhooks.ts:102`.
  - Fonnte: `src/routes/webhooks.ts:129` POST `/api/webhooks/fonnte` → dispatch ke
    `messageProcessorService.processMessage({...})` di `webhooks.ts:261`.
- **Engine entry (sebelum fast-path/tier/compose):**
  `src/services/message-processor.service.ts:96`
  `async processMessage(input: ProcessMessageInput): Promise<ProcessedResult | null>`.
  Urutan stage (komentar kode `:100-101` dan blok di bawah): 1.Dedup `:109` →
  2.Dead-end `:115` → 3.Priority `:138` → 4.Coalesce/buffer `:152` → 5.Mutex
  `acquireLock(chatId)` `:161` → `processWithLock(:168)` → 6.Circuit-breaker `:218`
  → channel-validation `:236-251` → 7.`conversationService.processCustomerMessage`
  (`:255-257`) = **masuk ke engine fast-path/tier/compose**.
- **Web Adapter (PWA Web) — JALUR TERPISAH:** `src/routes/pwa.ts:140` POST
  `/api/pwa/:storeSlug/message` (`conversationLimiter`) memanggil
  `conversationService.processCustomerMessage` **langsung**, **bukan** lewat
  `messageProcessor.processMessage` / mutex / circuit-breaker / `sendWithPresence` —
  balasannya dikembalikan sebagai HTTP response (`pwa.ts:137-140`).

---

## Bagian A — Titik intercept SEBELUM engine (bukan tambah tier baru)

### A1. Titik PALING AWAL pesan WA diproses, SEBELUM fast-path/tier — + mekanisme "state pending"

**Titik paling awal (entry engine WA):** langsung di puncak
`messageProcessorService.processMessage` — `src/services/message-processor.service.ts:96`:
```ts
  async processMessage(input: ProcessMessageInput): Promise<ProcessedResult | null> {
    const startTime = Date.now();
    const chatId = input.conversationId;
    const raw: RawMessage = {
      id: input.messageId,
      chatId,
      storeId: input.storeId,
      customerId: input.customerId,
      ...
```
Ini dipanggil dari kedua kontroler webhook (`webhooks.ts:102` GOWA, `webhooks.ts:261`
Fonnte) dan merupakan titik **tertutup sebelum masuk ke stage apa pun** (dedup →
dead-end → coalesce → mutex → circuit-breaker → channel-validation → engine).

Titik intercept "aman, post-lock, pre-engine" yang **konsisten dilewati kedua path**
(langsung `:166`/`handleFlushed :200`) dan **sebelum create Conversation /
fast-path / compose**, adalah blok *channel-aware validation* di
`src/services/message-processor.service.ts:236-251` (komentar kode menyebutnya
eksplisit sebagai gerbang pre-engine):
```ts
  // 6. Call conversation service (handles context + fallback chain)
  ...
    const channel = input.channel ?? 'whatsapp';
    if (channel === 'whatsapp' && !input.customerPhone) {
      throw new Error(
        `customerPhone required for whatsapp channel (storeId=${input.storeId}, conversationId=${input.conversationId})`
      );
    }
    if (channel === 'web' && !input.webUid) {
      throw new Error(
        `webUid required for web channel (storeId=${input.storeId}, conversationId=${input.conversationId})`
      );
    }
```
`conversationService.processCustomerMessage(...)` — entry ke fast-path/tier/compose —
berada tepat di bawah blok ini, `src/services/message-processor.service.ts:253-264`:
```ts
  // 7. Call conversation service (handles context + fallback chain)
  let result;
  try {
    result = await this.llmCircuitBreaker.wrap(() =>
      conversationService.processCustomerMessage(
        input.storeId,
        input.customerId,
        input.conversationId,
        msg.content,
        channel
      )
    );
```
→ **Fakta:** titik paling awal sebelum fast-path/tier/compose = `processMessage`
`message-processor.service.ts:96` (atau blok validasi channel `:236-251` bila
ingin injeksi post-mutex yang dilewati path flush). Tidak perlu menambah keyword
ke 11-tier fast-path; hanya perlu baca/mutasi pada input sebelum `:255`.

**Mekanisme "state pending" di Conversation (untuk menandai "menawarkan CTA,
menunggu ya/lanjut"):**

Model `Conversation` — `prisma/schema.prisma:140-168`:
```ts
model Conversation {
  id                    String   @id @default(uuid())
  storeId               String
  customerId            String
  customerName          String?
  customerPhone         String?
  status                String   @default("open")      // :146
  channel               String   @default("whatsapp") // :147
  lastMessageAt         DateTime?                     // :148
  aiResponseCount       Int      @default(0)           // :149
  faqResponseCount      Int      @default(0)           // :150
  humanTakeoverAt       DateTime?                      // :151
  ...
  metadata              Json?                         // :155
  ...
}
```
- `status` `@146`: string bebas (`@default("open")`). Nilai yang **ditulis mesin** =
  `'open'` (create `conversation.service.ts:77`, dan `updateConversationStats`
  `:1110`) dan `'human_takeover'` (lewat `markHumanTakeover → escalateStatusUpdate`
  `composer-v2.ts:45-47`, dipanggil `conversation.service.ts:455` & `:551`).
  `'resolved'` hanya diterima via API `PUT /api/conversations/:id/status`
  (`routes/conversations.ts:73-104`, `:88-89` set `humanTakeoverAt`, `:90-91` clear,
  `:1236` set `resolvedAt` bila `'resolved'`). **Tidak ada nilai `'pending'`/`'cta'`/
  `'waiting'`/`'awaiting_reply'` yang didefinisikan atau ditulis di mana pun.**
- `metadata Json?` `@155`: kolom tersedia tapi **TIDAK pernah ditulis mesin**. Semua
  literal `metadata` di `conversation.service.ts` (`:128, :209, :277, :359, :472,
  :514, :539, :568, :587, :660, :694`) adalah `ResponseResult.metadata` yang
  disimpan ke `conversation_history.metadata` lewat `saveMessage`
  (`conversation.service.ts:1084`), **bukan** ke kolom `Conversation.metadata`.
- Engine v2 punya konsep "pending" **terpisah** (bukan di Conversation):
  `workspace.pendings[]` dengan `pending.status === 'deferred'` / `'resolved'`
  (`conversation.service.ts:161-168` dan `:222-225`), persisted di kolom
  `workspace_v2` JSON (`schema.prisma:198`) via
  `conversationContextService.updateWorkspaceV2`. Ini *clarification-pending*,
  **bukan** flag "conversation menunggu jawaban CTA customer".
- Counter yang ada: `aiResponseCount` / `faqResponseCount` (`schema.prisma:149-150`),
  dinaikkan oleh `updateConversationStats` setelah balasan terkirim
  (`conversation.service.ts:1111-1112`).

→ **Fakta:** tidak ada mekanisme *state pending* tingkat Conversation untuk
"menawarkan CTA, menunggu ya/lanjut". Kolom yang *bisa* membawa state semacam itu
(yang belum dipakai mesin): nilai string baru pada `status` (`@146`, lewat
`PUT /conversations/:id/status` `conversations.ts:73`) — tapi hanya manual API, tidak
auto; dan `metadata Json?` (`@155`) — tersedia, tidak ditulis. *(Audit only: tidak
usulkan nilai/status baru.)*

---

### A2. Deteksi "ini pesan PERTAMA customer di conversation ini"

**Tidak ada flag/counter khusus "first message" pada Conversation** (schema `140-168`
di atas; tidak ada `messageCount`/`firstMessage`/`firstCustomerMessage`).

Sinyal yang **ada** untuk mendeteksi "pertama" — semuanya *derived*, bukan kolom
boolean:

1. `aiResponseCount Int @default(0)` + `faqResponseCount Int @default(0)`
   (`schema.prisma:149-150`). Nilainya `0` berarti **belum ada balasan AI/FAQ pernah
   terkirim** pada conversation ini (bukan "customer belum pernah kirim"). Dinaikkan
   di `updateConversationStats` (`conversation.service.ts:1111-1112`), dibaca di
   `mapConversationWithContext` (`:1282-1283`) dan `findByIdWithHistory`
   (`:1360-1361`):
   ```ts
   // conversation.service.ts:1106-1114
   await prisma.conversation.update({
     where: { id: context.conversationId },
     data: {
       lastMessageAt: new Date(),
       status: 'open',
       aiResponseCount: isAI ? { increment: 1 } : undefined,
       faqResponseCount: isFAQ ? { increment: 1 } : undefined,
     },
   });
   ```
2. **Per-conversation, sinyal first-inbound = cabang `create` dari upsert** di entry
   `processCustomerMessage` — `conversation.service.ts:68-79`:
   ```ts
   const conversation = await prisma.conversation.upsert({
     where: { id: conversationId },
     update: {},
     create: {
       id: conversationId,
       storeId: storeId,
       customerId: customerId,
       customerPhone: channel === 'web' ? null : customerId, // WA: pakai customerId(=phone asli); Web: null (bukan webUid)
       channel,
       status: 'open',
     },
   });
   ```
   `update: {}` adalah *no-op*; cabang `create` hanya berjalan ketika `conversationId`
   belum ada ⟹ **first message untuk conversationId itu**. Untuk WA, `conversationId =
   \`${store.id}:${customerPhone}\`` (deterministic per customer; `webhooks.ts:70`
   GOWA, `webhooks.ts:201` Fonnte). Untuk Web, `conversationId` adalah UUID
   (`pwa.ts:107` komentar, dibuat oleh engine).
3. **Riwayat kosong sebelum pesan ini:** `saveMessage` menulis ke
   `conversation_history.create` (`conversation.service.ts:1076`); "history kosong"
   bisa diverivasi lewat `prisma.conversationHistory.findMany({ where: {
   conversationId } })` (dipakai *read-only* di `getConversationStats`
   `conversation.service.ts:1292-1294` dan `findByIdWithHistory` `:1341-1351`,
   **bukan** di path inbound untuk mengawal proses pertama).

   (Sampingan yang relevan: pada create-branch di atas, `customerPhone` di-set `null`
   untuk channel `web` — `conversation.service.ts:75`. Ini berarti balasan downstream
   yang membaca `customerPhone` akan melihat `null` untuk Web; lihat catatan pada
   bagian akhir A2.)

Signal per-customer (bukan per-conversation): `Customer.visitCount Int
@default(0)` (`schema.prisma:402`) + `firstSeenAt DateTime @default(now())`
(`schema.prisma:403`). Grep tidak menemukan `visitCount` di-increment dalam path
processing `conversation.service.ts` — jadi tidak dipakai engine untuk deteksi first.

→ **Fakta:** tidak ada *single boolean* "isFirstMessage". Deteksi "pesan pertama"
adalah *derived* — paling dapat diandalkan lewat **cabang create upsert**
(`conversation.service.ts:68-79`, `update:{}` no-op) atau **kombinasi
`aiResponseCount===0 && faqResponseCount===0`** (`schema.prisma:149-150`).

---

### A3. Titik compose balasan final — SATU titik (composer-v2) atau TERSEBAR?

**TIDAK ada satu titik compose tunggal.** Composer berbeda per jalur:

- `composeReply` (def `src/services/chat/composer-v2.ts:49`,
  signature `composeReply(params:{plannedActs;reasoningResult;workspace;catalog;clarificationAttempt}): string`)
  dipanggil **SATU KALI** — hanya di jalur v2 *general/terminal*,
  `conversation.service.ts:341` (komentar `:340` "// 6. Compose reply pakai composer-v2"):
  ```ts
  const composed = composeReply({
    plannedActs: (reasoningOutcome as any).plannedActs || [],
    reasoningResult: (reasoningOutcome as any).result || { ... },
    workspace,
    catalog,
    clarificationAttempt: 1,
  });
  const reply = truncateTo2Sentences(composed); // :351
  ```
- **Semua jalur LAIN menyematkan teks balasan secara *inline* lewat `buildResult`**
  (def `conversation.service.ts:1008`):
  ```ts
  private buildResult(conversationId: string, option: { source: ResponseSource; content: string;
    confidence: number; cost: number; metadata?: Record<string, number | string | boolean | null | string[]> }): ResponseResult
  ```
  — dengan call-site: `123` (v2 safe-reply), `204` (v2 fast-path tier-hit,
  `outcome === 'tier'`), `272` (v2 resolved), `354` (v2 general, *setelah* composeReply),
  `467` (ESCALATE), `509` (EXECUTE), `534` (ROLLBACK), `563` (RETRY→escalate),
  `582` (RETRY re-ask), `655` (LLM clarification ask), `664` (LLM reply_draft),
  `689` (Stage-5 dead-end fallback). Di `buildResult` teks balasan diserahkan langsung
  lewat `option.content` (`:1013`), bukan melalui composer.
- Fast-path tier (Stage 3, 0-LLM) memakai `fallbackService.getResponse`
  (`conversation.service.ts:614-618`) — hasilnya dipakai langsung, **tidak** ke
  `composeReply`:
  ```ts
  // conversation.service.ts:609-618
  stagesReached.push('tier3');
  const tierResult = await fallbackService.getResponse(normalizedMsg, pipelineCtx);
  if (tierResult && tierResult.source !== ResponseSource.HUMAN) {
    result = tierResult;
    finalIntent = 'fastpath';
  }
  ```
- `composeEscalateReply` (def `composer-v2.ts:35`) adalah *composer* lain (fixed string),
  dipanggil di `conversation.service.ts:456` & `:552`.
- `truncateTo2Sentences` (impor `interpreter.ts`, `conversation.service.ts:8`) juga
  dipakai inline (mis. `:666` di path LLM v1).

**Titik kirim (send) ke WA — SATU titik, terpusat:** `sendWithPresence`
(`src/services/message-processor.service.ts:323`):
```ts
  private async sendWithPresence(
    input: ProcessMessageInput,
    content: string
  ): Promise<void> {
```
dipanggil hanya dari 3 tempat: `:221` (circuit-breaker fallback), `:270` (LLM-failure
fallback), `:299` (hasil normal). Semua balasan WA eklik ke sini.
(**Pengecualian:** PWA Web Adapter `pwa.ts:140` **tidak** lewat `sendWithPresence` —
balasannya langsung jadi HTTP response.)

→ **Fakta:** *compose* balikan **tersebar** — `composeReply` (composer-v2) hanya untuk
jalur v2 general (`:341`); tier fast-path + resolved/rollback/retry/escalate/dead-end/LLM
mensupply `content` secara inline via `buildResult`. *Send* ke WA tunggal = `sendWithPresence`
`message-processor.service.ts:323` (panggilan `:221/:270/:299`).

---

### A4. Sudah ada mekanisme kirim link/CTA (mis. tombol "lanjut"/"masuk katalog") di balasan?

**Belum.** Grep `cta|wa.me|https|bit.ly|shortlink|link` di
`src/services/chat/`, `src/business/conversation.service.ts`,
`src/services/message-processor.service.ts`, `composer-v2.ts`, `fallback.service.ts`
→ **satu match tunggal** — tautan *teks* QRIS di
`src/services/message-processor.service.ts:400` (bagian dari `sendQrisFollowUp`,
`message-processor.service.ts:397-456`):
```ts
  // 9. QRIS follow-up — kirim gambar QRIS atau teks link tergantung gateway dan paket Fonnte.
  private async sendQrisFollowUp(input: ProcessMessageInput, imageUrl: string): Promise<void> {
    if (!imageUrl) return;
    const textLink = `Berikut QRIS kami, silakan klik untuk melihat: ${process.env.PUBLIC_API_URL || 'https://api.qlobot.web.id'}/r/${input.storeId}`;
```
Ini tautan *deep-link* ke redirect router `/r/:storeId` (`index.ts:99`,
`src/routes/redirect.ts`), dikirim **hanya** setelah balasan dengan `source ===
'payment'` + ada `qrisImageUrl` (`message-processor.service.ts:301-304`):
```ts
  // 9. QRIS image follow-up (pengiriman setelah teks payment response)
  if (result.source === 'payment' && result.metadata?.qrisImageUrl) {
    await this.sendQrisFollowUp(input, result.metadata.qrisImageUrl);
  }
```
- `composer-v2.ts composeReply` (`:49-131`) menyusun balasan dari
  `plannedActs`/`draft_cart_ops`/`clarification`/`reply_draft`/`topic_switch` —
  **tidak menyisipkan tautan/CTA/tombol apa pun**. Loop penyusun akhirnya
  (`composer-v2.ts:126`):
  ```ts
  const finalReply = messages.slice(0, 3).join('\n');
  ```
  tidak ada `https://` / `wa.me` / tombol.
- PWA Web Adapter `pwa.ts:140` (`POST /message`, memanggil `processCustomerMessage`
  langsung, tidak `sendWithPresence`) juga **tanpa link/CTA** — membalas dengan
  `result.message.content` dari engine.

→ **Fakta:** tidak ada mekanisme kirim link/CTA berupa "lanjut / masuk ke katalog /
pilih produk" di balasan chat. Satu-satunyanya adalah tautan QRIS tekstual
(`message-processor.service.ts:400`) pada jalur WA pasca-`payment`, via
`sendQrisFollowUp` — bukan mekanisme link/CTA umum dari composer. `composer-v2` tidak
menyematkan tautan.

---

## Bagian B — DUA kelas link (jangan disatukan)

### B5. Link PERSONAL (dari WA, bawa identitas) — mekanisme token sementara yang ADA

Token identitas di codebase **hanya DB-backed (bukan Redis)** dan seluruhnya
**terikat STORE (bukan customer)** — tidak ada token customer-scoped satupun.

1. **`Store.webhookSecret` — pola "random token → @unique scalar → findFirst by token".**
   - Kolom: `prisma/schema.prisma:33` `webhookSecret String? @unique`.
   - Generate: `crypto.randomBytes(24).toString('hex')` di
     `src/routes/auth.ts:16-19`:
     ```ts
     function generateWebhookSecret(): string {
       return crypto.randomBytes(24).toString('hex');
     }
     ```
   - Persisted: register `auth.ts:38`; login (auto-create store) `auth.ts:110`.
   - Lookup-by-value (token → store): `src/routes/webhooks.ts:141-144` (Fonnte webhook
     auth):
     ```ts
     const store = await prisma.store.findFirst({
       where: { webhookSecret, isActive: true, deletedAt: null },
       select: { id: true, fonnteNumber: true, fonnteToken: true, timezone: true },
     });
     ```
   - Rotate (situs generate kedua): `src/routes/messages.ts:96-104`
     (`webhookSecret = crypto.randomBytes(24).toString('hex')` di `:99`;
     `prisma.store.update({ where:{id:storeId}, data:{webhookSecret} })` di `:101-104`;
     URL webhook `?secret=` di `:106`).
   → Token ini **mengidentifikasi STORE** (otentikasi inbound webhook Fonnte), bukan
   customer.

2. **`StoreSetting` key-value auth_token — pola "randomUUID token + expiry, persisted KV".**
   - Tabel: `prisma/schema.prisma:87-97` (`@@unique([storeId, key])` di `:96`).
   - Generate + persist (register): `src/routes/auth.ts:51-66`:
     ```ts
     const token = crypto.randomUUID();
     await prisma.storeSetting.upsert({
       where: { storeId_key: { storeId: store.id, key: 'auth_token' } },
       update: { value: token },
       create: { storeId: store.id, key: 'auth_token', value: token },
     });
     const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
     await prisma.storeSetting.upsert({ ... 'auth_token_expires_at' ... }); // :62-66
     ```
   - Sama di login `auth.ts:141-156` (generate `crypto.randomUUID()` `:141`; persist
     `auth_token` `:144-148` + `auth_token_expires_at` 7 hari `:150-156`).
   - Lookup = `prisma.storeSetting.findUnique({ where:{storeId_key:{storeId, key:'auth_token'}}})`
     (dipakai middleware `authMiddleware`).
   → Token **mengidentifikasi STORE session**, ada mekanisme expiry (`expiresAt`).

3. **`AdminAuthToken` table** — `prisma/schema.prisma:379-392`:
   `token String @unique` (`:382`), `expiresAt DateTime` (`:383`), `revokedAt
   DateTime?` (`:384`), relasi ke `AdminUser` (`:387`). Pola token+expiry, tapi
   **scope admin**, bukan customer/link publik.

**Apa saja mekanisme "token → lookup → entity" yang dapat ditiru polanya:** (1)
`Store.webhookSecret` (`auth.ts:18` generate → lookup `webhooks.ts:141`); (2)
`StoreSetting` auth_token KV (`auth.ts:51`, expiry `auth.ts:62`). **Apa yang TIDAK
ada:** (a) tidak ada token **customer-scoped** (tabel/token untuk identitas customer
yang bawa ke link); (b) **tidak ada Redis-based one-time token** — grep `redis` di
`src/infrastructure | src/services | src/business` hanya temukan: cache config mesin
(`services/chat/engine-config.ts:14-43` via `redisAdapter.get/set` →
`adapters/cache/redis.adapter`), AI-key cooldown
(`services/ai-key-router.service.ts:16` `new Redis(...)` + cooldown keys), dan metrics
list (`services/chat/engine-metrics.ts`). TIDAK ada token identitas/link di Redis;
(c) **tidak ada mekanisme reset-password / email-verify token** — schema tidak ada
tabel `ResetToken`/`EmailVerify`/`VerifyToken`; model `Customer`
(`schema.prisma:394-413`) field-nya `id, storeId, phone, webUid, name, originCity,
nameSource, visitCount, firstSeenAt, lastSeenAt, notes, deletedAt` — **tidak ada
`emailVerified`**. `auth.ts` pakai `hashPassword/verifyPassword` dan password change
via `PUT /api/profile/password` (`routes/profile.ts:123-156`), tidak ada flow token
reset. Grep route `reset|verify` → tidak ada (hanya `resetForm` helper React di
`MagicPasteConfigPanel`/`KnowledgeManager`/`FaqManager`, tidak berkaitan).

**Identitas customer channel web yang ada untuk dikunci ke link:** `Customer.webUid
String? @unique` (`schema.prisma:398`) — dipakai Web Adapter
(`pwa.ts:97-100` resolve customer by webUid; `conversation.service.ts:75`
`customerPhone: channel==='web'?null:customerId`; `message-processor.service.ts:247`
guard `if (channel==='web' && !input.webUid) throw`).

→ **Fakta:** pola token→lookup→entity dapat ditiru = `Store.webhookSecret`
(`auth.ts:18` → lookup `webhooks.ts:141`) dan `StoreSetting` auth_token KV
(`auth.ts:51` + expiry `auth.ts:62`). Keduanya **store-scoped**; tidak ada token
customer-scoped/temp; tidak ada Redis token; identitas web customer ada di
`Customer.webUid` (`schema.prisma:398`).

---

### A2 (lanjutan, fakta temuan pelengkap terkait channel Web)
Pada upsert Conversation di `conversation.service.ts:75`, `customerPhone` diset
`null` untuk channel `web`:
```ts
customerPhone: channel === 'web' ? null : customerId, // WA: pakai customerId(=phone asli); Web: null (bukan webUid)
```
→ untuk Web, `customerPhone` **tidak** berisi phone asli — memang `null`. Jadi tidak
ada fallback `customerPhone = webUid`; justru Web sengaja memaksa `customerPhone`
`null` (identitas Web dibawa lewat `customerId`/`webUid`, bukan `customerPhone`).
Tidak ada kode lain di `conversation.service.ts` yang membaca `customerPhone` untuk
matching/lookup (hanya `customerPhone` ditulis di upsert `:75`; tidak ada
`findUnique/findFirst by customerPhone` di service ini; lookup customer by phone
hanya dilakukan di webhook controller `webhooks.ts:76-77`/`webhooks.ts:209-210`).

---

### B6. Link PUBLIK toko (slug) — endpoint API yang UPDATE `Store.slug`

**Belum ada endpoint API yang menulis `slug`.** `grep -rnE 'slug' src/routes src/business`
→ hanya `src/routes/pwa.ts`.

- Kolom: `prisma/schema.prisma:13` `slug String? @unique`.
- **Hanya dibaca**, oleh PWA Web Adapter:
  - `PWA_STORE_PUBLIC_SELECT` (`pwa.ts:30-47`, `slug: true` di `:32`) untuk
    `GET /api/pwa/:storeSlug/init` → `pwa.ts:57-60`:
    ```ts
    const store = await prisma.store.findUnique({
      where: { slug: storeSlug, deletedAt: null },
      select: PWA_STORE_PUBLIC_SELECT,
    });
    ```
  - Sama `where:{slug:storeSlug}` di `GET /pwa/:storeSlug/history` (`pwa.ts:80-83`)
    dan `POST /pwa/:storeSlug/message` (`pwa.ts:140`, `:152-155`).
- `PUT /api/profile` (`routes/profile.ts:62-100`): `updateData` (`:67-77`) hanya berisi
  `{name, description, businessCategory, address, phoneNumber, timezone,
  operatingHours}` — **tidak ada `slug`**. GET /profile (`profile.ts:22-55`) response
  juga **tidak ada `slug`**:
  ```ts
  const { name, description, businessCategory, address, phoneNumber, timezone,
          operatingHours, ... } = req.body;   // :65 — tanpa slug
  ```
- `PUT /api/auth/profile` (`routes/auth.ts:182-247`): destructure `:185` +
  `updateData` (`:194-206`) = `{name, timezone, phoneNumber, fonnteToken, fonnteNumber,
  acceptsTransfer, acceptsQris, acceptsCod, qrisImageUrl, shippingMode,
  shippingFlatInCity, shippingFlatOutCity}` — **tidak ada `slug`**.
- Tidak ada admin route update toko dengan slug (`grep -rnE 'slug' src/routes/admin/*`
  → kosong).

→ **Fakta:** `slug` `@unique` (`schema.prisma:13`) hanya dibaca oleh
`GET /pwa/:storeSlug/init` (`pwa.ts:57-60`); tidak pernah ditulis oleh endpoint
manapun (register/auth/profile/store-products/products/admin). Untuk manajemen slug
publik, **update endpoint belum tersedia di mana pun** — `slug` saat ini hanya
dapat diset melalui DB langsung (mis. pada test P-PWA.11/12 via Prisma `create`).

---

### B7. Komponen dashboard edit profil toko (tempat sisipkan field `slug`)

Komponen profil toko di dashboard adalah `apps/dashboard/src/pages/ProfilePage.tsx`
(store-owner profile edit form). `slug` **tidak ada di mana pun** di form ini:

- Interface data `ProfileData` (`ProfilePage.tsx:21-38`) — **tidak ada `slug`**:
  ```ts
  interface ProfileData {
    name: string;
    email: string;
    phoneNumber: string | null;
    description: string | null;
    businessCategory: string | null;
    address: string | null;
    profilePhotoUrl: string | null;
    timezone: string;
    operatingHours: any;
    acceptsTransfer: boolean;
    acceptsQris: boolean;
    acceptsCod: boolean;
    qrisImageUrl: string | null;
    shippingMode: 'pickup' | 'flat';
    shippingFlatInCity: number | null;
    shippingFlatOutCity: number | null;
  }
  ```
- `form` state (`ProfilePage.tsx:130-132`) — `{name, description, businessCategory,
  address, phoneNumber, timezone}`; populate dari `api.get('/profile')` (`:258-269`,
  `setForm({ name:d.name, description:d.description, ... })`). **Tidak ada `slug`**
  (konsisten: GET /profile `profile.ts:22-55` tidak kirim `slug`).
- `handleSave` payload (`ProfilePage.tsx:449-457`) — **tidak ada `slug`**:
  ```ts
  const payload = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    businessCategory: form.businessCategory.trim() || null,
    address: form.address.trim() || null,
    phoneNumber: form.phoneNumber.trim() || null,
    timezone: form.timezone,
    operatingHours: { v: 2, days: operatingHours.days, summary: regenerated },
  };
  const res = await api.put('/profile', payload);   // :458
  ```
- JSX input field Section Profil (`ProfilePage.tsx` ~790-836): Nama Toko
  (`793-799`), Kategori Bisnis (`803-810`), Deskripsi (`816-819`), Nomor Kontak
  (`829-836`), dst. — **tidak ada `<input>`/`slug`**.
- Simpan pembayaran via `PUT /auth/profile` (`handleSavePayments`, `476-481`) &
  shipping (`handleSaveShipping`) juga **tidak ada `slug`**.

Form **onboarding** alternatif: `apps/dashboard/src/pages/OnboardingProfile.tsx`
(`8-102`). Menggunakan tipe `StoreFormData` dari
`apps/dashboard/src/contexts/AuthContext.tsx:4-10`:
```ts
export interface StoreFormData {
  name: string;
  timezone?: string;
  phoneNumber?: string;
  email?: string;
  isActive?: boolean;
}
```
— **tidak ada `slug`**. `form` state (`OnboardingProfile.tsx:17-21`: name/timezone/
phoneNumber) dan `handleSubmit` → `completeProfile(form)` (`OnboardingProfile.tsx:32`,
`AuthContext.completeProfile` `:26`/`:70`) — `completeProfile` meledok ke
`PUT /api/auth/profile` (`auth.ts:182`), juga **tidak ada `slug`**.

→ **Fakta:** form edit profil toko = `ProfilePage.tsx` (interface `:21-38`, form
state `:130-132`, populate `:263-269`, payload `:449-457`, PUT /profile `:458`, input
field Section Profil `:793-836`); form onboarding = `OnboardingProfile.tsx`
(interface `StoreFormData` `AuthContext.tsx:4-10`, form state `:17-21`, handleSubmit
`:32`). **Keduanya tidak ada `slug`.** Sisipkan field `slug`: (i) interface
`ProfileData`/`StoreFormData`, (ii) `form` state + populate, (iii) payload
`handleSave`/`completeProfile`, (iv) render `<input name="slug">` di Section Profil
`~793` — dan backend `GET/PUT /profile` + `/auth/profile` harus mendukung `slug`
(lihat B6) supaya round-trip. *(Audit only: tidak spesifikasi validasi nama field.)*

---

### B8. Pola validasi uniqueness existing (untuk error-handling `slug`)

`Store` kolom `@unique`: `slug` (`schema.prisma:13`), `email`
(`schema.prisma:19`), `webhookSecret` (`schema.prisma:33`). Semuanya
`String?` / `String?` — `email` & `webhookSecret` nullable tapi `@unique` (bisa
duplikat `null`), `slug` nullable + `@unique`.

**Dua lapis handler uniqueness (P2002):**

1. Handler global: `src/middleware/errorHandler.ts:30-49`:
   ```ts
   if (err.name === 'PrismaClientKnownRequestError') {
     const prismaErr = err as any;
     let message = 'Database error';
     if (prismaErr.code === 'P2002') message = 'Resource already exists';
     if (prismaErr.code === 'P2025') message = 'Resource not found';
     ...
     res.status(409).json({
       error: message,
       code: ErrorCodes.ERR_DB_DUPLICATE,
       requestId,
       timestamp: new Date().toISOString(),
     });
     return;
   }
   ```
   Terdaftar global di `src/index.ts:165` (`app.use(errorHandler)`), setelah semua
   route mount (`:96-114` dsb.). Jadi **setiap** P2002 (termasuk `slug`) otomatis →
   HTTP `409` + `{ error: 'Resource already exists', code: ERR_DB_DUPLICATE }`.

2. Handler per-route (race-prevention lewat pre-check + P2002):
   `src/routes/auth.ts:26-29` (pre-check email) + catch `:79-82`:
   ```ts
   const existing = await prisma.store.findFirst({ where: { email } });   // :26
   if (existing) { return res.status(409).json({ error: 'Email already registered' }); } // :28
   ...
   } catch (error: any) {
     if (error?.code === 'P2002') {
       return res.status(409).json({ error: 'Email already registered' });  // :81
     }
   ```

→ **Fakta:** pola existing untuk `@unique` violation = tangkap `error?.code ===
'P2002'` → HTTP `409` (atau biarkan handler global `errorHandler.ts:33`
→ `409 'Resource already exists'` / `ERR_DB_DUPLICATE`). `slug`
(`schema.prisma:13` @unique) akan memicu P2002 pada duplikat ⟹ pola error-handling
yang sama: **409 Conflict** — global `errorHandler.ts:43-48` memberi
`'Resource already exists'`, atau per-route seperti `auth.ts:80-81` memberi pesan
spesifik (`'Email already registered'`). Tidak ada handler `slug` khusus saat ini.
*(Audit only.)*

---

## Acceptance (RAILS §5 — verifikasi read-only)

- Tujuan: audit read-only (intercept pre-engine + 2 kelas link + slug management).
  **Tidak ada file source / config / schema yang diubah** — hanya file pelaporan
  `DOCS/laporan-taskPWA13-audit.md` (overwrite draft katalog sebelumnya).
- Rencana commit: `git add DOCS/laporan-taskPWA13-audit.md` →
  `git diff --cached --name-only` = **hanya** file pelaporan itu — maka
  `git diff --stat` = 1 file baru.
- `apps/api` pm2 **tidak disentuh** (tidak ada script/data dibuat/hapus, tidak ada
  build, tidak ada restart) → pid 286707 tetap online, `GET /api/health` tetap ok.

## Checklist fakta lintas-titik (cross-check singkat)
- WA inbound entry → `webhooks.ts:102` (GOWA) / `webhooks.ts:261` (Fonnte) →
  `messageProcessorService.processMessage` (`message-processor.service.ts:96`).
- Pipeline stage order + mutex: `message-processor.service.ts:109-167` (dedup→dead-end→priority→coalesce→mutex
  `acquireLock` `:161` → `processWithLock` `:168`); channel-validation
  pre-engine (dilewati path `:166` & flush `:200`): `:236-251`; engine call
  `:255-257`.
- Single SEND-to-WA chokepoint: `sendWithPresence` (`message-processor.service.ts:323`),
  panggilan `:221/:270/:299`.
- Compose: `composeReply` (`composer-v2.ts:49`) dipanggil Satu Kali di `conversation.service.ts:341`;
  buildResult (`:1008`) call-site: 123, 204, 272, 354, 467, 509, 534, 563, 582, 655, 664, 689;
  fast-path Stage 3 `fallbackService.getResponse` (`:614-618`).
- Link/CTA: satu-satunyanya `textLink` QRIS `message-processor.service.ts:400` (WA-only,
  pascabay `payment`); `composer-v2.ts:49-131` tidak menyematkan tautau.
- Token personal-link pattern: `Store.webhookSecret` (`schema.prisma:33`; gen
  `auth.ts:18`; lookup `webhooks.ts:141-144`; rotate `messages.ts:99`/`:104`); `StoreSetting`
  auth_token KV (`schema.prisma:96 @@unique([storeId,key])`; gen `auth.ts:51`; expiry `auth.ts:62`;
  login `auth.ts:141-156`). Tidak ada Redis token, tidak ada tabel reset/verify; identitas web
  customer `Customer.webUid` (`schema.prisma:398`).
- Slug write: tidak ada. `Store.slug` `@unique` (`schema.prisma:13`); dibaca
  `pwa.ts:32/57-60/80/152`; tidak ada di `profile.ts` (`:65/:67-77`), `auth.ts` (`:185/:194-206`),
  admin routes.
- Dashboard slug form: `ProfilePage.tsx` (interface `:21-38`, form state `:130-132`,
  populate `:263-269`, payload `:449-457`, PUT /profile `:458`, inputs `:793-836`);
  onboarding `OnboardingProfile.tsx` + `StoreFormData` (`AuthContext.tsx:4-10`, `:17-21`, `:32`) — tidak ada slug.
- Uniqueness error pattern: `errorHandler.ts:33` P2002 → 409 `'Resource already exists'`
  (`ERR_DB_DUPLICATE`), global via `index.ts:165`; per-route `auth.ts:80-81`
  P2002 → 409 pesan spesifik. `Store @unique`: slug `:13`, email `:19`, webhookSecret `:33`.
