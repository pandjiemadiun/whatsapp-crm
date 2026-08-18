# Laporan Audit Read-Only — TASK P-PWA.0 (Kesiapan PWA Web Chatbox)

**Mode:** HANYA baca & laporkan. Tidak ada file sumber yang diedit.
**Scope file yang disentuh:** hanya membuat file baru `DOCS/laporan-taskPWA0-audit.md`.
**Cabang:** `main`. Commit terpisah nanti dengan pesan `docs(PWA.0): audit read-only kesiapan PWA web chatbox`.

> Catatan metodologi: setiap temuan dilengkapi kutipan kode asli + `file:line` (bukan ringkasan/opini). Tidak ada rekomendasi desain (itulah bagian terpisah).

---

## 0. Pre-audit gate — `git status` mentah (WAJIB, langkah pertama)

Diperintahkan sebelum audit apa pun:

```
$ git status
On branch main
Your branch is ahead of 'origin/main' by 1 commit.
  (use "git push" to publish your commits)

nothing to commit, working tree clean
```

**Kesimpulan gate:** working tree **bersih** (tidak ada perubahan yang belum di-commit di luar apa yang akan ditulis untuk TASK ini). Audit dapat dilanjutkan. (RAILS.md §1.6 terpenuhi — tidak ada pekerjaan lain di atas working tree kotor.)

---

## 1. Kolom `slug` di model `Store` — grep penuh `schema.prisma`

Permintaan: grep penuh `schema.prisma` untuk field terkait routing per-toko (`slug`, `subdomain`, `storeSlug`, atau sejenis).

Perintah:
```
$ grep -rniE "slug|subdomain|storeSlug|store_slug" apps/api/prisma/schema.prisma
(no output — exit code 1)
```

**Hasil: `TIDAK ADA`.** Tidak ada kolom `slug`, `subdomain`, `storeSlug`, atau varian nama lainnya ada di `schema.prisma` secara keseluruhan — termasuk di model `Store`.

Model `Store` penuh (`apps/api/prisma/schema.prisma:10-52`):

```prisma
model Store {
  id                    String   @id @default(uuid())
  name                  String
  phoneNumber           String?
  profilePhotoUrl       String?
  description           String?
  businessCategory      String?
  address                String?
  email                 String?  @unique
  timezone              String   @default("Asia/Jakarta")
  operatingHours        Json?
  responseTemplate      String?
  whatsappPhoneId       String?
  fonnteToken           String?
  fonnteNumber          String?
  acceptsTransfer       Boolean  @default(false)
  acceptsQris           Boolean  @default(false)
  acceptsCod            Boolean  @default(false)
  qrisImageUrl          String?
  shippingMode          String   @default("pickup")  // "pickup" | "flat"
  shippingFlatInCity    Float?
  shippingFlatOutCity   Float?
  webhookSecret         String?  @unique
  config                Json?
  isActive              Boolean  @default(true)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  deletedAt             DateTime?

  conversations         Conversation[]
  faqs                  FAQ[]
  knowledge             Knowledge[]
  orders                Order[]
  settings              StoreSetting[]
  productCategories     ProductCategory[]
  products              Product[]
magicPasteRuns        MagicPasteRun[]
  bankAccounts          BankAccount[]
  sops                  Sop[]
  customers             Customer[]

  @@map("stores")
}
```

> Relevansi: blueprint `04_PWA_BLUEPRINT.md:12` justru merencakan pemodelan URL per-toko `qlobot.web.id/c/<slug>` serta endpoint `/api/pwa/:storeSlug/...` (`04_PWA_BLUEPRINT.md:30-32`). Namun tiada kolom `slug`/`storeSlug` di `Store` yang dapat menjadi kunci publik perpindahan kepemilikan toko. Ini adalah gap data, bukan keputusan desain.

---

## 2. Trace pipeline AI end-to-end (webhooks → message-processor → conversation.service)

Rantai pemanggilan yang dipetakan:

**a. Titik masuk utama pemrosesan pesan — `MessageProcessorService.processMessage`**
`apps/api/src/services/message-processor.service.ts:94`

```ts
async processMessage(input: ProcessMessageInput): Promise<ProcessedResult | null> {
```

