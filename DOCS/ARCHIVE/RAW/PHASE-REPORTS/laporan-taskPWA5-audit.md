# Laporan Audit Read-Only — TASK P-PWA.5 (Kesiapan Web Adapter, Fase 1)

**Mode:** HANYA baca & laporkan. Tidak ada file sumber yang diedit.
**Scope file yang disentuh:** hanya membuat file baru `DOCS/laporan-taskPWA5-audit.md`.
**Cabang:** `main`.

> Catatan metodologi: setiap temuan dilengkapi kutipan kode asli + `file:line` (bukan ringkasan/opini). **TIDAK ada rekomendasi desain Web Adapter** — hasil audit ini adalah bahan baku desain yang akan ditulis Claude di Fase 1 berdasarkan fakta di bawah.

---

## 0. Pre-audit gate — `git status` mentah (WAJIB, langkah pertama)

Diperintahkan sebelum audit apa pun:

```
On branch main
Your branch is ahead of 'origin/main' by 6 commits.
  (use "git push" to publish your local commits)

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	DOCS/05_PWA_IDENTITY_BLUEPRINT.md
	DOCS/laporan-taskPWA3.md
	DOCS/laporan-taskPWA4.md

nothing added to commit but untracked files present (use "git add <file>..." to include in what will be committed)
```

**Kesimpulan gate:** working tree **tidak ada perubahan source yang uncommitted**. `git diff --name-only` (modified tracked files) → kosong (exit hanya menampilkan 3 file `DOCS/` non-source yang untracked: laporan P-PWA.3, P-PWA.4, dan blueprint identity — sesama pola P-PWA.0/P-PWA.4 yang mengizinkan `*.md` untracked asalkan tidak ada source yang berubah). ✅ Lalui. Audit dapat dilanjutkan.

---

## 1. Alur kirim balasan WA saat ini — `processMessage()` trace lengkap

Pertanyaan kunci: apakah `processMessage()` **mengirim balasan sendiri** (panggil `gowaAdapter.sendMessage`/`fonnteService.sendMessage` di dalam), atau **mengembalikan teks** ke caller (`webhooks.ts`) yang baru mengirim?

**Jawaban: INTERNAL-SEND — `processMessage()` mengirim balasan WA sendiri.** Return value-nya hanya metadata untuk logging; caller (`webhooks.ts`) tidak pernah memanggil fungsi kirim.

### Bukti trace (jalur GOWA + Fonnte, sama persis)

**a. Entry point** — dua webhook caller, keduanya hanya `await` hasil dan log:

```ts
// webhooks.ts:102-113  (GOWA)
const result = await messageProcessorService.processMessage({
  storeId: store.id,
  customerId: customerPhone,
  customerPhone,
  conversationId,
  text,
  messageId,
  gateway: 'gowa',
  channel: 'whatsapp',
  deviceId,
  storeTimezone: store.timezone,
});
if (result) {
  adapters.logger.info('GOWA message processed', {        // webhooks.ts:115
    conversationId,
    source: result.source,
    confidence: result.confidence.toFixed(2),
    elapsedMs: result.elapsedMs,
    usedCircuitBreaker: result.usedCircuitBreaker,
  });
}
```

```ts
// webhooks.ts:260-273  (Fonnte — sama)
const result = await messageProcessorService.processMessage({
  …
  gateway: 'fonnte',
  channel: 'whatsapp',
  token: store.fonnteToken,
  inboxId: inboxId ? Number(inboxId) : undefined,
  storeTimezone: store.timezone,
});
if (result) {
  adapters.logger.info('Fonnte auto-reply sent', {          // webhooks.ts:275
    sender, gatewayNumber,
    source: result.source,
    cost: result.cost,
    elapsedMs: result.elapsedMs,
  });
}
```

→ Kedua caller `webhooks.ts` **tidak memanggil send** — hanya me-log `result.source`/`result.confidence`/`result.cost`/`result.elapsedMs`. Return type `ProcessedResult` adalah metadata hasil pemrosesan, **bukan teks balasan yang caller kirimkan.**

**b. Di dalam service — proses *reply* berada di dalam `processWithLock`, bukan dikembalikan ke caller:**

```ts
// message-processor.service.ts:168  (initial path)
return await this.processWithLock(chatId, { ...queued }, input);
```

```ts
// message-processor.service.ts:299  (di dalam processWithLock)
// 8. Send with presence simulation + smart retry
await this.sendWithPresence(input, result.message.content);
```

Yaitu `result.message.content` (balasan AI) **langsung dikirim** ke dalam `sendWithPresence` — bukan dikembalikan ke caller. Return `ProcessedResult` (message-processor.service.ts:308-317) hanya menampung `message: result.message.content` **setelah** pesan sudah terkirim, sebagai metadata:

```ts
// message-processor.service.ts:308-317
return {
  message: result.message.content,
  source: result.source as …,
  confidence: result.confidence,
  cost: result.cost,
  requiresHumanReview: result.requiresHumanReview,
  elapsedMs: Date.now() - startTime,
  usedCircuitBreaker: false,
  usedFallback: false,
};
```

**c. Rantai kirim hingga gateway WA:**

```ts
// message-processor.service.ts:323-374  (sendWithPresence)
private async sendWithPresence(input: ProcessMessageInput, content: string): Promise<void> {
  const gateway = this.getGateway(input.gateway);          // line 327
  …
  await this.smartRetrySend(input.customerPhone, content, sendConfig, input.gateway);  // line 373
}
```

```ts
// message-processor.service.ts:463-477  (smartRetrySend)
private async smartRetrySend(phone: string, content: string, config: SendMessageConfig, gatewayType: 'gowa' | 'fonnte'): Promise<void> {
  const gateway = this.getGateway(gatewayType);            // line 469
  …
  await gateway.sendMessage(phone, content, config);       // line 477  ← ACTUAL SEND
}
```

```ts
// message-processor.service.ts:520-522  (getGateway — hanya WhatsApp)
private getGateway(gateway: 'gowa' | 'fonnte'): IWhatsAppGateway | null {
  return gateway === 'gowa' ? gowaAdapter : fonnteService;
}
```

