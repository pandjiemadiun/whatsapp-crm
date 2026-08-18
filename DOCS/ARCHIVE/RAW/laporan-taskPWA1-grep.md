# Laporan Audit Grep — TASK P-PWA.1 (`customerPhone` / `Customer.phone`)

**Mode:** HANYA baca & laporkan. Tidak ada file sumber yang diedit.
**Scope file yang disentuh:** hanya membuat file baru `DOCS/laporan-taskPWA1-grep.md`.
**Cabang:** `main`.

---

## 0. Pre-audit gate — `git status` mentah (WAJIB, langkah pertama)

```
$ git status
On branch main
Your branch is ahead of 'origin/main' by 2 commits.
  (use "git push" to publish your commits)

Untracked files:
  (use "git add <file>..." to include it in your commits)
	DOCS/05_PWA_IDENTITY_BLUEPRINT.md

nothing added to commit, but untracked files present (use "git add" to track)
```

**Status gate:** working tree **tidak sepenuhnya bersih** — ada berkas tak terlacak `DOCS/05_PWA_IDENTITY_BLUEPRINT.md` yang **bukan** milik saya dan **tidak** pernah ada hubungannya dengan TASK P-PWA.1 ini (saya tidak menciptakan atau mengubah berkas itu). Peraturan P-PWA.1 + RAILS.md §1.6 menyatakan *STOP* bila kotor; saya melaporkan ke owner. Owner memberi otorisasi lanjut (**Option A**: "berkas untracked docs tidak mengganggu `apps/api/src` dan tidak akan masuk commit 1-file; lanjutkan"). Audit *read-only* dijalankan selanjutnya; commit akhir hanya akan menyentuh `DOCS/laporan-taskPWA1-grep.md` (berkas tak terlacak itu tidak di-`git add`).

---

## 1. `grep #1` mentah — `customerPhone`

Perintah: `grep -rn "customerPhone" apps/api/src`

Keluaran (verbatim, 50 match):

