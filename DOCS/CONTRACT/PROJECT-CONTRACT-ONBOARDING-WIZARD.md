# QloBot Project Contract — Onboarding Wizard + Auto-Generated TOS/SOP/FAQ

**Status:** DRAFT — owner approval required before implementation
**Scope:** Post-registration business-profile wizard + LLM-assisted TOS/SOP/FAQ generation
**Konteks:** Pre-launch, belum ada toko/customer nyata. Bebas desain penuh sekarang,
tidak ada data produksi yang perlu dikorbankan/dimigrasi.

---

## 0. Keputusan Kunci (LOCKED, owner-approved 31 Agu 2026)

1. **Wizard bersifat OPSIONAL, bukan hard-block sebelum toko live.**
   Alasan: memaksa penyelesaian wizard sebelum toko boleh live menaikkan drop-off
   funnel (praktik umum SaaS onboarding). Kondisi tanpa TOS/SOP/FAQ terisi adalah
   **degradasi kualitas jawaban AI, bukan kerusakan** — chat tetap berfungsi, cuma
   kurang relevan untuk pertanyaan kebijakan/FAQ spesifik toko. Solusi: dashboard
   checklist kelengkapan + reminder persisten, TIDAK memblokir toko go-live.

2. **TOS versioning dibangun PENUH sekarang, TIDAK ditunda ke fase terpisah.**
   Revisi dari draft awal (yang sempat mengusulkan tunda snapshot per-order ke P2).
   Owner koreksi: justru karena belum ada toko/order nyata, sekarang adalah waktu
   TERMURAH untuk membangun invariant lengkap — menunda berarti nanti harus migrasi
   data order yang sudah ada tanpa referensi TOS version, lebih mahal. Dibangun
   sekaligus: `StoreDocument` versioned + `Order.tosDocumentId` snapshot reference.

3. **Immutability-once-published** (pola sama dengan `ActionIdempotency` permanent
   retention di kontrak structured actions — konsisten dengan gaya arsitektur project
   ini): dokumen yang sudah `published` TIDAK BOLEH diedit in-place. Edit setelah
   publish = buat row versi baru (`version + 1`), versi lama tetap ada (superseded,
   bukan dihapus). Ini yang membuat `Order.tosDocumentId` sebagai FK ke row spesifik
   cukup — tidak perlu snapshot teks terpisah, karena isi row itu dijamin tidak
   pernah berubah setelah published. Konsisten dengan prinsip "satu sumber
   kebenaran" (I13 truth boundary) yang sudah dipakai di CartAuthority.

---

## 1. Insight Arsitektur — TOS/SOP vs FAQ/KB adalah DUA bentuk data berbeda

**JANGAN disatukan ke satu tabel.**

- **TOS/SOP** = dokumen panjang (long-form text), ditampilkan statis di halaman
  toko (`/c/<slug>/tos`). Butuh versioning + immutability (§0.2/§0.3).
- **FAQ/KB** = pasangan tanya-jawab pendek, di-*match* semantik oleh tier
  `tryFAQ`/`tryKnowledge` yang **SUDAH ADA** di `fallback.service.ts` — saat ini
  kosong di SEMUA toko (termasuk canary) karena tidak pernah ada mekanisme isi.
  Wizard ini **mengisi tabel yang sudah ada**, BUKAN membuat storage baru untuk FAQ.
  Threshold matching tier ini (0.5 + margin 0.15) sudah pernah ditandai
  `[DUGAAN, belum divalidasi data nyata]` karena data KB kosong — wizard ini
  yang akhirnya memberi data nyata untuk validasi threshold tsb (item lama RAILS §3).

---

## 2. Prasyarat — AUDIT WAJIB sebelum P1 mulai

Skema final di §3 masih **draft berdasarkan asumsi** dari dokumentasi lama
(`fallback.service.ts` tryFAQ/tryKnowledge). Sebelum implementasi, robot WAJIB
audit read-only:

- Skema tabel KB/FAQ aktual yang dibaca `tryFAQ`/`tryKnowledge` saat ini
  (kolom apa, ada embedding/vector atau plain keyword match, ada `storeId` scope).
- Konfirmasi tabel ini benar-benar kosong di semua toko existing (bukan cuma canary).
- Apakah AI key pool (Groq/Gemini) yang dipakai wizard generation SAMA dengan yang
  dipakai chat engine customer-facing — kalau ya, apakah ada risiko wizard generation
  (burst calls saat banyak toko onboarding bersamaan) mengganggu kuota/rate-limit
  chat customer real-time. Laporkan, jangan asumsikan aman.