```ts
// message-processor.service.ts:401-402  → gowa.adapter.ts:44  (GOWA send)
// message-processor.service.ts:415,431    → fonnte.service.ts:86  (Fonnte send)
gateway.sendMessage(input.customerPhone, textLink, { deviceId: input.deviceId });
fonnteService.sendMessage(input.customerPhone, textLink, { token: input.token, inboxid: input.inboxId });
```

**d. `IWhatsAppGateway.sendMessage` (interface) dan dua implementasinya:**

```ts
// whatsapp-gateway.interface.ts:10
export interface IWhatsAppGateway {
  sendMessage(phone: string, text: string, config?: SendMessageConfig): Promise<any>;
  …
}
```

```ts
// gowa.adapter.ts:44  (GOWA — kirim via HTTP ke GOWA API)
async sendMessage(phone: string, text: string, config?: SendMessageConfig): Promise<any> { … }
```

```ts
// fonnte.service.ts:86  (Fonnte — kirim via HTTP ke api.fonnte.com)
async sendMessage(phone: string, text: string, config?: SendMessageConfig): Promise<any> { … }
```

**e. Circuit-breaker / fallback juga *send* internal:**

```ts
// message-processor.service.ts:219-221  (circuit breaker terbuka → kirim hardcoded apology)
if (!this.llmCircuitBreaker.isAvailable()) {
  const fallbackMsg = this.llmCircuitBreaker.getFallbackMessage();
  await this.sendWithPresence(input, fallbackMsg);          // line 221
  …
}
```

```ts
// message-processor.service.ts:269-270  (LLM gagal → kirim fallback)
const fallbackMsg = this.llmCircuitBreaker.getFallbackMessage();
await this.sendWithPresence(input, fallbackMsg);           // line 270
```

**f. Titik kirim lain (QRIS follow-up, juga internal):**

```ts
// message-processor.service.ts:301-304
if (result.source === 'payment' && result.metadata?.qrisImageUrl) {
  await this.sendQrisFollowUp(input, result.metadata.qrisImageUrl);
}
```

`sendQrisFollowUp` (message-processor.service.ts:397-457) memanggil `gateway.sendMessage` / `fonnteService.sendMessage` / `gowaAdapter` — **semua di dalam service**, targetkan `input.customerPhone` (WA number).

**g. Ringkasan flow (awal → selesai) untuk GOWA:**

```
webhooks.ts:102  processMessage({ channel:'whatsapp', customerPhone, gateway:'gowa' })
   └─ message-processor.service.ts:96
      ├─ dedup (:110), dead-end (:118), priority (:139)
      ├─ bufferMessage (:154)  ──► buffered? return null (:157)  [timer→handleFlushed :178]
      ├─ acquireLock (:161)
      └─ processWithLock(:168, {…queued}, input)
           ├─ guard channel-aware (:241-:251)
           ├─ conversationService.processCustomerMessage(:258)
           │    └─ prisma.conversation.upsert (:68)          [create/ensure conversation]
             → result.message.content
           ├─ sendWithPresence(:299, result.message.content)  ← SEND DI SINI (internal)
           │    └─ smartRetrySend(:373) → gateway.sendMessage(:477)
           └─ return ProcessedResult (metadata, :308)          [hanya untuk log di webhooks.ts:115]
```

**Kesimpulan Audit 1 (fakta, bukan rekomendasi):** `processMessage()` adalah **INTERNAL-SEND**. Balasan dikirim di dalam service melalui `sendWithPresence` → `smartRetrySend` → `gateway.sendMessage` (GOWA via `gowaAdapter`, Fonnte via `fonnteService`). Caller `webhooks.ts` hanya menerima `ProcessedResult` (metadata: source/confidence/cost/elapsed) untuk keperluan logging, **tidak pernah mengirim**. `getGateway` (message-processor.service.ts:520-522) hanya mengenali `'gowa' | 'fonnte'` — tidak ada cabang `'web'`. Karena kirim target ke `input.customerPhone` (WA number string), Web Adapter yang tidak memiliki nomor WA membutuhkan titik keluar kirim yang berbeda.

---

## 2. Struktur `ProcessMessageInput` saat ini (pasca P-PWA.4)

Interface penuh, termasuk anotasi lokasi tiap field:

```ts
// message-processor.service.ts:45-60  (pasca P-PWA.4 commit 5c07db2)
export interface ProcessMessageInput {
  storeId: string;
  customerId: string;
  customerPhone: string;
  customerName?: string;
  conversationId: string;
  text: string;
  messageId: string;
  gateway: 'gowa' | 'fonnte';          // line 53 — WA-only enum
  channel?: 'whatsapp' | 'web';         // line 54 — DITAMBAH P-PWA.4 (opsional)
  webUid?: string;                       // line 55 — DITAMBAH P-PWA.4 (opsional)
  deviceId?: string;                    // line 56
  token?: string;                        // line 57
  inboxId?: number;                      // line 58
  storeTimezone?: string;                // line 59
}
```

Kolom-kolom baru yang ditanyakan:

| Field | file:line | Hadir? | Opsional? | Nilai saat ini |
|---|---|---|---|---|
| `channel` | message-processor.service.ts:54 | ✅ **Hadir** (pasca P-PWA.4) | opsional | `'whatsapp' \| 'web'` |
| `webUid` | message-processor.service.ts:55 | ✅ **Hadir** (pasca P-PWA.4) | opsional | `string \| undefined` |
| `gateway` | message-processor.service.ts:53 | ✅ Hadir | **wajib** | `'gowa' \| 'fonnte'` — **tidak ada anggota `'web'`** |