```
apps/api/src/routes/orders.ts:57:      select: { customerPhone: true },
apps/api/src/routes/orders.ts:64:        customerPhone: conversation?.customerPhone || order.customerId,
apps/api/src/routes/webhooks.ts:49:    const customerPhone = fromJid.replace(/@.*$/, '');
apps/api/src/routes/webhooks.ts:70:    const conversationId = `${store.id}:${customerPhone}`;
apps/api/src/routes/webhooks.ts:77:        where: { storeId_phone: { storeId: store.id, phone: customerPhone } },
apps/api/src/routes/webhooks.ts:81:          where: { storeId_phone: { storeId: store.id, phone: customerPhone } },
apps/api/src/routes/webhooks.ts:91:            phone: customerPhone,
apps/api/src/routes/webhooks.ts:104:      customerId: customerPhone,
apps/api/src/routes/webhooks.ts:105:      customerPhone,
apps/api/src/routes/webhooks.ts:199:      const customerPhone = sender;
apps/api/src/routes/webhooks.ts:200:      const conversationId = `${store.id}:${customerPhone}`;
apps/api/src/routes/webhooks.ts:209:          where: { storeId_phone: { storeId: store.id, phone: customerPhone } },
apps/api/src/routes/webhooks.ts:213:            where: { storeId_phone: { storeId: store.id, phone: customerPhone } },
apps/api/src/routes/webhooks.ts:223:              phone: customerPhone,
apps/api/src/routes/webhooks.ts:245:                customerId: customerPhone,
apps/api/src/routes/webhooks.ts:246:                customerPhone: customerPhone,
apps/api/src/routes/webhooks.ts:262:        customerId: customerPhone,
apps/api/src/routes/webhooks.ts:263:        customerPhone,
apps/api/src/routes/conversations.ts:59:        customerPhone: conversation.customerPhone,
apps/api/src/routes/conversations.ts:147:        await fonnteService.sendMessage(conversation.customerPhone, sanitizedContent, {
apps/api/src/routes/conversations.ts:157:        await gowaAdapter.sendMessage(conversation.customerPhone, sanitizedContent, {
apps/api/src/business/tests/order-context.integration.test.ts:64:    data: { storeId, customerId: `${TEST_PREFIX}-cust`, customerPhone: '+62812345678' },
apps/api/src/business/conversation.service.ts:41:  customerPhone: string;
apps/api/src/business/conversation.service.ts:74:        customerPhone: customerId, // Fallback nilai phone dengan customerId
apps/api/src/business/conversation.service.ts:1175:    customerPhone: string,
apps/api/src/business/conversation.service.ts:1182:        customerPhone,
apps/api/src/business/conversation.service.ts:1276:      customerPhone: conv.customerPhone,
apps/api/src/business/conversation.service.ts:1324:        customerPhone: true,
apps/api/src/business/conversation.service.ts:1355:        customerPhone: conv.customerPhone,
apps/api/src/business/key-rotation.service.ts:19:  { model: 'Conversation', table: 'conversations', fields: ['customerPhone', 'customerName', 'notes'], hasSoftDelete: true },
apps/api/src/domain/types.ts:221:  customerPhone: string;
apps/api/src/tests/pipeline-edge-cases.test.ts:90:          customerPhone: 'ec2-customer',
apps/api/src/tests/golden-dataset.test.ts:183:      customerPhone: customerId,
apps/api/src/services/message-processor.service.ts:48:  customerPhone: string;
apps/api/src/services/message-processor.service.ts:188:      customerPhone: msg.customerId,
apps/api/src/services/message-processor.service.ts:336:      phone: input.customerPhone,
apps/api/src/services/message-processor.service.ts:353:    await this.smartRetrySend(input.customerPhone, content, sendConfig, input.gateway);
apps/api/src/services/message-processor.service.ts:363:        await gateway.markRead!(input.customerPhone, input.deviceId);
apps/api/src/services/message-processor.service.ts:395:          await fonfteService.sendMessage(input.customerPhone, textLink, { token: input.token, inboxid: input.inboxId });
apps/api/src/services/message-processor.service.ts:403:        await fonnteService.sendImageWithToken(input.customerPhone, imageUrl, input.token, textLink);
apps/api/src/services/message-processor.service.ts:411:          await fonnteService.sendMessage(input.customerPhone, textLink, { token: input.token, inboxid: input.inboxId });
apps/api/src/services/message-processor.service.ts:416:        await gateway.sendImage(input.customerPhone, imageUrl, textLink);
apps/api/src/services/message-processor.service.ts:423:        await gateway.sendMessage(input.customerPhone, textLink, { deviceId: input.deviceId });
apps/api/src/services/message-processor.service.ts:431:        await gateway.sendMessage(input.customerPhone, textLink, { token: input.token, inboxid: input.inboxId, deviceId: input.deviceId });
apps/api/src/infrastructure/prisma.ts:19:// Enkripsi field sensitif (phoneNumber, customerPhone, address, dll) otomatis.
apps/api/src/infrastructure/prisma.ts:29:  Conversation: ['customerPhone', 'customerName', 'notes'],
apps/api/src/bootstrap/scheduleFollowUps.ts:169:  customerPhone: string;
apps/api/src/bootstrap/scheduleFollowUps.ts:186:  const { store, customerName, customerPhone, id: conversationId, storeId } = conv;
apps/api/src/bootstrap/scheduleFollowUps.ts:206:      await fonnteService.sendMessage(customerPhone, followUpText, { token: store.fonnteToken });
apps/api/src/bootstrap/scheduleFollowUps.ts:213:      await gowaAdapter.sendMessage(customerPhone, followUpText, { deviceId });
```

> **Catatan fakta:** `tsconfig.json` aplikasi API adalah `"strict": true` (`apps/api/tsconfig.json`), artinya `strictNullChecks` **aktif**. Jadi bila kolom Prisma `Conversation.customerPhone` (saat ini `String` non-null) diubah jadi `String?`, tipe klien Prisma menjadi `string | null`, dan setiap situs yang memaksa `string` tanpa pengecekan null akan **gagal kompilasi** `tsc`. Ini dasar klasifikasi (b) di bawah.

---

## 2. `grep #2` mentah — `\.phone`

Perintah: `grep -rn "\.phone" apps/api/src`

Keluaran (verbatim, 19 match) — **semuanya adalah `phoneNumber` (kolom `Store`, bukan `Customer.phone`) atau field non-model**:

```
apps/api/src/routes/profile.ts:40:        phoneNumber: store.phoneNumber,
apps/api/src/routes/profile.ts:75:    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber || null;
apps/api/src/routes/profile.ts:91:        phoneNumber: store.phoneNumber,
apps/api/src/routes/auth.ts:197:    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber || null;
apps/api/src/routes/auth.ts:226:        phoneNumber: store.phoneNumber,
apps/api/src/routes/admin/stores.ts:127:      phoneNumber: s.phoneNumber,
apps/api/src/routes/admin/stores.ts:442:    const rawPhone = req.body.phoneNumber || '';
apps/api/src/routes/admin/stores.ts:575:        phoneNumber: store.phoneNumber,
apps/api/src/routes/whatsapp.ts:86:    const rawPhone = req.body.phoneNumber || '';
apps/api/src/routes/whatsapp.ts:253:        phoneNumber: status.phoneNumber,
apps/api/src/routes/routes/whatsapp.ts:254:        fonnteNumber: status.phoneNumber || null,
apps/api/src/routes/conversations.ts:153:    } else if (store?.phoneNumber) {
apps/api/src/business/fallback.service.ts:852:      if (store.phoneNumber) lines.push(`Telepon: ${store.phoneNumber}`);
apps/api/src/services/presence-simulator.service.ts:127:      await opts.gateway.markRead(opts.phone).catch((err) => {
apps/api/src/services/presence-simulator.service.ts:133:      await opts.gateway.setPresence(opts.phone, presenceState).catch((err) => {
apps/api/src/services/fonnte.service.ts:37:        phoneNumber: data?.device || data?.wa_number || data?.phone || undefined,
apps/api/src/services/whatsapp-connection.service.ts:106:          phoneNumber: status.phoneNumber || store.fonnteNumber || null,
apps/api/src/services/whatsapp-connection.service.ts:124:        phoneNumber: gowa.phoneNumber,
apps/api/src/bootstrap/scheduleFollowUps.ts:210:  } else if (store.phoneNumber) {
```

> **Fakta penting (verifikasi terhadap `Customer.phone` spesifik):**
> - `grep -rn "prisma\.customer" apps/api/src` → hanya di `webhooks.ts` (`:76 findUnique`, `:80 update`, `:88 create`, `:208 findUnique`, `:212 update`, `:220 create`). `findUnique` hanya dipakai untuk cek eksistensi + update `name`/`lastSeenAt`; **tidak pernah membaca `Customer.phone` kembali**.
> - `grep -rnE "[a-zA-Z_]+\.phone\b" apps/api/src | grep -viE "phoneNumber|opts\.phone|data\?.phone"` → **kosong** (exit 1). Artinya **tidak ada akses properti `Customer.phone` (`.phone`) di mana pun.** `Customer.phone` hanya ditulis (`phone: customerPhone`) dan diquery lewat indeks unique `storeId_phone`.
> - Dengan demikian, **grep #2 (0/19) tidak relevan dengan kolom `Customer.phone`**; kolom yang tersentuh adalah `Store.phoneNumber` (sudah `String?` / nullable, `schema.prisma:13`) dan field opsional/payload.

---

## 3. Klasifikasi per-match — `grep #1` (`customerPhone`)

Definisi:
- **(a) asumsi non-null** = kode memakai nilai sebagai `string` langsung tanpa null-check / coalesce (atau non-null assertion) atau dipakai sebagai key/whereclause wajib.
- **(b) pecah bila `String?`** = bila kolom `Conversation.customerPhone` (atau sumber Prisma yang terkait) diubah jadi nullable, penggunaan ini akan menyebabkan error TypeScript karena `strictNullChecks`.
- **AMAN** = tidak akan memicu error TS berupa "string diperlukan, string|null diberikan"; **BERISIKO** = akan error (perlu disesuaikan sebelum migrasi kolom ke nullable).

