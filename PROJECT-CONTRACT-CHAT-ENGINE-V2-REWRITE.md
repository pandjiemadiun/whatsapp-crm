 PROJECT-CONTRACT-CHAT-ENGINE-V2-REWRITE.md

**Status:** DRAFT — wajib approval eksplisit sebelum implementasi apa pun.
**Scope:** Penggantian TOTAL conversation engine (v1 interpreter.ts + v2 reasoning.ts
dual-path + fallback.service.ts 13-tier keyword chain) dengan SATU engine LLM-first.
**Basis:** Mandat owner 4 Sep 2026 — token bebas, tidak ada batasan hemat sampai
kualitas natural tercapai. Ini BUKAN task tambal — ini rewrite disetujui penuh.

---

## 0. Keputusan Terkunci (owner-approved, 4 Sep 2026 — TIDAK BOLEH didebat ulang)

1. **v1 (interpreter.ts) DIHAPUS TOTAL.** Tidak ada lagi dual-path v1/v2 per-toko.
   Satu engine untuk SEMUA toko, tidak ada flag rollout bertahap lagi.
2. **Keyword/regex tier (fallback.service.ts 13-tier chain) DITURUNKAN jadi
   emergency-fallback ONLY** — dipakai HANYA kalau LLM call gagal total
   (timeout/provider down/rate-limit habis semua provider), BUKAN sebagai jalur
   utama penentu maksud pesan.
3. **LLM adalah penentu utama** — satu (atau lebih, kalau perlu untuk kualitas)
   pemanggilan LLM per pesan customer, terstruktur (structured output/JSON schema),
   yang MENENTUKAN intent + entitas + aksi, bukan sekadar mengisi celah setelah
   keyword gagal.
4. **Token cost BUKAN constraint desain.** Baru dioptimasi (RAG/cache untuk
   pertanyaan sering muncul) SETELAH kualitas percakapan natural terbukti stabil
   — bukan dari awal.
5. **Structured action (tap tombol) WAJIB selalu echo konfirmasi ke
   conversation_history** — tidak ada lagi aksi sukses yang diam di chat
   (gap yang ditemukan di kasus Bengkel Didik).
6. **CartAuthority tetap satu-satunya domain authority** untuk cart/order —
   rewrite ini mengganti LAPISAN INTERPRETASI (siapa yang memutuskan maksud
   pesan), BUKAN lapisan eksekusi bisnis. Prinsip lama (I13 harga dari DB,
   satu sumber kebenaran) tetap berlaku, tidak dibuka untuk didesain ulang.

---

## 1. Kenapa rewrite, bukan tambal lagi

Sejarah panjang di RAILS.md (P0-P8, tier fix B1-B4, golden dataset) membuktikan
tambal-per-bug pada arsitektur 13-tier keyword TIDAK PERNAH konvergen — setiap
fix satu tier collision, muncul kasus baru di tier lain (paling baru: substring
`'ga'` di `pendingClarification.ts`, pola identik dengan bug lama `'ram'`⊂`'Brambang'`
dari 9 Agu 2026). Ini bukan bug individual, ini keterbatasan struktural pendekatan
kata kunci untuk klasifikasi maksud bahasa natural. Owner eksplisit: cukup tambal,
ganti fondasinya.

## 2. Target arsitektur (tingkat tinggi — detail teknis di Unit-plan §5)

```

Customer message (WA atau PWA, teks bebas)
        ↓
Emergency circuit-breaker check (LLM provider sehat? kalau TIDAK → keyword
tier chain lama sebagai fallback darurat SAJA, dengan reply yang jujur
menyatakan keterbatasan, bukan pura-pura paham)
        ↓ (jalur normal)
LLM-first classifier+responder (SATU sumber kebenaran maksud pesan)
  - structured output: intent, entities, proposed actions
  - full conversation context (bukan single-turn stateless)
        ↓
Validated structured intent/actions (schema validation, SAMA prinsip dengan
structured actions §2.2 kontrak lama — LLM tidak boleh langsung eksekusi
tanpa validasi)
        ↓
Domain authority (CartAuthority / orderService / dst — TIDAK BERUBAH)
        ↓
Response composer (natural, context-aware — bukan template kaku) + WAJIB
echo ke conversation_history untuk SEMUA jalur (LLM DAN structured action tap)

```