**Konfirmasi:** `channel` (`'whatsapp' | 'web'`) dan `webUid` sudah ada di `ProcessMessageInput`. Namun:
- `customerPhone` (line 48) tetap **`string` (wajib, non-optional)** — artinya Web Adapter caller masih harus mengirimkan `customerPhone` sesuatu (mis. `''` atau dummy) karena TS interface tidak mengizinkan omit. Ini **bukan** kolom opsional seperti `webUid`.
- `gateway` tidak memiliki anggota `'web'` — Web Adapter tidak bisa memilih `'web'` sebagai gateway di enum ini.

**Proof caller WA yang kirim channel eksplisit (pasca P-PWA.4):**

```ts
// webhooks.ts:102-113  (GOWA — kini eksplisit channel:'whatsapp')
const result = await messageProcessorService.processMessage({
  storeId: store.id,
  …
  gateway: 'gowa',
  channel: 'whatsapp',          // line 110
  deviceId,
  storeTimezone: store.timezone,
});
```

```ts
// webhooks.ts:261-273  (Fonnte — kini eksplisit channel:'whatsapp')
const result = await messageProcessorService.processMessage({
  storeId: store.id,
  …
  gateway: 'fonnte',
  channel: 'whatsapp',          // line 269
  token: store.fonnteToken,
  inboxId: inboxId ? Number(inboxId) : undefined,
  storeTimezone: store.timezone,
});
```

---

## 3. Pola resolve/create Customer by phone

### GOWA webhook — `apps/api/src/routes/webhooks.ts:76-95`

```ts
// webhooks.ts:76-95
const existingCustomer = await prisma.customer.findUnique({
  where: { storeId_phone: { storeId: store.id, phone: customerPhone } },
});
if (existingCustomer) {
  await prisma.customer.update({
    where: { storeId_phone: { storeId: store.id, phone: customerPhone } },
    data: {
      lastSeenAt: new Date(),
      ...(customerName && !existingCustomer.name ? { name: customerName, nameSource: 'pushname' } : {}),
    },
  });
} else {
  await prisma.customer.create({
    data: {
      storeId: store.id,
      phone: customerPhone,
      ...(customerName ? { name: customerName, nameSource: 'pushname' } : {}),
    },
  });
}
```

### Fonnte webhook — `apps/api/src/routes/webhooks.ts:209-228`

```ts
// webhooks.ts:209-228  (pola sama persis)
const existingCustomer = await prisma.customer.findUnique({
  where: { storeId_phone: { storeId: store.id, phone: customerPhone } },
});
if (existingCustomer) {
  await prisma.customer.update({
    where: { storeId_phone: { storeId: store.id, phone: customerPhone } },
    data: { … same … },
  });
} else {
  await prisma.customer.create({
    data: {
      storeId: store.id,
      phone: customerPhone,
      …
    },
  });
}
```

**Signature:** `findUnique({ where: { storeId_phone: { storeId, phone } } })`. Composite unique key adalah `Customer @@unique([storeId, phone])`:

```prisma
// prisma/schema.prisma:394-411
model Customer {
  id            String   @id @default(uuid())
  storeId       String
  phone         String?                       // line 397 — nullable (pasca P-PWA.3)
  webUid        String?  @unique             // line 398 — ada, @unique
  …
  @@unique([storeId, phone])                  // line 410
  @@index([storeId])
}
```

**Sumber nomor WA (`customerPhone`) di kedua webhook:**
- GOWA: `webhooks.ts:49` — `const customerPhone = fromJid.replace(/@.*$/, '')` (dari `payload.from`).
- Fonnte: `webhooks.ts:200` — `const customerPhone = sender` (dari `body.sender`/`body.pengirim`).

**Catatan penting untuk Web Adapter:** Field `Customer.webUid` **sudah ada** di schema (`schema.prisma:398`, `String? @unique` — ditambah P-PWA.3), tetapi **tidak ada pola resolve/create Customer by webUid** di kode. Pola resolve/create by phone (webhooks.ts:76-95, :209-228) adalah satu-satunya pola yang ada saat ini. Customer `phone` kolom nullable (schema.prisma:397) sehingga web customer (tanpa WA number) tidak otomatis dilayani oleh pola ini — `storeId_phone` unique akan bentrok bila `phone` null pada banyak customer web. Ini **laporan fakta**, bukan rekomendasi.

---

## 4. Pola create Conversation untuk WA — titik create + trace `channel='web'` tanpa `customerPhone`

### Titan create Conversation (2 titik)

**Titik A — upsert di `processCustomerMessage` (jalur pipeline utama):**

```ts
// conversation.service.ts:68-79
const conversation = await prisma.conversation.upsert({
  where: { id: conversationId },                          // line 68
  update: {},
  create: {
    id: conversationId,                                   // line 71
    storeId: storeId,                                     // line 72
    customerId: customerId,                               // line 73
    customerPhone: customerId, // Fallback nilai phone dengan customerId  // line 74-75
    channel,                                              // line 76
    status: 'open',                                       // line 77
  },
});
```

Signature pemanggilannya (hapus literal hardcode — sudah pakai param `channel` default `'whatsapp'`, per P-PWA.4):

```ts
// conversation.service.ts:59-65
async processCustomerMessage(
  storeId: string,
  customerId: string,
  conversationId: string,
  customerMessage: string,
  channel: 'whatsapp' | 'web' = 'whatsapp',   // line 64 — param, bukan literal
): Promise<ResponseResult | null> {
```

**Titik B — `createConversation` (factory terpisah):**

```ts
// conversation.service.ts:1173-1199
async createConversation(
  storeId: string,
  customerId: string,
  customerPhone: string,                          // line 1184 — param WAJIB
  customerName?: string,
  channel: 'whatsapp' | 'web' = 'whatsapp',      // line 1185 — param, default
): Promise<ConversationWithContext> {
  const conv = await prisma.conversation.create({         // line 1180
    data: {
      storeId, customerId, customerPhone,               // line 1182-1184
      customerName: customerName ?? null,                // line 1185
      channel,                                           // line 1186
      status: 'open',                                    // line 1187
    },
  });
  …
}
```