Interface inputnya (`apps/api/src/services/message-processor.service.ts:45-58`):

```ts
export interface ProcessMessageInput {
  storeId: string;
  customerId: string;
  customerPhone: string;
  customerName?: string;
  conversationId: string;
  text: string;
  messageId: string;
  gateway: 'gowa' | 'fonnte';
  deviceId?: string;
  token?: string;
  inboxId?: number;
  storeTimezone?: string;
}
```

Dipanggil dari `webhooks.ts` pada dua titik:
- GOWA — `apps/api/src/routes/webhooks.ts:102-112`
- Fonnte — `apps/api/src/routes/webhooks.ts:260-271`

```ts
// webhooks.ts:102-112 (GOWA)
const result = await messageProcessorService.processMessage({
  storeId: store.id,
  customerId: customerPhone,
  customerPhone,
  conversationId,
  text,
  messageId,
  gateway: 'gowa',
  deviceId,
  storeTimezone: store.timezone,
});

// webhooks.ts:260-271 (Fonnte)
const result = await messageProcessorService.processMessage({
  storeId: store.id,
  customerId: customerPhone,
  customerPhone,
  conversationId,
  text,
  messageId,
  gateway: 'fonnte',
  token: store.fonnteToken,
  inboxId: inboxId ? Number(inboxId) : undefined,
  storeTimezone: store.timezone,
});
```

**b. `processMessage` menyiapkan `raw` lalu menurunkan ke `conversationService.processCustomerMessage`**
`apps/api/src/services/message-processor.service.ts:237-243`

```ts
result = await this.llmCircuitBreaker.wrap(() =>
  conversationService.processCustomerMessage(
    input.storeId,
    input.customerId,
    input.conversationId,
    msg.content
  )
);
```

**c. Titik masuk di `ConversationService`**
`apps/api/src/business/conversation.service.ts:59-64`

```ts
async processCustomerMessage(
  storeId: string,
  customerId: string,
  conversationId: string,
  customerMessage: string
): Promise<ResponseResult | null> {
```

**d. Analisis: channel-agnostic vs terikat WhatsApp**

`processMessage` secara *signatures* menerima `storeId` + `conversationId` + `text` + `customerId` (dan `customerName?`) yang berupa data umum, **tetapi**:

- `customerId` **selalu di-set sama dengan `customerPhone`** (nomor WA) pada kedua webhook: `webhooks.ts:104` (GOWA) dan `webhooks.ts:262` (Fonnte). Di dalam layanan, `customerId` juga dipaksa jadi `customerPhone` pada flush handler — `message-processor.service.ts:186-188`:
  ```ts
  customerId: msg.customerId,
  customerPhone: msg.customerId,   // apps/api/src/services/message-processor.service.ts:188
  conversationId: msg.chatId,
  ```
- `gateway` hanyalah union sempit `'gowa' | 'fonnte'` (`message-processor.service.ts:53`) — **tidak ada anggota `'web'`**. Seluruh jalur *reply* bersifat WA-only melalui `getGateway`:
  `apps/api/src/services/message-processor.service.ts:500-502`
  ```ts
  private getGateway(gateway: 'gowa' | 'fonnte'): IWhatsAppGateway | null {
    return gateway === 'gowa' ? gowaAdapter : fonnteService;
  }
  ```
- `sendWithPresence` (`message-processor.service.ts:303-354`) dan `smartRetrySend` (`message-processor.service.ts:443-480`) mengirim balasan ke `input.customerPhone` via gateway WA (`gowaAdapter` / `fonnteService`).
- Field khusus WA lain: `deviceId` (GOWA device, `webhooks.ts:52`; `message-processor.service.ts:54`), `token`/`inboxId` (Fonnte, `webhooks.ts:269`; `message-processor.service.ts:55-56`).

**Kesimpulan (temuan, bukan rekomendasi):** *Entry `processMessage` agak abstrak, tetapi `customerId` selalu berupa nomor WA, `gateway` terikat enum WA, dan jalur balasan (send/presence/retry) sepenuhnya menargetkan nomor WA lewat `gowaAdapter`/`fonnteService`. Web PWA yang tidak memiliki nomor WA tidak dapat memproses balasan melalui jalur ini tanpa adaptasi terhadap `customerId`/`customerPhone`/`gateway`.*