## 3. Yang TIDAK berubah (locked dari kontrak lama, tetap berlaku)

- `CartAuthority.executeOps()` sebagai satu-satunya entry point mutasi cart.
- `ActionIdempotency` FOR UPDATE + re-check pattern untuk structured actions.
- I13 (harga selalu dari DB, tidak pernah dari LLM langsung).
- Tenant isolation (storeId scoping di semua query).
- Structured action (tap tombol UI) TETAP bypass LLM untuk aksi yang sudah
  eksplisit diketahui (§2.1 kontrak structured actions lama) — rewrite ini
  TIDAK mengubah itu, cuma menambah echo konfirmasi (§0.5).

## 4. Rencana Unit Kerja (WAJIB per-unit, commit+push tiap unit, RAILS §1.9)

> **P0 — Audit ulang scope penuh (read-only).** Petakan SEMUA konsumen
> `fallback.service.ts`/`interpreter.ts`/`tier-match.ts` yang akan terdampak
> (termasuk golden dataset, structured actions overlap, WA vs PWA channel
> differences). Robot laporkan sebelum P1 mulai — JANGAN asumsi audit lama
> (CHAT-ENGINE-AUDIT-BASELINE.md, 3 Sep) masih 100% akurat, itu 1 hari sebelum
> temuan Bengkel Didik.

> **P1 — Desain schema LLM output + prompt baru (draft, review owner).**
> Structured output schema untuk intent+entities+actions. Termasuk desain
> bagaimana context percakapan panjang di-manage (window/summarization) supaya
> tetap "nyambung" (keluhan utama owner: chat tidak nyambung antar-turn).

> **P2 — Emergency fallback minimal (bukan 13-tier, versi ringkas).**
> Definisikan PERSIS kapan fallback ini aktif (LLM provider down measurable,
> bukan "kalau LLM ragu"). Reply jujur, bukan tebak-tebak keyword.

> **P3 — Engine baru jalan paralel v1/v2 lama di 1 toko test dulu (shadow atau
> canary terbatas), BUKAN langsung cutover semua toko.** Meski v1 akan dihapus
> total (§0.1), penghapusan terjadi SETELAH engine baru terbukti stabil di
> canary — bukan big-bang cutover tanpa validasi. Ini demi keamanan data
> transaksi real, bukan menunda soal token/biaya.

> **P4 — Golden dataset diperluas mencakup skenario nyata yang sudah ketemu
> bug:** "ask total → false cancel", multi-produk dalam 1 pesan, klarifikasi
> ambigu (nama+alamat yang mengandung kata mirip negasi), dst — supaya
> regression gate benar-benar menangkap kasus dunia nyata, bukan kasus buatan.

> **P5 — Cutover semua toko ke engine baru + hapus v1/tier-chain lama total.**
> Hanya setelah P3/P4 hijau penuh DAN owner explicit approve.

> **P6 — (SETELAH kualitas stabil, BUKAN sebelum) RAG/cache untuk pertanyaan
> sering muncul** — optimasi biaya, secara eksplisit ditunda sesuai §0.4.

## 5. Regression Gate (WAJIB, tidak bisa dilewati)

Setiap unit P0-P5: test:chat + test:golden + test:structured + test:payment +
test:shipping semua hijau (baseline sekarang: 271/37/118/46/8) SEBELUM lanjut
unit berikutnya. P4 WAJIB menambah case baru untuk 2 bug nyata yang sudah
ditemukan sesi ini (rollback false-positive, silent ADD_TO_CART tanpa echo)
sebagai permanent regression test — bukan cuma fix sekali lalu hilang lagi.

## 6. Explicitly Do NOT Do

- Do not implementasi tanpa P0 audit ulang selesai dan dilaporkan.
- Do not cutover semua toko sekaligus tanpa canary period (P3).
- Do not modifikasi CartAuthority/ActionIdempotency locking sebagai bagian
  rewrite ini — itu di luar scope, kontrak terpisah kalau memang perlu.
- Do not optimasi token/biaya sebelum P5 selesai dan owner konfirmasi puas
  dengan kualitas (§0.4).
- Do not klaim "selesai"/"natural" tanpa bukti percakapan nyata (transkrip,
  bukan cuma unit test sintetis) direview owner.

## 7. keputusan owner sebelum P1