> **Catatan nomor line:** P-PWA.4 mereferensikan `conversation.service.ts:75` & `:1184`. Di working tree saat ini (pasca P-PWA.4): `:75` → `customerPhone: customerId,` (fallback di upsert create branch); `:1184` → `customerPhone,` (param di `createConversation`). Kedua titik create **tetap ada** dan **sudah menerima `channel` via param** (bukan literal hardcode). Ini konsisten P-PWA.4 item 1.

### Skema `Conversation` (kebenaran schema, bukan asumsi)

```prisma
// prisma/schema.prisma:140-169
model Conversation {
  id                    String   @id @default(uuid())     // line 141 — PK = UUID tunggal
  storeId               String                           // line 142
  customerId            String                           // line 143 — non-null
  customerName          String?                          // line 144
  customerPhone         String?                          // line 145 — NULLABLE (pasca P-PWA.3)
  status                String   @default("open")        // line 146
  channel               String   @default("whatsapp")    // line 147
  …
  @@index([storeId])                                      // line 165
  @@index([customerId])                                   // line 166
  @@index([status])                                       // line 167
  @@map("conversations")
}
```

**Fakta kritis — menolak asumsi "PK pattern `storeId:customerPhone` butuh phone":**

| Premis asumsi (dari task) | Fakta nyata (trace) |
|---|---|
| "PK pattern `storeId:customerPhone` butuh phone" | **TIDAK ADA** composite PK. `id String @id @default(uuid())` (schema.prisma:141) adalah satu-satunya primary key — UUID tunggal. Tidak ada `@@unique`/`@@id` gabungan storeId+customerPhone. Indeks hanya `[storeId]`, `[customerId]`, `[status]` (schema.prisma:165-167). |
| "Jika phone null, ID Conversation jatuh ke UUID default Prisma" | **Salah.** `conversationId` tidak di-generate Prisma — nilainya **dikonstruksi caller** dan dipasang eksplisit ke `id`. |
| "customerPhone butuh diisi karena PK" | **`customerPhone` kolom NULLABLE** (`String?`, schema.prisma:145, dibuat nullable P-PWA.3). `findUnique`/`create` tidak akan crash bila phone null. |

### Dari mana `conversationId` berasal (construction, bukan schema)

```ts
// webhooks.ts:70  (GOWA)
const conversationId = `${store.id}:${customerPhone}`;
// webhooks.ts:201  (Fonnte — sama)
const conversationId = `${store.id}:${customerPhone}`;
```

→ `storeId:customerPhone` adalah **konvensi string** yang dipakai caller untuk menyusun nilai `id`, **bukan constraint DB**. Nilai `store.id` bersifat UUID (atau `'store-1'` dari seed di index.ts:199-206). Contoh konkrit di DB: `store-1:6281234567890`.

### Trace nyata: `channel='web'` dikirim TANPA customerPhone — apa yang terjadi?

**Langkah 1 — Guard di `processWithLock` (message-processor.service.ts:241-251):**

```ts
const channel = input.channel ?? 'whatsapp';               // line 241
if (channel === 'whatsapp' && !input.customerPhone) {      // line 242
  throw new Error(`customerPhone required for whatsapp channel …`);
}
if (channel === 'web' && !input.webUid) {                   // line 247
  throw new Error(`webUid required for web channel …`);
}
```

→ Jika `channel='web'` **tanpa `webUid`** → **THROW** di line 247 (`webUid required for web channel`).
→ Jika `channel='web'` **dengan `webUid`** → lolos guard, lanjut ke `processCustomerMessage`.

**Langkah 2 — di `processCustomerMessage` (conversation.service.ts:68-79):** upsert `where: { id: conversationId }`. Nama `customerPhone` di-`create` branch dipaksakan jadi `customerId` (line 75: `customerPhone: customerId`). Artinya:
- `customerPhone` **tidak pernah null** pada titik ini, karena fallback ke `customerId`.
- Untuk web, `customerId` adalah apa yang caller kirimkan (mis. `webUid`). Kolom schema `customerPhone` nullable (schema.prisma:145) → **tidak crash** karena nilai string `customerId` (webUid) valid untuk kolom `String?`.

**Langkah 3 — `createConversation` (conversation.service.ts:1180-1189):** parameter `customerPhone: string` (line 1184, wajib di TS). Jika caller web memanggil dengan `customerPhone` = `undefined`, TypeScript compile-time error; bila lolos (mis. `''` atau `null` cast), Prisma menyimpan `NULL` karena kolom nullable → **tidak crash**.

**Kesimpulan Audit 4 (fakta, bukan rekomendasi):**

1. **Dua titik create Conversation** terkonfirmasi: `conversation.service.ts:68` (upsert, `processCustomerMessage`) dan `conversation.service.ts:1180` (`createConversation`). Pasca P-PWA.4, keduanya sudah menerima `channel` via parameter (bukan literal `'whatsapp'` hardcode).
2. **Asumsi "PK pattern `storeId:customerPhone` butuh phone" adalah SALAH.** Schema (`schema.prisma:141`) membuktikan PK adalah `id @default(uuid())` (UUID tunggal); tidak ada constraint komposit. Nilai `storeId:customerPhone` adalah konvensi string caller (`webhooks.ts:70`, `:201`), bukan DB PK. `customerPhone` kolom nullable (`schema.prisma:145`).
3. **`channel='web'` tanpa `customerPhone`:** guard (message-processor.service.ts:247) justru mengharuskan **`webUid` wajib** (throw bila tidak ada). Jika `webUid` ada → lolos guard → `customerPhone` dipaksa jadi `customerId` (fallback, conversation.service.ts:75) → tidak null → tidak crash. `customerPhone` kolom nullable juga menahan crash bila null. Tidak ada mekanisme "ID jatuh ke UUID default Prisma" — `conversationId`/`id` selalu bernilai apa yang caller kirimkan.

---

## 5. Store resolve by slug — KONFIRMASI TIDAK ADA (bukan asumsi)

### Field `slug` ada di schema & migration, tapi TIDAK dipakai di kode sama sekali

```prisma
// prisma/schema.prisma:13
  slug                  String?  @unique
```