---

## 3. Model `Conversation` — field `channel` & identitas customer WA-specific

Model `Conversation` (`apps/api/prisma/schema.prisma:139-168`):

```prisma
model Conversation {
  id                    String   @id @default(uuid())
  storeId               String
  customerId            String
  customerName          String?
  customerPhone         String              // <-- WAJIB (non-null), WA-specific
  status                String   @default("open")
  channel               String   @default("whatsapp")   // <-- terkonfirmasi ada (schema.prisma:146)
  lastMessageAt         DateTime?
  aiResponseCount       Int      @default(0)
  faqResponseCount      Int      @default(0)
  humanTakeoverAt       DateTime?
  humanAgentId          String?
  resolvedAt            DateTime?
  notes                 String?
  metadata              Json?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  deletedAt             DateTime?

  store                 Store    @relation(fields: [storeId], references: [id])
  history               ConversationHistory[]
  context               ConversationContext?
  orders                Order[]

  @@index([storeId])
  @@index([customerId])
  @@index([status])
  @@map("conversations")
}
```

Ringkasan kolom kunci + status null-ability:

| Kolom | `schema.prisma` | Nullable? | Nilai default |
|---|---|---|---|
| `channel` | baris 146 | ya (`String`) | `"whatsapp"` |
| `customerPhone` | baris 144 | **tidak** (`String`, non-null) | — |
| `customerId` | baris 142 | **tidak** (`String`, non-null) | — |
| `customerName` | baris 143 | ya (`String?`) | — |

- `channel` (@default `"whatsapp"`) **sudah ada** (`schema.prisma:146`), bertipe `String` (bukan enum). Nilainya di-*hardcode* pada create di service.
- `customerPhone` adalah **WA-specific & wajib non-null** (`schema.prisma:144`). Di `conversation.service.ts:74` nilainya dipaksakan sama dengan `customerId` (yang selalu nomor WA):
  ```ts
  create: {
    id: conversationId,
    storeId: storeId,
    customerId: customerId,
    customerPhone: customerId, // Fallback nilai phone dengan customerId   <-- conversation.service.ts:74
    channel: 'whatsapp',        //                                  <-- conversation.service.ts:75
    status: 'open',
  },
  ```
- Model `Customer` (`apps/api/prisma/schema.prisma:393-411`) juga WA-bound: `phone String` wajib non-null + `@@unique([storeId, phone])` (`schema.prisma:396,408`). Webhook WA upsert Customer dengan `phone: customerPhone` (GOWA `webhooks.ts:91`; Fonnte `webhooks.ts:223`).

**Blocker terkonfirmasi:** customer dari Web PWA tidak memiliki nomor WA, tetapi kolom `Conversation.customerPhone` (non-null), `Conversation.customerId` (non-null, = WA phone), dan `Customer.phone` (non-null) semuanya **menuntut nomor WA**. Selain itu `channel` di-hardcode `'whatsapp'` di `conversation.service.ts:75` (tidak ada jalur `'web'`). Perhatikan pula `blueprint 04_PWA_BLUEPRINT.md:19-21` yang menyatakan niat "tambah field `channel` ('WHATSAPP'|'WEB')" dan **jangan** menimpah field `source` — artinya `source` (sumber balasan AI/FAQ/SOP) adalah kolom terpisah yang ada di `ConversationHistory.source` (`schema.prisma:176`, `String?`), dan `channel` adalah level Conversation.

---

## 4. Cek folder `apps/pwa`

Diperintahkan `ls`:
```
$ ls -la apps/pwa
ls: cannot access 'apps/pwa': No such file or directory
```

Isi `apps/`:
```
apps/
  api/       (root: 10 diresor dir, Jul 31)
  dashboard/ (Jul 8 05:31)
```

**Konfirmasi:** `apps/pwa` **belum ada**. Konsisten dengan rencana `04_PWA_BLUEPRINT.md:16` ("React 19 + Vite (apps/pwa, terpisah dari dashboard)").

---

