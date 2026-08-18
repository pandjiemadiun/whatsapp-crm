# 05_PWA_IDENTITY_BLUEPRINT.md — IDENTITY & CHANNEL ARCHITECTURE (FINAL)
Status: DISETUJUI 11 Agu 2026 (Panji + Claude), belum dikerjakan.
Menggantikan/melengkapi 04_PWA_BLUEPRINT.md untuk bagian identity/data model.
Kalau ada isi yang bentrok dengan 04_PWA_BLUEPRINT.md, file INI yang menang
untuk soal identity/schema — 04_PWA_BLUEPRINT.md tetap sumber untuk UX/UI/
milestone teknis lain yang tidak disebut di sini.

---

## 0. KENAPA FILE INI ADA

Audit read-only (`DOCS/laporan-taskPWA0-audit.md`, TASK P-PWA.0, commit
`87858dd`) menemukan 3 blocker nyata yang membuat asumsi awal blueprint
(`04_PWA_BLUEPRINT.md`) tidak bisa langsung dieksekusi:

1. `Store` tidak punya kolom `slug`/`storeSlug` — dibutuhkan untuk
   `qlobot.web.id/c/<slug>`.
2. `Conversation.customerPhone` dan `Customer.phone` **wajib non-null**,
   keduanya WA-specific. Customer Web tidak punya nomor WA.
3. `conversationId` di-generate aplikasi sebagai `${storeId}:${customerPhone}`
   dan langsung jadi PK `Conversation.id` — bukan `store:<nomor>` seperti
   asumsi lama di `04_PWA_BLUEPRINT.md:26`. Pola ini tidak bisa dipakai untuk
   Web karena Web tidak punya `customerPhone`.

Draft usulan GPT (11 Agu 2026) merevisi arsitektur identity berdasarkan
temuan ini. Setelah cross-check terhadap kode nyata, sebagian usulan
DITERIMA, sebagian DIREVISI. File ini adalah versi final gabungan.

---

## 1. KEPUTUSAN INTI

### 1.1 Web adalah channel baru dengan identity baru — DITERIMA
Customer Web **tidak** dipaksa masuk ke conversation WA yang sudah ada.
Tidak ada pencarian "cari nomor WA dari uid Web" — itu tidak mungkin,
Web visitor tidak punya nomor WA.

```
WA customer  → phone   → WA Conversation
WEB visitor  → webUid  → WEB Conversation
```

Keduanya diproses oleh Conversation Engine yang sama
(`conversationService.processCustomerMessage`), tidak ada engine AI kedua.

### 1.2 conversationId: DUA POLA KOEKSIS, WA TIDAK DISENTUH — REVISI dari usulan GPT
GPT mengusulkan "conversationId jangan lagi jadi mekanisme identity,
pakai Customer.id" secara umum. **Ini direvisi**: berlaku HANYA untuk
conversation channel WEB yang baru dibuat.

**Alasan revisi:** pola lama `${storeId}:${customerPhone}` sebagai PK
dipakai di jalur WA production canary aktif untuk idempotent upsert
(webhook WA yang datang berkali-kali otomatis resolve ke conversation
yang sama tanpa query pencarian). Pola ini sudah disentuh oleh banyak
fitur yang sudah stabil (fast-path, workspace_v2 P3.1-P3.4, optimistic
lock race-fix). Mengubahnya untuk WA = scope creep besar + risiko
regresi ke pekerjaan P0-P6 yang sudah selesai dan terverifikasi.
Melanggar RAILS.md §1.4 (dilarang mengubah file di luar scope TASK).

**Keputusan final:**
- **WA**: `Conversation.id = ${storeId}:${customerPhone}` — TIDAK BERUBAH.
- **WEB**: `Conversation.id` = UUID biasa (`@default(uuid())`, perilaku
  default Prisma yang sudah ada di schema). Identity customer Web
  dipegang oleh `Customer.webUid`, bukan oleh bentuk PK Conversation.