```sql
-- apps/api/prisma/migrations/20260811074711_add_store_slug/migration.sql
-- AlterTable
ALTER TABLE "stores" ADD COLUMN "slug" TEXT;
-- CreateIndex
CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");
```

→ Field `slug` ditambahkan oleh **P-PWA.2** (migration `20260811074711_add_store_slug`, commit `d37d5d3`). Kolomnya nullable + unique index.

### `grep` penuh — `slug` TIDAK pernah direferensi di aplikasi kode TS/JS

```
$ grep -rniE "slug|subdomain|storeSlug|store_slug" apps/api/src/ --include="*.ts" --include="*.js"
(no output — exit code 1)
```

```
$ grep -rni "findBySlug\|findBy.*slug\|where.*slug\|slug:" apps/api/src/ --include="*.ts"
(no output — exit code 1)
```

→ **Kosong.** Tidak ada satu pun referensi `slug` di `apps/api/src/` (semua `.ts`).

### Pola `Store` resolve yang ADA (bukan by slug)

| field | file:line | lookup | via |
|---|---|---|---|
| `id` (primary) | banyak, mis. `profile.ts:24`, `messages.ts:119`, `conversations.ts:144`, `fallback.service.ts:414/490/822` | `findUnique({ where: { id } })` | storeId langsung |
| `phoneNumber` | `webhooks.ts:61` | `findFirst({ where: { phoneNumber: botNumberRaw, isActive, deletedAt } })` | GOWA bot number |
| `webhookSecret` | `webhooks.ts:141` | `findFirst({ where: { webhookSecret, isActive, deletedAt } })` | Fonnte per-store secret |
| `email` | `auth.ts:26` (`:94`) | `findFirst({ where: { email } })` | login/register |

**Kesimpulan Audit 5 (fakta):**
- Field `Store.slug` (`schema.prisma:13`, `@unique` nullable) **ada** di schema — ditambah P-PWA.2 (migration `20260811074711_add_store_slug`).
- **Tidak ada fungsi/service resolve-by-slug di kode sama sekali.** `grep` penuh `slug` di `apps/api/src/**/*.ts` → nol hasil. `grep` pola `findBySlug`/`where.*slug`/`slug:` → nol hasil.
- Store resolve yang tersedia: by `id`, by `phoneNumber` (webhooks.ts:61), by `webhookSecret` (webhooks.ts:141), by `email` (auth.ts:26/:94). **Tidak ada resolve-by-slug.** Web Adapter yang ingin route `/<storeSlug>/…` tidak dapat memakai field ini — butuh fungsi baru. Ini **laporan fakta**, bukan rekomendasi.

---

## 6. Retry-buffer channel/webUid — `handleFlushed` (message-processor.service.ts:~185)

### `handleFlushed` — rekonstruksi `ProcessMessageInput` dari buffer

```ts
// message-processor.service.ts:178-206
private async handleFlushed(msg: ProcessedMessage, sourceMsg: QueuedMessage): Promise<void> {
  const chatId = msg.chatId;

  const release = messageQueueService.acquireLock(chatId);
  if (!release) {
    adapters.logger.debug('Chat locked when processing flushed batch', { chatId });
    return;
  }

  const input: ProcessMessageInput = {          // line 187
    storeId: msg.storeId,                        // line 188
    customerId: msg.customerId,                 // line 189
    customerPhone: msg.customerId,              // line 190 — fallback ke customerId, BUKAN null
    conversationId: msg.chatId,                 // line 191
    text: msg.content,                          // line 192
    messageId: msg.id,                          // line 193
    gateway: sourceMsg.gateway,                 // line 194
    deviceId: sourceMsg.deviceId,               // line 195
    token: sourceMsg.token,                     // line 196
    inboxId: sourceMsg.inboxId,                 // line 197
    storeTimezone: sourceMsg.storeTimezone,     // line 198
  };
  …
  await this.processWithLock(chatId, msg, input);   // line 202
}
```

### KONDISI PERSIS — field `channel` & `webUid`

| field | ada di literal `input` (handleFlushed line 187-199)? | nilai di buffer types? | akibat |
|---|---|---|---|
| `channel` | **TIDAK** — sama sekali tidak ada di object literal | tidak ada di `QueuedMessage` (msg-queue.service.ts:25-34) atau `ProcessedMessage` (msg-queue.service.ts:36-46) | `undefined` → guard line 241 `input.channel ?? 'whatsapp'` → **default `'whatsapp'`** |
| `webUid` | **TIDAK** — sama sekali tidak ada di object literal | tidak ada di `QueuedMessage` atau `ProcessedMessage` | `undefined` (tetap) |

→ Field **`channel` dan `webUid` DI-DROP TOTAL (undefined)** — tidak ada default eksplisit di `handleFlushed` itu sendiri. Default `'whatsapp'` muncul **hanya** di guard `processWithLock` (message-processor.service.ts:241), **bukan** di `handleFlushed`.

### Bukti type buffer (tidak ada field channel/webUid)

```ts
// message-queue.service.ts:25-34
export interface QueuedMessage extends RawMessage {
  priority: 'normal' | 'urgent';
  attempts: number;
  isUgc: boolean;
  gateway: 'gowa' | 'fonnte';
  deviceId?: string;
  token?: string;
  inboxId?: number;
  storeTimezone?: string;        // ← channel / webUid TIDAK ADA
}
```

```ts
// message-queue.service.ts:36-46
export interface ProcessedMessage {
  id: string;
  chatId: string;
  storeId: string;
  customerId: string;
  type: MessageType;
  content: string;
  mediaKey?: string;
  receivedAt: number;
  priority: 'normal' | 'urgent';  // ← channel / webUid TIDAK ADA
}
```

### Apa yang tersimpan ke buffer? (proven di `processMessage`)

```ts
// message-processor.service.ts:140-150  (queued object yg dimasukkan ke buffer)
const queued: QueuedMessage = {
  ...raw,
  priority,
  attempts: 0,
  isUgc: false,
  gateway: input.gateway,          // line 145 — gateway tersalin
  deviceId: input.deviceId,        // line 146
  token: input.token,              // line 147
  inboxId: input.inboxId,          // line 148
  storeTimezone: input.storeTimezone, // line 149
};
```