§7.1 — Window canary: tergantung pada apakah ada merchant asli di sistem.

> **UPDATE 4 Sep 2026**: TIDAK ADA toko produksi/merchant asli yang terdaftar
> di sistem. SELURUH toko (termasuk store-4f4f67bd "Bengkel Didik") adalah data
> uji/dummy. Akibatnya, syarat Fase 1 harus langsung dieksekusi — tidak perlu
> menunggu merchant asli. Dokumen ini mencatat dua fase:

**Fase 1 (Pre-merchant / sekarang)**: berjalan sampai ada merchant asli pertama
terdaftar. Minimal 3 hari operasional + minimal 30 percakapan test manual yang
terstruktur mensimulasikan skenario nyata, dengan syarat nol bug kritis selama
window itu. WAJIB mereplay keempat skenario bug yang sudah ditemukan:
  1. `false-cancel` — konfirmasi harga → kirim cancel tanpa konfirmasi ulang
  2. `silent-ADD_TO_CART` — aksi berhasil tidak echo ke conversation_history
  3. `magic-paste batch weight gate` — batch import produk melewati gerbang
     berat otomatis tapi tidak meneruskan ke layer CartAuthority
  4. `variant parsing ambigu` — parsing nama/varian yang ambigu menghasilkan
     SKU yang salah

Kalau ketemu bug kritis, window reset dari nol setelah fix — bukan lanjut
hitungan lama.

**Fase 2 (Post-merchant / sebelum full cutover)**: SELESAIKAN 30 percakapan
customer asli (bukan test sintetis). Ini WAJIB dijalankan ulang — bukan cuma
andalkan test dummy. Hanya setelah **Fase 1 hijau penuh** + owner explicit
approve + **Fase 2 hijau penuh** → baru cutover ke SEMUA toko. Ini adalah
kebijakan tambahan, bukan pelonggaran: regression gate tetap WAJIB di setiap unit.

§7.2 — Toko canary: tetap store-4f4f67bd (Bengkel Didik). Meskipun ini adalah
toko **dummy/test data** (bukan merchant asli — tidak ada toko produksi di
sistem saat ini 4 Sep 2026), tetap dipilih sebagai canary store karena:
- Punya riwayat bug nyata (false-cancel, silent-ADD_TO_CART) yang bisa
  direplay sebagai regression test (lihat BENGKEL-DIDIK-BUG1-TRACE.md)
- Data varian/produk paling lengkap di antara test store yang ada
- Berguna sebagai regression bed — bukan test sintetis yang buta sama sekali

Ganti dari store-f7140b5c (dummy lama, minim data) ke store-4f4f67bd.
Fokus: gunakan riwayat bug-nya sebagai regression bed, bukan karena
status "representatif produksi".

§7.3 — Model AI: tidak dikunci ke 1 provider. Project ini sudah punya sistem provider dinamis (AIProviderConfig, resolver, N-provider rotation — sudah live sejak sesi lalu). Saya arahkan robot untuk PAKAI sistem itu untuk role intent-classification baru, jadi kualitas bisa dibandingkan lintas provider (Mistral/SambaNova/Gemini/Groq/dll) via test-connection yang sudah ada, tanpa hardcode ke satu vendor. Kalau nanti audit P1 nemu alasan teknis kenapa harus dikunci (mis. fitur structured-output cuma stabil di 1 provider), itu dilaporkan sebagai temuan, bukan diasumsikan dari awal.

> **Amandemen kontrak (4 Sep 2026)**: Klarifikasi status data — seluruh toko
> di sistem adalah data uji/dummy. §7.1 dan §7.2 diperbarui untuk mencerminkan
> dua fase canary (pre-merchant test simulation + post-merchant real conversation
> gate). Ini adalah ketentuan tambahan, bukan pelonggaran: regression gate
> (test:chat + test:golden + test:structured + test:payment + test:shipping)
> tetap WAJIB di setiap unit.

## 8. Approval Gate

Draft ini BUKAN otorisasi implementasi. P0 (audit) boleh mulai setelah owner
approve dokumen ini secara garis besar — pertanyaan §7 boleh dijawab
"robot putuskan saat P0/P1 kalau audit kasih jawaban jelas", tapi WAJIB
dicatat eksplisit, bukan diasumsikan.
```