## 5. Route registration — cara `routes/*.ts` didaftarkan ke Express app

Entri aplikasi: `apps/api/src/index.ts`. Semua router di-`import` di bagian atas (`index.ts:12-44`) kemudian di-`mount` dengan `app.use('/api/<prefix>', router)` (`index.ts:92-121`). Contoh pendaftaran:

```ts
// apps/api/src/index.ts:12-15 (import)
import messagesRouter from './routes/messages.js';
import webhooksRouter from './routes/webhooks.js';
import authRouter from './routes/auth.js';
...
// apps/api/src/index.ts:92-121 (mount)
app.use('/api/messages', messagesRouter);      // index.ts:92
app.use('/api/faq', faqRouter);                // index.ts:93
app.use('/api/knowledge', knowledgeRouter);    // index.ts:94
app.use('/api/webhooks', webhooksRouter);      // index.ts:95
app.use('/api/auth', authRouter);              // index.ts:96
app.use('/api/dashboard', metricsRouter);      // index.ts:97
app.use('/api/whatsapp', whatsappRouter);      // index.ts:98
app.use('/api/conversations', conversationsRouter); // index.ts:99
app.use('/api/orders', ordersRouter);          // index.ts:100
app.use('/api/settings', settingsRouter);      // index.ts:101
app.use('/api/profile', profileRouter);        // index.ts:102
app.use('/api/bank-accounts', bankAccountsRouter); // index.ts:103
app.use('/api/sop', sopRouter);                // index.ts:104
...admin routes (dengan guard)...
app.use('/api/products', storeProductsRouter); // index.ts:117
app.use('/api/analytics', analyticsRouter);    // index.ts:119
app.use('/api', productsRouter);               // index.ts:121
```

Tidak ada mount di bawah `/api/pwa` saat ini. Pola yang harus diikuti untuk menambahkan `apps/api/src/routes/pwa.ts`:
```ts
import pwaRouter from './routes/pwa.js';          // import (serupa index.ts:12-44)
app.use('/api/pwa', pwaRouter);                   // mount (serupa index.ts:92-121)
```
Karena blueprint pakai prefix `:storeSlug` (`04_PWA_BLUEPRINT.md:30-32`), opsi mount yang selaras: `app.use('/api/pwa/:storeSlug', pwaRouter)` atau biarkan router mendaftarkan `/:storeSlug/init` dst. — ini catatan lokasi/tipapan, **bukan rekomendasi desain**.

---

## 6. Skema `conversationId` — cara generate & mekanisme untuk WA

Di kode, `conversationId` **di-generate di aplikasi** (bukan di-DB default), memakai pola string template:

```ts
// GOWA — apps/api/src/routes/webhooks.ts:70
const conversationId = `${store.id}:${customerPhone}`;
// Fonnte — apps/api/src/routes/webhooks.ts:200
const conversationId = `${store.id}:${customerPhone}`;
```

`conversationId` ini dipakai **sebagai Primary Key `Conversation.id`** — bukan kolom terpisah:

```ts
// apps/api/src/business/conversation.service.ts:67-78
const conversation = await prisma.conversation.upsert({
  where: { id: conversationId },       // <-- conversation.service.ts:68
  update: {},
  create: {
    id: conversationId,               // <-- conversation.service.ts:71
    storeId: storeId,
    customerId: customerId,
    customerPhone: customerId,
    channel: 'whatsapp',
    status: 'open',
  },
});
```

Schema `Conversation` (`apps/api/prisma/schema.prisma:139-168`): `id String @id @default(uuid())` — `@id` ialah satu-satunya constraint unique/PK; **tidak ada `@@unique` tambahan** di luar indeks `[storeId]/[customerId]/[status]` (`schema.prisma:164-166`). Jadi komposisi `store.id:customerPhone` disimpan langsung ke kolom `id`.

**Perbandingan dengan blueprint:** `04_PWA_BLUEPRINT.md:26` menyebutkan pola `conversationId existing (store:<nomor>)`. Implementasi sebenarnya **berbeda** — polanya adalah `<storeId_uuid>:<customerPhone>` (bukan `store:<nomor>`). `storeId` bersifat UUID (atau `'store-1'` pada seed), bukan literal string `"store"`.