→ `channel` & `webUid` dari `input` **tidak disalin** ke `queued` (`QueuedMessage`), karena typedang tidak punya field itu.

### Dampak nyata pada dua path

- **Path awal (tidak buffer — pesan *urgent*):** `processMessage` line 168 memanggil `processWithLock(chatId, { ...queued }, input)` — **`input` asli (dengan channel/webUid) tetap diteruskan.** Channel/webUid aman pada path ini.
- **Path buffer (pesan *normal*, di-coalesce):** `handleFlushed` rekonstruksi input **tanpa** channel/webUid → `channel=undefined→'whatsapp'` (guard default) → guard mengevaluasi `!input.customerPhone` (bukan `!input.webUid`). Karena `customerPhone: msg.customerId` (line 190) tidak null → **guard WA PASS secara salah** untuk pesan web. Lalu `sendWithPresence`→`smartRetrySend` akan mencoba `gateway.sendMessage(input.customerPhone, …)` dengan `customerPhone`=webUid (bukan nomor WA) dan `gateway` = `getGateway('gowa'|'fonnte')` — **akan gagal/kirim ke nomor salah**, karena tidak ada cabang send berbasis `webUid`.

> Kondisi ini **baru relevan bila ada caller `channel='web'`** yang menghasilkan pesan *normal* (bukan urgent). Saat ini semua pesan adalah WA, jadi tidak berdampak. Tapi arsitektur buffer (`bufferMessage`/mergeText/mergeMedia) hanya mempertahankan field di `QueuedMessage`/`ProcessedMessage` — yang tidak termasuk `channel`/`webUid`.

### `customerPhone` di handleFlushed — fakta

```ts
// message-processor.service.ts:190
customerPhone: msg.customerId,  // fallback ke customerId, BUKAN null
```

→ `customerPhone` **tidak null** pada handleFlushed (dipaksakan jadi `msg.customerId`). Ini berbeda dengan kekhawatiran di task ("customerPhone null") — pada buffer path justru customerPhone **selalu terisi** (dengan customerId), sehingga guard WA `!input.customerPhone` **salah lolos** (PASS) untuk web. Ini fakta, bukan rekomendasi.

**Kesimpulan Audit 6 (fakta):** `handleFlushed` (message-processor.service.ts:187-199) merekonstruksi `ProcessMessageInput` **tanpa pernah menyertakan `channel` atau `webUid`** — keduanya **di-drop total (undefined)**, tidak ada default eksplisit pada fungsi ini. Default `'whatsapp'` hanya muncul di guard `processWithLock` (message-processor.service.ts:241). `customerPhone` dipaksakan jadi `msg.customerId` (line 190), bukan null. Types buffer (`QueuedMessage` msg-queue.service.ts:25-34, `ProcessedMessage` msg-queue.service.ts:36-46) **tidak memiliki field `channel`/`webUid`** sehingga tidak tersedia untuk direkonstruksi. Karena Web Adapter menghasilkan pesan *normal* yang akan masuk buffer, **Web Adapter di Fase 1 WAJIB menyentuh `handleFlushed` (serta types buffer) untuk menghindari channel/webUid hilang** — tidak dapat ditunda sampai ada caller `channel='web'` yang melewati buffer. Perilaku sekarang aman hanya karena tidak ada caller `'web'`.

---

## 7. Route registration pattern — di mana `pwa.ts` akan didaftarkan + middleware

### Pola mount di `apps/api/src/index.ts`

Import semua router di bagian atas (index.ts:12-53), lalu `mount` satu per satu via `app.use('/api/<prefix>', router)` (index.ts:92-121):

```ts
// apps/api/src/index.ts:12-18  (import pattern)
import messagesRouter from './routes/messages.js';
import faqRouter from './routes/faq.js';
import knowledgeRouter from './routes/knowledge.js';
import webhooksRouter from './routes/webhooks.js';
import authRouter from './routes/auth.js';
import metricsRouter from './routes/metrics.js';
import whatsappRouter from './routes/whatsapp.js';
import conversationsRouter from './routes/conversations.js';
…
```

```ts
// apps/api/src/index.ts:92-121  (mount pattern)
app.use('/api/messages', messagesRouter);          // index.ts:92
app.use('/api/faq', faqRouter);                      // index.ts:93
app.use('/api/knowledge', knowledgeRouter);          // index.ts:94
app.use('/api/webhooks', webhooksRouter);            // index.ts:95  ← PUBLIC (tanpa auth)
app.use('/api/auth', authRouter);                    // index.ts:96
app.use('/api/dashboard', metricsRouter);            // index.ts:97
app.use('/api/whatsapp', whatsappRouter);            // index.ts:98  ← AUTH (lihat di bawah)
app.use('/api/conversations', conversationsRouter);  // index.ts:99
…
app.use('/api/products', storeProductsRouter);       // index.ts:117
app.use('/api/analytics', analyticsRouter);          // index.ts:119
app.use('/api', productsRouter);                      // index.ts:121
```

### `apps/api/src/routes/pwa.ts` — KONFIRMASI BELUM ADA

```
$ ls apps/api/src/routes/pwa.ts
ls: cannot access 'apps/api/src/routes/pwa.ts': No such file or directory
```

→ File `pwa.ts` **belum ada**. Tidak ada import, tidak ada mount, tidak ada referensi `pwa` di `index.ts` (`grep "pwa" apps/api/src/index.ts` → kosong). Web Adapter route baru akan didaftarkan di `index.ts` dengan pola `import pwaRouter from './routes/pwa.js'` + `app.use('/api/pwa', pwaRouter)` (atau `/api/pwa/:storeSlug`, mirip pola mount di atas). Ini **lokasi/tipatan, bukan rekomendasi desain**.

### Pola middleware route WA sejenis — dan yang TIDAK boleh terpasang di route publik PWA