| No | file:line | kolom / sumber nilai | (a) asumsi non-null? | (b) pecah bila → `String?`? | status | cuplikan / keterangan singkat |
|----|-----------|----------------------|----------------------|----------------------------|--------|------------------------------|
| 1 | orders.ts:57 | Conversation.customerPhone (select) | – (query builder) | (b) N | AMAN | `select: { customerPhone: true }` — builder tidak pecah; hasil jadi `string\|null` bila nullable. |
| 2 | orders.ts:64 | Conversation.customerPhone (read) | Y | (b) N | AMAN | `conversation?.customerPhone \|\| order.customerId` — null-safe via `\|\|`. |
| 3 | webhooks.ts:49 | local var | – | – | AMAN | `const customerPhone = fromJid.replace(/@.*$/, '')` — `string`, bukan bacaan kolom. |
| 4 | webhooks.ts:70 | local var | – | – | AMAN | template literal \`...\`. |
| 5 | webhooks.ts:77 | Customer.phone (where ke unique index) | – (where-input) | (b) N | AMAN | `[Customer.phone]` query tetap terima `string`. |
| 6 | webhooks.ts:81 | Customer.phone (where) | AMAN | `[Customer.phone]` |
| 7 | webhooks.ts:91 | Customer.phone (create) | AMAN | `[Customer.phone]` — write, `string` assignable ke `string\|null`. |
| 8 | webhooks.ts:104 | ProcessMessageInput.customerId | AMAN | interface `string`. |
| 9 | webhooks.ts:105 | ProcessMessageInput.customerPhone | AMAN | shorthand `string` → field `string`. |
| 10 | webhooks.ts:199 | local var | AMAN | `const customerPhone = sender` (`string`). |
| 11 | webhooks.ts:200 | local var | AMAN | template literal. |
| 12 | webhooks.ts:209 | Customer.phone (where) | AMAN | `[Customer.phone]` |
| 13 | webhooks.ts:213 | Customer.phone (where) | AMAN | `[Customer.phone]` |
| 14 | webhooks.ts:223 | Customer.phone (create) | AMAN | `[Customer.phone]` write. |
| 15 | webhooks.ts:245 | ProcessMessageInput.customerId | AMAN | interface `string`. |
| 16 | webhooks.ts:246 | Conversation.customerPhone (upsert **create**) | – (write) | (b) N | AMAN — write; `string` assignable ke `string\|null`. |
| 17 | webhooks.ts:262 | ProcessMessageInput.customerId | AMAN |
| 18 | webhooks.ts:263 | ProcessMessageInput.customerPhone | AMAN |
| 19 | conversations.ts:59 | Conversation.customerPhone (read) | Y | (b) N | AMAN — ditulis ke `res.json` (tipe `any`); kompilasi aman, nilai bisa `null` di response pada runtime. |
| 20 | conversations.ts:147 | Conversation.customerPhone (read) | **Y** | **Y** | **BERISIKO** | `fonnteService.sendMessage(conversation.customerPhone, …)` — `phone: string` (`fonnte.service.ts:86`); tanpa null-check. |
| 21 | conversations.ts:157 | Conversation.customerPhone (read) | **Y** | **Y** | **BERISIKO** | `gowaAdapter.sendMessage(conversation.customerPhone, …)` — `phone: string` (`gowa.adapter.ts:44`); tanpa null-check. |
| 22 | order-context.integration.test.ts:64 | Conversation.customerPhone (create, test) | AMAN | literal `string`, assignable ke `string\|null`. |
| 23 | conversation.service.ts:41 | deklarasi tipe `ConversationListItem` | – | – | AMAN | sink; lihat turunan :1317 & :1355. |
| 24 | conversation.service.ts:74 | Conversation.customerPhone (upsert create) | AMAN | write; `customerId` (`string`) assignable. |
| 25 | conversation.service.ts:1175 | param `createConversation` | AMAN | deklarasi param `string`. |
| 26 | conversation.service.ts:1182 | Conversation.customerPhone (create) | AMAN | write; param `string`. |
| 27 | conversation.service.ts:1276 | Conversation.customerPhone (read) | Y | (b) N | AMAN — `conv: any`, tak dicek strict-null. |
| 28 | conversation.service.ts:1324 | Conversation.customerPhone (select) | – | (b) N | AMAN — builder select. **Deretkan** ke :1317 (lihat catatan). |
| 29 | conversation.service.ts:1355 | Conversation.customerPhone (read → return) | **Y** | **Y** | **BERISIKO** | `customerPhone: conv.customerPhone` ke `ConversationDetail.customerPhone: string` (`:41`); `conv: Conversation` (findUnique `:1334`, guard `:1337`). `string\|null` → `string` error. |
| 30 | key-rotation.service.ts:19 | nama kolom (literal array) | – | – | AMAN | string literal; bukan akses nilai. |
| 31 | domain/types.ts:221 | deklarasi tipe `ConversationWithContext` | – | – | AMAN | sink tipe. |
| 32 | pipeline-edge-cases.test.ts:90 | Conversation.customerPhone (upsert create, test) | AMAN | literal `string`. |
| 33 | golden-dataset.test.ts:183 | Conversation.customerPhone (create, test) | AMAN | `string` assignable. |
| 34 | message-processor.service.ts:48 | deklarasi tipe `ProcessMessageInput` | – | – | AMAN | sink; nilai isi selalu `string` dari webhook. |
| 35 | message-processor.service.ts:188 | ProcessMessageInput.customerPhone (rebuild) | Y | (b) N | AMAN | `customerPhone: msg.customerId` (`string`) — bukan bacaan Prisma. |
| 36 | message-processor.service.ts:336 | `phone: input.customerPhone` (ops `simulateResponse`) | Y | (b) N | AMAN | `input.customerPhone` tipenya `string` (interface), bukan bacaan kolom; nilai dari webhook local `string`. |
| 37 | message-processor.service.ts:353 | `smartRetrySend(input.customerPhone, …)` | Y | (b) N | AMAN | `smartRetrySend(phone: string, …)` (`:443`); `input.customerPhone: string`. |
| 38 | message-processor.service.ts:363 | `gateway.markRead!(input.customerPhone, …)` | Y | (b) N | AMAN | `!` di sini pada **method** `markRead` (opsional), bukan pada `customerPhone`; `input.customerPhone: string`. |
| 39 | message-processor.service.ts:395 | `fonnteService.sendMessage(input.customerPhone, …)` | Y | (b) N | AMAN | argumen dari interface `string`. |
| 40 | message-processor.service.ts:403 | `sendImageWithToken(input.customerPhone, …)` | Y | (b) N | AMAN | `sendImageWithToken(phone: string,…)` (`fonnte.service.ts:68`). |
| 41 | message-processor.service.ts:411 | `fonnteService.sendMessage(input.customerPhone, …)` | AMAN | argumen interface `string`. |
| 42 | message-processor.service.ts:416 | `gateway.sendImage(input.customerPhone, …)` | AMAN | `sendImage?(phone: string,…)` (`whatsapp-gateway.interface.ts:12`). |
| 43 | message-processor.service.ts:423 | `gateway.sendMessage(input.customerPhone, …)` | AMAN | `sendMessage(phone: string,…)` (`:44`-gowa/`:86`-fonnte). |
| 44 | message-processor.service.ts:431 | `gateway.sendMessage(input.customerPhone, …)` | AMAN | sama. |
| 45 | prisma.ts:19 | komentar | – | – | AMAN | komentar saja. |
| 46 | prisma.ts:29 | daftar enkripsi `['customerPhone', …]` | – | – | AMAN | literal string; konfigurasi runtime. |
| 47 | scheduleFollowUps.ts:169 | deklarasi tipe `IdleConversation` | – | – | AMAN | sink; **turunan risiko :157** (lihat catatan). |
| 48 | scheduleFollowUps.ts:186 | destruktur `customerPhone` dr `IdleConversation` | Y | (b) N | AMAN* | di dalam `processFollowUp`, typed `string` dr `:169`. *berisiko boundary `:157`. |
| 49 | scheduleFollowUps.ts:206 | `fonnteService.sendMessage(customerPhone, …)` | Y | (b) N | AMAN* | `customerPhone: string` (dr `IdleConversation`). *berisiko boundary `:157`. |
| 50 | scheduleFollowUps.ts:213 | `gowaAdapter.sendMessage(customerPhone, …)` | Y | (b) N | AMAN* | `sendImage?`/`sendMessage` `phone: string`. *berisiko boundary `:157`. |

**Catatan turunan (bukan literal grep hit, tapi konsekuensi langsung kolom `Conversation.customerPhone` → `String?`):**
- `conversation.service.ts:1317` — `findAllByStore` mengembalikan `Promise<ConversationListItem[]>` (`:1316`) dari `findMany` dengan `select` termasuk `customerPhone: true` (`:1324`) dan interface `ConversationListItem.customerPhone: string` (`:41`). Bila kolom nullable, tipe kembali `string | null`, tidak assign ke `string` → **TS error** di return `:1317`. **BERISIKO** (terkait langsung grep hit `:1324` + `:41`).
- `scheduleFollowUps.ts:157` — `await processFollowUp(conv, now)`; `conv` hasil `findMany` (`:56`) yang berisi `customerPhone` (non-null kolom saat ini). Bila nullable, `conv.customerPhone: string | null` tidak assign ke `IdleConversation.customerPhone: string` (`:169`) → **TS error** di argumen `:157`. **BERISIKO** (terkait grep hit `:169`/`:186`/`:206`/`:213`).

**Daftar semua situs BERISIKO (akan pecah `tsc` bila `Conversation.customerPhone` → `String?`):**
| file:line | mekanisme break |
|---|---|
| conversations.ts:147 | argumen `phone: string` ke `fonnteService.sendMessage` |
| conversations.ts:157 | argumen `phone: string` ke `gowaAdapter.sendMessage` |
| conversation.service.ts:1355 | assign `string\|null` ke `ConversationDetail.customerPhone: string` |
| conversation.service.ts:1317 | return `findMany` (`customerPhone: string\|null`) sebagai `ConversationListItem[]` (`customerPhone: string`) |
| scheduleFollowUps.ts:157 | argumen `conv` (customerPhone `string\|null`) ke `IdleConversation` (`customerPhone: string`) |

---

## 4. Klasifikasi per-match — `grep #2` (`\.phone`)