**Contoh nilai nyata (dari kode + seed):**
- Store seed: `apps/api/src/index.ts:199,202` → `id: 'store-1'`, `apps/api/src/index.ts:204` → `phoneNumber: '+6281234567890'`.
- `customerPhone` dinormalisasi ke `62xxx` oleh `normalizePhoneNumber` (di `webhooks.ts:12-18`) dan/atau `normalizePhone` (`apps/api/src/lib/normalize-phone.ts:5-28`).
- Maka contoh `conversationId` yang terjadi di DB: `store-1:6281234567890` (atau `<uuid-toko>:6281234567890` untuk toko non-seed).
- Pemetaan `uid -> conversationId` memakai `customerPhone` (nomor WA) sebagai `customerId` (`webhooks.ts:104,262`; `conversation.service.ts:73`).

**Migrasi/seed SQL:** tidak ada migration yang *generate* `conversationId`; seluruh nilai disusun di aplikasi (`webhooks.ts`). (Catatan: `apps/api/prisma/schema.prisma.backup:70` mencatat `conversationId String @db.Uuid @unique` — ini skema **lama/backup**, tidak aktif.)

---

## 7. Field `Store` yang relekan untuk endpoint publik `/init`

`Store` penuh (`apps/api/prisma/schema.prisma:10-52`) — kolom yang **bisa dipakai langsung** sebagai "data publik toko" tanpa menambah kolom baru:

| Kolom | `schema.prisma` | Cocok publik? | Keterangan |
|---|---|---|---|
| `name` | :12 | ✅ | Nama toko (wajib) |
| `profilePhotoUrl` | :14 | ✅ | Logo/foto profil |
| `description` | :15 | ✅ | Deskripsi |
| `businessCategory` | :16 | ✅ | Kategori usaha |
| `address` | :17 | ✅ | Alamat |
| `timezone` | :19 | ✅ | Zona waktu (default Asia/Jakarta) |
| `operatingHours` | :20 | ✅ | Jam operasional (JSON) |
| `responseTemplate` | :21 | ⚠️ | Template balasan (bisa publik bila memang ditunjukkan) |
| `acceptsQris` | :26 | ✅ | Menerima QRIS (bool) |
| `acceptsCod` | :27 | ✅ | Menerima COD (bool) |
| `acceptsTransfer` | :25 | ✅ | Menerima transfer (bool) |
| `qrisImageUrl` | :28 | ✅ | Gambar QRIS |
| `shippingMode` | :29 | ✅ | pickup/flat |
| `shippingFlatInCity` | :30 | ✅ | Ongkir antar kota |
| `shippingFlatOutCity` | :31 | ✅ | Ongkir luar kota |
| `isActive` | :34 | ✅ | Status aktif (bool) |
| `config` | :33 | ⚠️ | JSON fleksibel (mis. `fonnteMediaEnabled`) — filter field sensitif |
| `createdAt` / `updatedAt` | :35-36 | ✅ | Timestamp |

Kolom yang **tidak cocok** disajikan ke publik (mengandung kunci/rahasia operasional WA):
- `phoneNumber` (:13) — nomor WA bot
- `whatsappPhoneId` (:22), `fonnteToken` (:23), `fonnteNumber` (:24)
- `webhookSecret` (:32, `@unique`, rahasia)
- `email` (:18) — pribadi/operasional

> Dukungan PWA untuk `/init` dapat memanfaatkan kolom publik di atas (terutama `name`, `profilePhotoUrl`, `description`, `isActive`, `acceptsQris`, `qrisImageUrl`). Namun, karena **tidak ada kolom `slug`/`storeSlug`** (poin 1), endpoint berbasis `/:storeSlug` belum dapat didukung oleh data toko yang ada — butuh kolom slug baru.

---

## 8. Monorepo build pattern — root `package.json` & setup dashboard