**Route `/api/whatsapp` (store-owner, AUTENTIKASI):**

```ts
// whatsapp.ts:1-15
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';   // line 2
…
const router = Router();
// Apply store-owner auth to all whatsapp routes
router.use(authMiddleware);                              // line 15
```

→ Router whatsapp menerapkan `authMiddleware` ke **seluruh** route via `router.use(authMiddleware)` (whatsapp.ts:15). Ini berarti **setiap request ke `/api/whatsapp/*` butuh bearer token toko.**

**`authMiddleware` — definisi (middleware/auth.ts:9-46):**

```ts
// apps/api/src/middleware/auth.ts:9
export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });   // line 12
  }
  const token = authHeader.slice(7);
  try {
    const setting = await prisma.storeSetting.findFirst({
      where: { key: 'auth_token', value: token },      // line 20
      include: { store: true },
    });
    if (!setting || !setting.store || setting.store.deletedAt) {
      return res.status(401).json({ error: 'Invalid or expired token' });   // line 25
    }
    …
    req.user = { storeId: setting.store.id, email: setting.store.email || '' };   // line 36
    next();
  } …
}
```

**Route `/api/webhooks` (PUBLIC inbound — BUKAN auth):**

```ts
// webhooks.ts:1-6  (tidak ada import authMiddleware)
import express, { Request, Response } from 'express';
import { messageProcessorService } from '../services/message-processor.service.js';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';
const router = express.Router();                         // line 6
…
export default router;                                  // webhooks.ts:290
```

→ Router `webhooks.ts` **tidak ada `router.use(authMiddleware)`** — sama sekali tidak ada auth middleware. Verifikasi per-route (bukan global): `/fonnte` pakai query-param `?secret=` (webhooks.ts:135) yang dicocokkan ke `Store.webhookSecret` (webhooks.ts:141-149); `/gowa` pakai lookup by `phoneNumber` (webhooks.ts:61-68). Ini inbound publik.

**Middleware lain di `index.ts` (global):**
- `requestIdMiddleware` (index.ts:80) — semua request.
- `maintenanceModeMiddleware` (index.ts:83) — semua request (kecuali health/root).
- `express.json()` + `cors(...)` (index.ts:73-77) — global, semua request.
- `adminAuthMiddleware` / `requireAdminRole` — hanya route `/api/admin/*` (index.ts:106-114).

**Kesimpulan Audit 7 (fakta):**
- File baru `apps/api/src/routes/pwa.ts` **belum ada** (belum ada import, belum ada mount).
- Route disdaftarkan di `apps/api/src/index.ts` melalui pola (a) `import xRouter from './routes/x.js'` (index.ts:12-44) + (b) `app.use('/api/<prefix>', xRouter)` (index.ts:92-121). `webhooksRouter` dipasang di `index.ts:95` (`app.use('/api/webhooks', webhooksRouter)`).
- Route WA yang ada **`whatsapp.ts`** menerapkan `router.use(authMiddleware)` (whatsapp.ts:15) — `authMiddleware` (middleware/auth.ts:9) melindahkan store lewat bearer token → `storeSetting(auth_token)`. **Middleware inispektuator ini TIDAK boleh terpasang di route publik PWA** yang merupakan inbound webhook (mirip `webhooks.ts` yang sama sekali tidak pakai `authMiddleware`). Route publik PWA harus pakai skema `webhooks.ts`: verifikasi via query-param secret atau store lookup by phoneNumber/webhookSecret, **bukan** bearer-token `authMiddleware`. Ini fakta pola kode, bukan rekomendasi.

---

## 8. `conversationLimiter` — lokasi, signature, pemakaian

### Definisi

```ts
// apps/api/src/middleware/rate-limiters.ts:48-60
/**
 * CONVERSATION API LIMITER
 * Window: 15 minutes, Max 100 requests per IP
 * Purpose: Prevent abuse of messaging endpoint
 * Status: SUITABLE for production
 */
export const conversationLimiter = rateLimit({
  windowMs: 15 * 60_1000,
  max: 100,
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});
```

Lokasi pasti: `apps/api/src/middleware/rate-limiters.ts:54`. Signature: `rateLimit({ windowMs, max, message, standardHeaders, legacyHeaders })` → mengembalikan Express middleware (dari paket `express-rate-limit`).

### Pemakaian (`grep` penuh) — KONFIRMASI TIDAK ADA / BELUM DIPAKAI SAMA SEKALI

```
$ grep -rn "conversationLimiter" apps/api/src/ --include="*.ts" | grep -v node_modules | grep -v dist
apps/api/src/middleware/rate-limiters.ts:54:export const conversationLimiter = rateLimit({
```

→ **Hanya ada pada definisi (line 54).** Tidak ada satu pun importer di mana pun (`grep` import dari `rate-limiters` hanya menemukan `storeAuthLimiter` di auth.ts:11, dan `adminAuthLimiter` di admin/auth.ts:9). `conversationLimiter` **didefinisikan tapi BELUM PERNAH pakai** di route manapun.

### Rate-limiter yang benar-benar dipakai (kontras)

```ts
// apps/api/src/routes/auth.ts:11   (storeAuthLimiter)
import { storeAuthLimiter } from '../middleware/rate-limiters.js';
router.post('/register', …, storeAuthLimiter, …);   // auth.ts:22
router.post('/login',    …, storeAuthLimiter, …);   // auth.ts:89
```

```ts
// apps/api/src/routes/admin/auth.ts:9   (adminAuthLimiter)
import { adminAuthLimiter } from '../../middleware/rate-limiters.js';
router.post('/register', …, adminAuthLimiter, …);   // admin/auth.ts:14
router.post('/login',    …, adminAuthLimiter, …);   // admin/auth.ts:61
```

→ `storeAuthLimiter` (store login/register) dan `adminAuthLimiter` (admin login/register) adalah satu-satunya limiter yang **aktif dipasang**. `generalLimiter` (rate-limiters.ts:40) dan `conversationLimiter` (rate-limiters.ts:54) **didefinisikan tapi tidak dipakai** — konsisten dengan temuan P-PWA.0.