Semua 19 match adalah `phoneNumber` (kolom `Store.phoneNumber`) atau field opsional/payload, **bukan** `Customer.phone`. Ringkasan:

| No | file:line | akses | kolom / model | relevan ke `Customer.phone`? | status | catatan |
|----|-----------|-------|---------------|------------------------------|--------|---------|
| 1 | profile.ts:40 | `phoneNumber: store.phoneNumber` | Store.phoneNumber (`String?`, schema:13) | TIDAK | AMAN | sudah nullable; dipakai di objek respon (`any`). |
| 2 | profile.ts:75 | `updateData.phoneNumber = phoneNumber \|\| null` | Store.phoneNumber (write) | TIDAK | AMAN | null-handled. |
| 3 | profile.ts:91 | `phoneNumber: store.phoneNumber` | Store.phoneNumber | TIDAK | AMAN | |
| 4 | auth.ts:197 | `updateData.phoneNumber = phoneNumber \|\| null` | Store.phoneNumber | TIDAK | AMAN | |
| 5 | auth.ts:226 | `phoneNumber: store.phoneNumber` | Store.phoneNumber | TIDAK | AMAN | |
| 6 | admin/stores.ts:127 | `phoneNumber: s.phoneNumber` | Store.phoneNumber | TIDAK | AMAN | |
| 7 | admin/stores.ts:442 | `const rawPhone = req.body.phoneNumber \|\| ''` | req.body (input) | TIDAK | AMAN | |
| 8 | admin/stores.ts:575 | `phoneNumber: store.phoneNumber` | Store.phoneNumber | TIDAK | AMAN | |
| 9 | whatsapp.ts:86 | `const rawPhone = req.body.phoneNumber \|\| ''` | req.body | TIDAK | AMAN | |
| 10 | whatsapp.ts:253 | `phoneNumber: status.phoneNumber` | DeviceStatus.phoneNumber (opsional) | TIDAK | AMAN | |
| 11 | whatsapp.ts:254 | `fonnteNumber: status.phoneNumber \|\| null` | DeviceStatus.phoneNumber | TIDAK | AMAN | null-safe. |
| 12 | conversations.ts:153 | `else if (store?.phoneNumber)` | Store.phoneNumber | TIDAK | AMAN | sudah null-check (`?.`). |
| 13 | fallback.service.ts:852 | `if (store.phoneNumber) …` | Store.phoneNumber | TIDAK | AMAN | sudah null-check. |
| 14 | presence-simulator.ts:127 | `opts.gateway.markRead(opts.phone)` | ops `phone` (bukan kolom) | TIDAK | AMAN | nilai = `input.customerPhone` (`string`); bukan bacaan `Customer.phone`. |
| 15 | presence-simulator.service.ts:133 | `opts.gateway.setPresence(opts.phone, …)` | ops `phone` | TIDAK | AMAN | |
| 16 | fonnte.service.ts:37 | `… data?.phone \|\| undefined` | payload Fonete | TIDAK | AMAN | field payload, bukan kolom model. |
| 17 | whatsapp-connection.service.ts:106 | `status.phoneNumber \|\| store.fonnteNumber \|\| null` | DeviceStatus/gowa | TIDAK | AMAN | |
| 18 | whatsapp-connection.service.ts:124 | `phoneNumber: gowa.phoneNumber` | gowa status | TIDAK | AMAN | |
| 19 | scheduleFollowUps.ts:210 | `else if (store.phoneNumber)` | Store.phoneNumber | TIDAK | AMAN | sudah null-check. |