- Kedua pola boleh koeksis di tabel `Conversation` yang sama selama
  tidak saling tabrak (tidak ada kolision, format string vs UUID jelas
  berbeda bentuknya).

### 1.3 channel field: PAKAI YANG SUDAH ADA — DITERIMA
`Conversation.channel` (`schema.prisma:146`, `String @default("whatsapp")`)
sudah ada. Masalah HANYA di `conversation.service.ts:75` yang hardcode
`channel: 'whatsapp'` saat create. Fix: parameter `channel` diteruskan
dari caller (adapter WA kirim `'whatsapp'`, adapter Web kirim `'web'`),
bukan hardcode.

Tidak perlu bikin kolom `source` baru — `source` sudah ada di level lain
(`ConversationHistory.source`, `schema.prisma:176`) untuk keperluan
berbeda (asal balasan AI/FAQ/SOP), sesuai catatan lama di
`04_PWA_BLUEPRINT.md:19-21`. **Jangan ditimpa, jangan disatukan.**

### 1.4 Store.slug: kolom baru — DITERIMA
```prisma
model Store {
  ...
  slug String? @unique
  ...
}
```
- Nullable dulu saat migration (supaya toko existing tidak pecah),
  wajib diisi untuk toko yang mengaktifkan fitur PWA.
- `@unique`, format public-safe (mis. `toko-makmur`), **tidak boleh**
  berbasis nomor WA atau data internal apa pun.
- Terpisah total dari identity customer — slug cuma untuk resolve Store,
  bukan bagian dari Customer/Conversation identity.

### 1.5 Customer & Conversation: nullable phone + identity Web baru — DITERIMA dengan syarat verifikasi
```prisma
model Customer {
  ...
  phone   String?   // UBAH dari String wajib -> nullable
  webUid  String?   @unique  // BARU
  ...
  // constraint: salah satu dari phone/webUid WAJIB terisi (app-level,
  // Prisma tidak punya native XOR constraint — divalidasi di service layer)
}

model Conversation {
  ...
  customerPhone String?   // UBAH dari String wajib -> nullable
  channel        String   @default("whatsapp")  // sudah ada, tidak berubah
  ...
}
```

**Syarat sebelum migration dieksekusi** (bukan boleh diasumsikan aman):
robot WAJIB `grep -rn "customerPhone" apps/api/src` dan
`grep -rn "\.phone" apps/api/src` (khusus pemakaian `Customer.phone`)
untuk memetakan SEMUA titik yang mengasumsikan non-null (TypeScript
strict-null bisa diam-diam di-cast paksa dengan `!` atau default value
yang salah kalau tidak dicek manual). Laporkan dulu sebelum ubah tipe,
baru migration dieksekusi setelah semua titik pemakaian dikonfirmasi
aman untuk nullable.

**Aturan bisnis (app-level, bukan DB constraint):**
- `channel = 'whatsapp'` → `customerPhone` WAJIB terisi (validasi di
  service, bukan cuma di webhook).
- `channel = 'web'` → `customerPhone` boleh null, `Customer.webUid`
  WAJIB terisi.

### 1.6 Linking WA identity ↔ Web identity — BELUM DIPUTUSKAN, gap eksplisit
GPT mengusulkan "CRM boleh menggabungkan WA+Web jadi satu customer
timeline" (satu `BUDI` dengan dua identity di bawahnya) — **visinya
diterima**, tapi **mekanisme linking-nya TIDAK dijelaskan GPT dan BELUM
diputuskan di sini.**

Tanpa titik temu eksplisit, `Customer{phone: 628xxx}` (WA) dan
`Customer{webUid: web_xxx}` (Web) akan **selamanya jadi dua baris
terpisah** — tidak pernah otomatis ketemu jadi satu customer di CRM.