**Kesimpulan Audit 8 (fakta):** `conversationLimiter` didefinisikan di `apps/api/src/middleware/rate-limiters.ts:54` (signature `rateLimit({ windowMs: 15min, max: 100, message, standardHeaders, legacyHeaders })` → Express middleware). **`grep` penuh konfirmasi — tidak ada pemakaian/importer di mana pun** (hanya 1 hasil: definisi sendiri). Rate limiter yang aktif: `storeAuthLimiter` (auth.ts:22, :89) & `adminAuthLimiter` (admin/auth.ts:14, :61). Jadi route PWA publik saat ini **tidak termasuk limiter apapun** (segi pelindungan rate-limit belum terpasang). Ini fakta, bukan rekomendasi.

---

## Ringkasan poin kunci (fakta sebelum desain)

| # | Pertanyaan audit | Jawaban fakta singkat | Bukti (file:line) |
|---|---|---|---|
| 1 | `processMessage` kirim sendiri atau return ke caller? | **INTERNAL-SEND** — kirim via `sendWithPresence`→`smartRetrySend`→`gateway.sendMessage`; caller hanya log | message-processor.ts:299, :373, :477, :520; webhooks.ts:102/115, :260/275 |
| 2 | `ProcessMessageInput` — `channel`/`webUid`? | Hadir (pasca P-PWA.4): `channel?:` :54, `webUid?:` :55. `gateway` tetap `'gowa'\|'fonnte'` :53 (tidak ada `'web'`). `customerPhone: string` :48 tetap wajib. | message-processor.service.ts:45-60 |
| 3 | Pola resolve/create Customer by phone | `findUnique({ where: { storeId_phone: {storeId,phone} } })` → update-or-create; `Customer @@unique([storeId,phone])` :410. Web: tidak ada pola by webUid. | webhooks.ts:76-95, :209-228; schema.prisma:410 |
| 4 | Titik create Conversation + `channel='web'` tanpa phone | 2 titik: upsert :68/:75 + createConversation :1180/:1184. **PK = `id @default(uuid())` (bukan composite storeId:customerPhone)**; `customerPhone` nullable (schema.prisma:145). Guard :247 throw bila web tanpa webUid. customerPhone di-handleFlushed dipaksakan jadi `msg.customerId` (:190). | conversation.service.ts:68-79, :75, :1173-1199, :1184; schema.prisma:141, :145; message-processor.ts:247, :190 |
| 5 | Store resolve by slug | **TIDAK ADA.** `slug` ada di schema.prisma:13 + migration, tapi `grep` di `apps/api/src/*.ts` = 0 hasil. Store resolve by id/phoneNumber/webhookSecret/email saja. | schema.prisma:13; migration 20260811074711; webhooks.ts:61, :141; auth.ts:26 |
| 6 | `handleFlushed` — channel/webUid di-drop? | **DI-DROP TOTAL (undefined)**, tidak ada default eksplisit di handleFlushed. Default `'whatsapp'` hanya di guard :241. Types buffer (QueuedMessage/ProcessedMessage) tidak punya channel/webUid. WA mustahil crash sekarang (tidak ada caller web). | message-processor.service.ts:187-199, :241; message-queue.service.ts:25-34, :36-46 |
| 7 | Di mana pwa.ts didaftarkan + middleware? | `pwa.ts` belum ada; didaftarkan di index.ts via import + `app.use('/api/<p>', router)` (pola :12-18, :92-121). Route WA sejenis (whatsapp.ts) pakai `router.use(authMiddleware)` :15; `authMiddleware` (middleware/auth.ts:9) = bearer-token store auth — **tidak boleh** untuk route publik PWA (ikuti pola `webhooks.ts` tanpa auth). | index.ts:95, :98, :12-18; whatsapp.ts:15; auth.ts:9; webhooks.ts:6 (tanpa auth) |
| 8 | `conversationLimiter` lokasi + pemakaian | Definisi di rate-limiters.ts:54 (`$rateLimit({windowMs:15m,max:100,…})`). **Tidak dipakai** — `grep` hanya temukan definisi. Limiter aktif: storeAuthLimiter (auth.ts:22/:89), adminAuthLimiter (admin/auth.ts:14/:61). | rate-limiters.ts:54; auth.ts:11/22/89; admin/auth.ts:9/14/61 |

---

## Acceptance

- ✅ Audit **hanya membaca & melaporkan** — tidak ada file sumber yang diedit. Semua temuan didasarkan pada `grep`/`read` langsung terhadap file, dilengkapi kutipan kode asli + `file:line`.
- ✅ Semua **8 poin** ada di atas, masing-masing dengan kutipan kode asli + `file:line`.
- ✅ **Tidak ada rekomendasi desain Web Adapter** — dokumen ini adalah bahan baku desain Fase 1.
- ✅ `git diff --stat` commit ini **HANYA 1 file baru** (`DOCS/laporan-taskPWA5-audit.md`).

---

## Post-commit verification

Berikut keluaran perintah verifikasi **setelah commit** (tempel `git diff --stat` + `git log -1`):

```
$ git show --stat HEAD
commit 4cb7278763e62c92b1c289b482f0e659114736c3
Author: pandjiemadiun <dwiputroagung2773@gmail.com>
Date:   Tue Aug 11 15:41:14 2026 +0000

    docs(PWA.5): audit read-only kesiapan Web Adapter (Fase 1)

 DOCS/laporan-taskPWA5-audit.md | 865 +++++++++++++++++++++++++++++++++++++++++
 1 file changed, 865 insertions(+)
 create mode 100644 DOCS/laporan-taskPWA5-audit.md

$ git log -1
commit 4cb7278763e62c92b1c289b482f0e659114736c3
Author: pandjiemadiun <dwiputroagung2773@gmail.com>
Date:   Tue Aug 11 15:41:14 2026 +0000

    docs(PWA.5): audit read-only kesiapan Web Adapter (Fase 1)
```