**Root repository tidak memiliki `package.json`:**
```
$ ls package.json tsconfig.json
ls: cannot access 'package.json': No such file or directory
ls: cannot access 'package.json': No such file or directory
```
Satu-satunya manifest root adalah `package-lock.json` (85 byte) yang berisi:
```json
{
  "name": "garuda",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {}
}
```
→ **`"packages": {}`** berarti **tidak ada `workspaces`** (bukan npm/pnpm-workspaces/Turborepo monorepo). Setiap aplikasi mandiri dengan manifesnya sendiri. Tidak ada skrip root untuk orkestrasi build.

**PM2 process manager** (`ecosystem.config.js`):
```js
// apps/api → production, port 3000
{ name: 'api', cwd: '/home/ubuntu/garuda/apps/api', script: 'dist/index.js', env: { NODE_ENV: 'production', PORT: 3000, TZ: 'Asia/Jakarta' } }
// apps/dashboard → vite preview, port 8080
{ name: 'dashboard', cwd: '/home/ubuntu/garuda/apps/dashboard', script: 'node_modules/.bin/vite', args: 'preview --host --port 8080', env: { NODE_ENV: 'production' } }
```

**`apps/api/package.json`** — ESM (`"type": "module"`, `"main": "src/index.ts"`):
- `dev`: `NODE_ENV=development tsx watch src/index.ts`
- `build`: `tsc`
- `start`: `node dist/index.js`
- Dependensi relevan: `express ^4.18.2`, `cors ^2.8.5`, `express-rate-limit ^8.6.1`, `@prisma/client`, `bullmq`, `ioredis`, `zod`, `winston`, `sharp`, `cloudinary`.

**`apps/dashboard/package.json`** — ESM:
- `dev`: `vite`
- `build`: `tsc -b && vite build`
- `preview`: `vite preview`
- Stack: React 19, Vite 8, Tailwind v4, oxlint, TypeScript ~6.0.2, React Router DOM 7, Playwright.

**`apps/dashboard/vite.config.ts`** (`apps/dashboard/vite.config.ts:1-13`):
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    allowedHosts: ['qlobot.web.id', 'api.qlobot.web.id'],
  },
})
```

**Referensi konsistensi untuk `apps/pwa` nanti:** ikuti pola `apps/dashboard` (Vite + React + Tailwind v4; skrip `dev`/`build`/`preview`), terlepas dari `apps/api` yang pakai `tsx`/`tsc`. `vite.config.ts:10-12` sudah meregistrasikan origin produksi `qlobot.web.id` & `api.qlobot.web.id` di `allowedHosts` preview.

---

## 9. CORS

Middleware CORS ada di `apps/api/src/index.ts:5` (import) dan `apps/api/src/index.ts:72-77` (pakai):

```ts
// apps/api/src/index.ts:72-77
// Middleware JSON & CORS
app.use(express.json());
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:4173'],
  credentials: true,
}));
```

**Whitelist origin hanya:** `http://localhost:5173` (Vite dev) dan `http://localhost:4173` (vite preview/build). **Tidak ada** origin produksi `https://qlobot.web.id` / `https://api.qlobot.web.id`, dan **tidak ada konfigurasi dinamis via env**.

**Implikasi:** PWA yang di-deploy di origin `qlobot.web.id` (atau subdomain) melakukan cross-origin request ke API — saat ini **akan ditolak** oleh CORS kecuali origin produksi ditambahkan ke whitelist `origin` di `index.ts:74`. (Hanya untuk kebutuahan; bukan rekomendasi desain.)

---

## 10. Pola auth webhook WA — `/gowa` vs `/fonnte` (verifikasi sebelum `processMessage`)

Definisi router: `apps/api/src/routes/webhooks.ts` (seluruh file 289 baris; `export default router` di `webhooks.ts:288`).