**P0 = audit ini. Implementasi P1 tidak boleh mulai sebelum P0 selesai dan
dilaporkan ke owner.**

---

## 3. Schema (draft, tunduk pada hasil audit P0)

### 3.1 `StoreDocument` (baru)

```prisma
model StoreDocument {
  id                   String    @id @default(uuid())
  storeId              String
  store                Store     @relation(fields: [storeId], references: [id])
  type                 String    // 'tos' | 'sop'
  version              Int       @default(1)
  content              String    // markdown/plain text
  status               String    // 'draft' | 'published' | 'superseded'
  generatedFromAnswers Json?     // snapshot jawaban wizard yang menghasilkan versi ini
  generatedAt          DateTime?
  publishedAt          DateTime?
  editedAt             DateTime  @updatedAt
  createdAt            DateTime  @default(now())

  @@unique([storeId, type, version])
  @@index([storeId, type, status])
}
```

Invariant (WAJIB ditegakkan di service layer, bukan cuma dokumentasi):
- Row dengan `status='published'` TIDAK BOLEH di-`UPDATE` pada kolom `content`.
  Edit setelah publish = INSERT row baru `version+1`, `status='draft'`, lalu proses
  publish ulang men-set row lama jadi `status='superseded'`.
- Hanya boleh ada MAKSIMAL 1 row `status='published'` per `(storeId, type)` di
  waktu tertentu.

### 3.2 `Order.tosDocumentId` (extend existing model)

```prisma
model Order {
  // ... existing fields
  tosDocumentId String?
  tosDocument   StoreDocument? @relation(fields: [tosDocumentId], references: [id])
}
```

Nullable (order lama/toko tanpa TOS published tetap valid — regression gate sama
prinsipnya dengan Product Variants §1: "produk tanpa varian tetap identik", di sini
"order tanpa TOS tetap identik"). Diisi otomatis saat checkout dengan
`StoreDocument` yang sedang `published` untuk toko itu (kalau ada). Karena
immutability (§0.3), pointer ini SELAMANYA valid sebagai bukti "versi TOS apa yang
berlaku saat order dibuat" — tidak perlu snapshot teks terpisah.

### 3.3 FAQ/KB — MENUNGGU hasil audit P0

Jangan desain skema di sini sebelum P0 konfirmasi struktur aktual. Kemungkinan
besar wizard hanya perlu INSERT ke tabel existing dengan `source: 'wizard_generated'`
sebagai penanda (vs entry manual admin) — TAPI ini butuh konfirmasi kolom yang
tersedia dulu.

---

## 4. Alur Wizard

1. **Info dasar** (post-registrasi, TAMBAHAN dari yang sudah wajib saat registrasi
   — phone/address/origin sudah ada): kategori usaha, deskripsi singkat toko.
2. **Tanya terpandu** (bukan kolom kosong bebas isi) — pertanyaan tetap:
   - Kebijakan retur/tukar barang (boleh/tidak, syarat, batas waktu)
   - Metode pembayaran yang diterima (cross-check dari `Order.paymentMethod`
     config yang sudah ada, jangan tanya ulang kalau sudah ada datanya)
   - Estimasi waktu proses/kirim
   - Jam operasional toko
   - Kontak CS (nomor sudah ada dari registrasi, konfirmasi ulang saja)
3. **Generate draft** — panggilan LLM terpisah (BUKAN lewat
   `conversation.service.ts`/interpreter customer-facing — panggilan one-off
   terstruktur, function baru, key pool tunduk hasil audit P0) → hasilkan draft
   TOS + SOP + starter FAQ entries dari jawaban wizard.
4. **Review merchant** — draft `status='draft'`, MUTABLE bebas diedit dashboard.
   TIDAK auto-publish.
5. **Publish** — merchant klik publish → `status='published'` (immutable, §0.3).
   TOS/SOP jadi halaman statis PWA; FAQ entries masuk tabel existing, otomatis
   kepakai `tryFAQ`/`tryKnowledge` TANPA ubah kode engine.

---

## 5. Explicitly Do NOT Do

- Do not treat draft LLM output sebagai siap disajikan ke customer — WAJIB
  merchant-approve dulu (§0, alur §4 step 4).
- Do not overwrite entry FAQ/KB yang sudah diisi manual oleh merchant — hanya
  pre-fill kalau kosong, atau merge eksplisit dengan konfirmasi merchant.