Opsi yang perlu didiskusikan terpisah (BUKAN bagian Fase 0, dicatat
sebagai item antrian, jangan diasumsikan otomatis selesai):
- CTA link WA→Web menyisipkan `phone` sebagai hint opsional di URL
  query (mis. `?ref=628xxx`), lalu Web conversation pertama kali
  otomatis coba match/link ke `Customer` WA yang sama by phone hint.
- Verifikasi nomor manual di Web (customer input nomor WA sendiri,
  opsional, untuk minta digabung).
- Dibiarkan terpisah selamanya di level data, CRM cuma menampilkan
  gabungan berdasarkan kecocokan manual/heuristik lain (nama+lokasi),
  bukan foreign key nyata.

**Keputusan sementara:** Fase 0 TIDAK mengerjakan linking mechanism ini.
Schema disiapkan supaya secara teknis MUNGKIN nanti ditambah kolom
penghubung (mis. `Customer.linkedCustomerId` self-relation), tapi tidak
diimplementasikan di Fase 0. Didiskusikan ulang sebelum Fase 3 (CRM UI)
dimulai.

---

## 2. YANG DIREVISI DARI USULAN GPT (ringkas, alasan lihat §1)

| Usulan GPT | Status | Alasan |
|---|---|---|
| conversationId lepas total dari phone, pakai Customer.id untuk SEMUA channel | REVISI — hanya WEB, WA tetap pola lama | Ubah pola WA = scope creep, risiko regresi P0-P6 (§1.2) |
| CRM otomatis gabungkan WA+Web jadi 1 timeline | REVISI — visi diterima, mekanisme linking BELUM diputuskan | GPT tidak jelaskan cara link; tanpa itu 2 identity selamanya terpisah (§1.6) |
| customerPhone/Customer.phone langsung diubah nullable | REVISI — wajib grep semua pemakaian dulu sebelum migration | Banyak titik kode asumsikan non-null, TypeScript bisa cast paksa diam-diam (§1.5) |
| Semua sisanya (slug, channel field reuse, Fase 0-3, CORS, rate limit, jangan rewrite engine AI) | DITERIMA | Sejalan langsung dengan temuan audit |

---

## 3. ROADMAP FASE (identity-first, sesuai urutan GPT + revisi di atas)

### FASE 0 — Identity & Data Model (schema only, TANPA logic/UI baru)
1. Grep menyeluruh pemakaian `customerPhone`/`Customer.phone` di
   `apps/api/src` — laporkan sebelum migration (lihat §1.5).
2. Migration: `Store.slug` (nullable, unique).
3. Migration: `Customer.phone` nullable, `Customer.webUid` baru
   (nullable, unique).
4. Migration: `Conversation.customerPhone` nullable.
5. Validasi app-level: channel='whatsapp' → phone wajib;
   channel='web' → webUid wajib (di service layer, bukan DB constraint).
6. `conversation.service.ts:75` — hapus hardcode `channel: 'whatsapp'`,
   terima sebagai parameter dari caller.
7. TIDAK mengubah pola `conversationId` untuk WA. TIDAK membuat UI.
   TIDAK membuat endpoint PWA baru di fase ini.

### FASE 1 — Channel abstraction (adapter layer)
- Pertahankan `conversationService.processCustomerMessage()` apa adanya
  (audit konfirmasi sudah channel-agnostic dari sisi signature:
  storeId + conversationId + customerId + text).
- Buat Web Adapter baru (paralel dengan GOWA/Fonnte adapter existing)
  yang: resolve Store by slug → resolve/create Customer by webUid →
  resolve/create Conversation (UUID, channel='web') → panggil
  `processCustomerMessage` → kembalikan response (bukan kirim via
  WA gateway).
- TIDAK mengubah `gateway: 'gowa'|'fonnte'` union yang dipakai jalur WA
  — union itu untuk keperluan kirim-balasan WA spesifik (gowaAdapter/
  fonnteService), Web tidak lewat situ sama sekali (response langsung
  jadi HTTP response, bukan dikirim via gateway pesan).