**`POST /api/webhooks/fonnte` — ADA verifikasi secret SEBELUM `processMessage`** (`webhooks.ts:129-148`):
```ts
// apps/api/src/routes/webhooks.ts:130-148
// --- Webhook secret validation (per-store) ---
const webhookSecret = req.query.secret as string | undefined;          // webhooks.ts:134
if (!webhookSecret) {
  adapters.logger.warn('Webhook request missing secret');
  return res.status(401).json({ error: 'Webhook secret is required' });  // webhooks.ts:137
}

const store = await prisma.store.findFirst({
  where: { webhookSecret, isActive: true, deletedAt: null },            // webhooks.ts:140-141
  select: { id: true, fonnteNumber: true, fonnteToken: true, timezone: true },
});

if (!store) {
  adapters.logger.warn('Webhook request invalid secret');
  return res.status(401).json({ error: 'Invalid webhook secret' });     // webhooks.ts:147
}
```
Secret tersimpan di kolom `Store.webhookSecret` (`schema.prisma:32`, `@unique`) dan dikirimkan sebagai query param `?secret=...` oleh merchant di dashboard Fonnte. **Tidak ada** verifikasi HMAC/SHA256 signature — hanya pencocokan nilai secret ke DB.

**`POST /api/webhooks/gowa` — TIDAK ADA verifikasi secret/HMAC** (`webhooks.ts:20-126`). Handler langsung `res.status(200)` di `webhooks.ts:23`, lalu:
- identifikasi store lewat **nomor WA bot** (`phoneNumber`) yang terbaca dari `body.device_id` — `webhooks.ts:52-63`:
  ```ts
  // apps/api/src/routes/webhooks.ts:51-63
  // Bot number comes from device_id
  const deviceId: string = body.device_id || '';
  const botNumberRaw = deviceId.replace(/@.*$/, '');
  ...
  const store = await prisma.store.findFirst({
    where: { phoneNumber: botNumberRaw, isActive: true, deletedAt: null },
  });
  ```
- **Tidak ada** pemeriksaan `webhookSecret`/HMAC untuk GOWA.

Kesimpulan perbandingan: Fonnte memakai `Store.webhookSecret` query-param (validasi ke-DB, bukan HMAC) sebelum `processMessage` (`webhooks.ts:134-148` → call di `webhooks.ts:260`); GOWA tidak diverifikasi sama sekali, hanya mengenali store dari nomor bot di payload. Kedua pola ini **eksklusif WA** — endpoint PWA publik nanti tidak punya (dan tidak butuh) webhook secret; ini hanya referensi perbandingan pola.

---

## 11. Rate limiting middleware — keberadaan & tempat pakai

Definisi ada di `apps/api/src/middleware/rate-limiters.ts` (pakai `express-rate-limit ^8.6.1`, `rate-limiters.ts:1`):

```ts
// apps/api/src/middleware/rate-limiters.ts
export const adminAuthLimiter = rateLimit({              // rate-limiters.ts:10
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

export const storeAuthLimiter = rateLimit({              // rate-limiters.ts:25
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Terlalu banyak percobaan, coba lagi dalam beberapa menit' },
  ...
});

export const generalLimiter = rateLimit({               // rate-limiters.ts:40
  windowMs: 15 * 60 * 1000,
  max: 1000,                                            // 1000 req/15m per IP
  ...
});

export const conversationLimiter = rateLimit({          // rate-limiters.ts:54
  windowMs: 15 * 60 * 1000,
  max: 100,                                              // 100 req/15m per IP
  ...
});
```

**Penggunaan (grep import `rate-limiters` di `apps/api/src`):** hanya **2** file yang mengimpor —

```
apps/api/src/routes/auth.ts:11        → storeAuthLimiter   (dipakai di auth.ts:22 /register, auth.ts:89 /login)
apps/api/src/routes/admin/auth.ts:9   → adminAuthLimiter   (dipakai di admin/auth.ts:14 /register, admin/auth.ts:61 /login)
```

`generalLimiter` dan `conversationLimiter` **didefinisikan tetapi TIDAK PERNAH dipasang** — tidak ada `app.use(generalLimiter)` maupun `app.use(conversationLimiter)` di `index.ts`, dan tidak ada `router.use(...)` limiters tambahan di route lainnya:

```
$ grep -rnE "app.use\((generalLimiter|conversationLimiter)" apps/api/src
(no output — tidak ada)
```

Juga tidak ada limiter global yang diterapkan ke seluruh rute. **Kesimpulan:** belum ada rate limiting global; hanya endpoint auth login/register yang dilindungi (`storeAuthLimiter`/`adminAuthLimiter`). Untuk `POST /api/pwa/:storeSlug/message` nanti perlu mendaftarkan limiter secara eksplisit (mis. `conversationLimiter`) — ini catatan lokasi, **bukan rekomendasi**.