**Kesimpulan grep #2:** tidak ada match yang merupakan akses ke kolom `Customer.phone`. Semua berurusan dengan `Store.phoneNumber` (sudah `String?` di `schema.prisma:13` dan seluruhnya sudah ditangani secara null-safe atau melalui `any` respon) atau field opsional/payload non-modela. Oleh karena itu **0 BERISIKO** terhadap kolom `Customer.phone`.

---

## 5. Ringkasan akhir (tabel)

| grep | kolom yang ditinjau | total match | BERISIKO (pecah `strictNullChecks` bila kolom → `String?`) | AMAN / tidak terpengaruh langsung |
|------|---------------------|-------------|----------------------------------------------------------|----------------------------------|
| #1 `customerPhone` | `Conversation.customerPhone` | 50 | **5** (3 literal `#20,21,29` + 2 turunan `:1317`, `:157`) | 45 |
| #2 `\.phone` | `Customer.phone` | 19 | **0** (tidak ada akses `Customer.phone` `.phone`) | 19 (semua `Store.phoneNumber` sudah nullable+ditangani, atau non-model) |
| **Total** | | **69** | **5** | **64** |

> - **BERISIKO (5) untuk `Conversation.customerPhone` → `String?`:** `conversations.ts:147`, `conversations.ts:157`, `conversation.service.ts:1355` (literal), plus `conversation.service.ts:1317` dan `scheduleFollowUps.ts:157` (turunan — konsekuensi langsung dari grep hit yang bersangkutan).
> - **Tidak ada BERISIKO** terhadap `Customer.phone`, karena `Customer.phone` tidak pernah dibaca via `.phone` (hanya ditulis `/ diquery indeks pada `webhooks.ts:77,81,91,209,213,223`).
> - Grup `message-processor.service.ts` (`:188,:336,:353,:363,:395,:403,:411,:416,:423,:431`) dan `scheduleFollowUps.ts` (`:206,:213`) serta `webhooks.ts` semuanya memakai **interface/lokal-var `string`** (bukan bacaan Prisma langsung) → tidak pecah pada perubahan kolom, **tetapi tetap mengasumsikan non-null**; nilai perlu tetap disuplai `string`.

---

## 6. Metodologi & cakupan (tanpa rekomendasi / fix)

- Audit murni: **tidak ada file sumber yang diedit/dihapus/ditambah** di `apps/`. Hanya berkas laporan baru yang akan dicatat.
- `tsconfig` API: `"strict": true` → klasifikasi (b) berlaku.
- Kolom Prisma yang ditinjau: `Conversation.customerPhone` (non-null `String`, `schema.prisma:144`) dan `Customer.phone` (non-null `String`, `schema.prisma:396`). `Store.phoneNumber` (`String?`, `schema.prisma:13`) hanya sebagai pembanding pada grep #2.
- Tidak ada desain/penambahan kolom yang diusulkan — itulah pekerjaan terpisah.

## Lampiran A — Bukti scope tidak melebar (`git diff --stat` + `git log -1`)

`git diff --stat` terhadap parent (`chore` sebelumnya) menampilkan **hanya 1 file** — tidak ada file sumber yang tersentuh:

```text
$ git diff --stat HEAD~1
 DOCS/laporan-taskPWA1-grep.md | 281 ++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 281 insertions(+)
```

`git log -1` — commit terpisah dengan pesan yang ditentukan tugas:

```text
$ git log -1
commit c15f248a47847fb9b6120b70f6f2cc641f3e0b69
Author: pandjiemadiun <dwiputroagung2773@gmail.com>
Date:   Tue Aug 11 06:53:45 2026 +0000

    docs(PWA.1): audit grep customerPhone/Customer.phone usage
```

Catatan: blok bukti di atas dicapture dari `git diff --stat HEAD~1` dan `git log -1` commit
verifikasi (C1) **sebelum** `git commit --amend` memasukkan blok bukti ini ke dalam laporan.
Karena laporan ini **berisi** output `git log -1`‑nya, hash commit final berubah sekali lagi
setelah amend — namun **pesan commit**, **author**, **Date (author)**, fakta **hanya 1 file**
(`DOCS/laporan-taskPWA1-grep.md`) yang ditambahkan, dan jumlah `insertions(+)` (281) tetap
konsisten (substitusi hanya mengganti isi dalam baris yang sama, tidak menambah/mengurangi
jumlah baris). Ini pola yang sama (line-count stabil, hash off-by-one) yang dipakai pada
laporan sister TASK P-PWA.0.