- Do not izinkan mutasi `content` pada row `published` — invariant §3.1 mutlak.
- Do not klaim TOS hasil LLM sebagai final legal-compliant — WAJIB tampilkan
  disclaimer ke merchant: "draft otomatis, disarankan direview manusia/legal
  sebelum dipublikasikan", khususnya terkait UU PDP (data pribadi customer).
- Do not couple LLM call wizard ke key-router/circuit-breaker chat engine tanpa
  konfirmasi kapasitas dari audit P0 — kalau shared pool, laporkan risikonya,
  jangan langsung reuse tanpa cek.
- Do not jadikan wizard blocking toko go-live (§0.1, LOCKED).
- Do not hapus row `StoreDocument` versi lama (`superseded`) — retention permanen,
  sama prinsipnya dengan `ActionIdempotency` (§6A.2 kontrak structured actions).

---

## 6. Urutan Implementasi

- **P0 — Audit (WAJIB duluan).** Skema KB/FAQ aktual + konfirmasi kosong + cek
  AI key pool sharing. Read-only, tanpa kode berubah.
- **P1 — Schema.** `StoreDocument` model + invariant immutability (service-layer
  guard, bukan cuma DB constraint) + `Order.tosDocumentId` extend.
- **P2 — Wizard UI dashboard.** Multi-step form, pertanyaan terpandu §4.
- **P3 — LLM generation service.** Function terpisah dari chat pipeline, terima
  jawaban wizard → draft TOS+SOP+FAQ starter.
- **P4 — Review/edit/publish flow.** Draft mutable, publish → immutable + versioning.
- **P5 — PWA display + KB wiring.** Halaman statis `/c/<slug>/tos`; FAQ entries
  masuk tabel existing (verifikasi tryFAQ/tryKnowledge otomatis pakai data baru
  tanpa perlu ubah engine).
- **P6 — Dashboard checklist/nudge.** Non-blocking reminder kelengkapan toko.
- **P7 — Checkout wiring.** `Order.tosDocumentId` diisi otomatis saat checkout
  dari `StoreDocument` yang sedang published (kalau ada; nullable kalau belum).

Tiap fase commit per-unit (RAILS §1.9), bukti RAILS §5 wajib tiap unit.

---

## 7. Pertanyaan Terbuka — status keputusan

1. **[LOCKED, owner-approved 31 Agu 2026]** TOS/SOP tetap prioritas diisi untuk
   toko yang HANYA pakai kanal WA (belum aktifkan PWA) — kualitas jawaban chat WA
   sama pentingnya dengan PWA. Wizard TIDAK boleh diperlakukan sebagai "fitur PWA
   saja"; nudge/checklist (§P6) berlaku untuk SEMUA toko terlepas kanal aktif.
   Ini mempertegas P5 (KB wiring) tidak boleh diurutkan setelah/tergantung P7
   (checkout wiring, PWA-only) — keduanya independen, P5 relevan untuk WA juga.
2. **[LOCKED, owner-approved 31 Agu 2026]** Bahasa draft LLM: IKUT gaya bahasa
   yang dipakai merchant saat mengisi jawaban wizard (santai vs formal terdeteksi
   dari jawaban teks bebas merchant), BUKAN dipaksa baku formal seragam. Prompt
   generation (P3) harus instruksikan LLM mencerminkan register bahasa merchant,
   dengan tetap menjaga kejelasan (TOS/SOP tetap harus dimengerti customer,
   gaya santai tidak boleh mengorbankan kejelasan kebijakan).
3. Apakah starter FAQ hasil wizard perlu tag/marker `source: 'wizard_generated'`
   supaya admin bisa bedakan dari entry manual di masa depan (analytics/audit)?
   Bergantung hasil audit P0 kalau kolom ini feasible ditambah tanpa migrasi mahal.
   **[MASIH TERBUKA]** — robot boleh putuskan saat P0 kalau jawabannya jelas dari
   struktur tabel (mis. kalau sudah ada kolom `source`/`origin` generik, tinggal
   pakai; kalau tidak ada, laporkan ke owner sebelum nambah kolom baru).

---

## 8. Approval Gate

Draft ini BUKAN otorisasi implementasi. Perlu:
1. Owner konfirmasi §0 (sudah locked via percakapan, dicatat verbatim di sini).
2. Owner jawab §7 (3 pertanyaan) — atau eksplisit bilang "robot putuskan saat P0/P1
   kalau audit menunjukkan jawaban jelas".
3. P0 (audit) dijalankan dan dilaporkan SEBELUM P1 mulai.