### FASE 2 — Web API (3 endpoint sesuai 04_PWA_BLUEPRINT.md)
```
GET  /api/pwa/:storeSlug/init      → resolve Store by slug, kembalikan
                                      data publik (lihat §4)
GET  /api/pwa/:storeSlug/history   → resolve Customer by webUid (query
                                      param), riwayat Web Conversation
POST /api/pwa/:storeSlug/message   → resolve/create Customer+Conversation,
                                      panggil Conversation Engine,
                                      conversationLimiter WAJIB dipasang
                                      (endpoint publik, belum ada limiter
                                      terpasang sama sekali saat ini)
```

### FASE 3 — PWA frontend
`apps/pwa` baru (React 19 + Vite + Tailwind v4, ikuti pola `apps/dashboard`
sebagai referensi struktur — bukan workspace terpusat, tiap app mandiri
sesuai pola monorepo tanpa `workspaces` yang sudah ada).
Linking WA↔Web CRM (§1.6) didiskusikan ulang sebelum fase ini kalau
belum diputuskan.

---

## 4. FIELD STORE UNTUK ENDPOINT `/init` (dari audit, siap pakai)

Kolom publik-aman (tanpa kolom baru selain `slug`):
`name`, `profilePhotoUrl`, `description`, `businessCategory`, `address`,
`timezone`, `operatingHours`, `acceptsQris`, `acceptsCod`,
`acceptsTransfer`, `qrisImageUrl`, `shippingMode`,
`shippingFlatInCity`, `shippingFlatOutCity`, `isActive`.

Kolom **TIDAK BOLEH** diekspos ke endpoint publik:
`phoneNumber`, `whatsappPhoneId`, `fonnteToken`, `fonnteNumber`,
`webhookSecret`, `email`.

---

## 5. OPERASIONAL — RELEASE REQUIREMENT (bukan desain produk, tapi wajib)

- **CORS**: `apps/api/src/index.ts:74` saat ini hanya whitelist
  `localhost:5173`/`localhost:4173`. WAJIB tambah origin produksi
  (`https://qlobot.web.id`, subdomain terkait) sebelum PWA live —
  idealnya via env var, bukan hardcode array baru.
- **Rate limiting**: `conversationLimiter` sudah didefinisikan di
  `rate-limiters.ts` tapi TIDAK PERNAH dipasang di route manapun saat
  ini (dikonfirmasi audit, grep `app.use(...conversationLimiter` kosong).
  WAJIB dipasang eksplisit di `POST /api/pwa/:storeSlug/message` —
  endpoint ini publik, tanpa auth apa pun, risiko abuse tinggi kalau
  tanpa limiter.

---

## 6. YANG TIDAK BERUBAH (tegaskan biar tidak lupa)

- `conversationService.processCustomerMessage()` — TIDAK di-rewrite.
- Pola `conversationId` untuk WA (`${storeId}:${customerPhone}` sebagai
  PK) — TIDAK diubah.
- `ConversationHistory.source` — TIDAK disatukan dengan `channel`, tetap
  dua kolom terpisah dengan makna berbeda.
- Engine AI (v2/v3.2, hasil P0-P6) — TIDAK disentuh oleh pekerjaan PWA.
  Web hanya nambah jalur masuk baru ke engine yang sama.

---

## 7. STATUS EKSEKUSI

- [ ] FASE 0 — belum mulai. TASK berikutnya yang perlu ditulis: grep
      pemakaian customerPhone/Customer.phone (§1.5 langkah 1) SEBELUM
      migration apa pun dieksekusi.
- [ ] FASE 1 — belum mulai.
- [ ] FASE 2 — belum mulai.
- [ ] FASE 3 — belum mulai.
- [ ] Keputusan linking WA↔Web CRM (§1.6) — belum diputuskan, item
      antrian terpisah sebelum Fase 3.

Sumber audit: `DOCS/laporan-taskPWA0-audit.md` (commit `87858dd`).
Sumber blueprint UX/milestone asli: `04_PWA_BLUEPRINT.md`.