---

## Lampiran A — Ringkasan fakta kunci (tanpa opini)

- `schema.prisma:146` — `channel String @default("whatsapp")` (ada, tipe String, hardcode `'whatsapp'` di `conversation.service.ts:75`).
- `schema.prisma:144` — `customerPhone String` (WA-specific, **non-null**) → blocker Web.
- `schema.prisma:396,408` — `Customer.phone String` (non-null, `@@unique([storeId, phone])`) → blocker Web.
- `Store` — **tidak ada kolom `slug`/`subdomain`/`storeSlug`** (`schema.prisma:10-52`; grep exit 1).
- `conversationId` generate: `` `${store.id}:${customerPhone}` `` (`webhooks.ts:70,200`); dipakai sebagai PK `Conversation.id` (`conversation.service.ts:67-78`); pola berbeda dari blueprint `store:<nomor>` (`04_PWA_BLUEPRINT.md:26`).
- `processMessage` entry: `message-processor.service.ts:94`; memanggil `conversationService.processCustomerMessage(...)` (`message-processor.service.ts:237-243`; `conversation.service.ts:59-64`). `gateway` enum WA-only (`message-processor.service.ts:53`); balasan WA-only via `gowaAdapter`/`fonnteService` (`message-processor.service.ts:500-502`).
- CORS: `index.ts:74` — hanya localhost:5173/4173; `qlobot.web.id` belum di-whitelist (`index.ts:72-77`).
- Rate limiter: terdefinisi di `rate-limiters.ts` (4 limiter); hanya `storeAuthLimiter`/`adminAuthLimiter` dipakai (auth routes); `generalLimiter`/`conversationLimiter` tidak terpasang.
- `apps/pwa` — **tidak ada** (`apps/` hanya berisi `api/` dan `dashboard/`).
- Root — **tidak ada `package.json`/workspaces**; hanya `package-lock.json` (`packages: {}`); deploy via PM2 (`ecosystem.config.js`): api:3000, dashboard:8080.
- Auth webhook: Fonnte diverifikasi via `Store.webhookSecret` query param sebelum `processMessage` (`webhooks.ts:134-148`); GOWA tidak diverifikasi (`webhooks.ts:20-63`).

## Lampiran B — Bukti scope tidak melebar (`git diff --stat` + `git log -1`)

`git diff --stat` (dengan `HEAD~1` — diff perubahan yang dibawa commit baru vs
parent-nya) **hanya menampilkan 1 file baru**, tidak ada file sumber yang
terdifikasi:

```
$ git diff --stat HEAD~1
 DOCS/laporan-taskPWA0-audit.md | 644 +++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 644 insertions(+)
```

`git log -1` — satu commit terpisah dengan pesan yang ditentukan:

```
$ git log -1
commit 87858dd84ffa7d23e780319f3f367459106e262e
Author: pandjiemadiun <dwiputroagung2773@gmail.com>
Date:   Tue Aug 11 05:46:06 2026 +0000

    docs(PWA.0): audit read-only kesiapan PWA web chatbox
```

`git status` pasca-commit (working tree bersih; tidak ada file sumber yang
tersentuh):

```
$ git status
On branch main
Your branch is ahead of 'origin/main' by 2 commits.
  (use "git push" to publish your commits)

nothing to commit, working tree clean
```

> Catatan teknis: bukti di atas (`git diff --stat` = 1 file; `git log -1` =
> pesan `docs(PWA.0)`; `git status` bersih) dicapture pada verifikasi commit
> sebelum bagian bukti ini diselipkan ke dalam laporan. Karena laporan ini
> **sendiri** berisi output `git log -1`-nya, nilai hash commit akan berubah
> seiknanya satu kali lagi setelah `commit --amend` memasukkan bukti ini.
> Hal ini tidak berubah: pesan commit, author, Date (author), dan satu-satunya
> berkas yang ditambahkan (`DOCS/laporan-taskPWA0-audit.md`) tidak berubah;
> bukti "1 file, tidak ada source tersentuh" tetap berlaku pada commit final.
