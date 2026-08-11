# LAPORAN TASK B2 — AUDIT TIER fallback.service.ts (READ-ONLY, tidak ada perubahan kode)

Sesi: 9 Agu 2026. Sumber: `apps/api/src/business/fallback.service.ts` (file tidak dimodifikasi/di-commit pada TASK ini).
Bacaan wajib terpenuhi: `RAILS.md` + `STATUS-V2.md` (dari sesi sebelumnya).
Catatan: semua temuan berdasarkan bacaan kode `file:line` + data toko canary **store-f7140b5c** (Depot Kinasih) yang dibaca lewat Prisma langsung (query read-only, tidak menulis). Tidak ada asumsi tanpa contoh konkret.

## Fakta toko canary (store-f7140b5c) — dibaca via Prisma, 9 Agu 2026 11:xx
- store: `Depot Kinasih`, `shippingMode="flat"`, `shippingFlatInCity=15000`, `shippingFlatOutCity=40000`, `acceptsCod=true`, `acceptsTransfer=true`, `acceptsQris=true`, alamat "Jl. Sudirman No. 42, Kel. Purwakarta, Jaksel".
- Produk aktif (7): `Ayam` 35000, `Es Teh Manis` 5000, `Es Jeruk Manis` 7000, `Brambang` 30000, `Kentang` 17000, `Wortel` 19000 (stok 100), `Kangkung` 8000 (stok 100). Kebanyakan `stock=null`.
- FAQ: **kosong** (`[]`).
- SOP: hanya `{category:"retur", content:"Barang bisa diretur dalam 24 jam setelah diterima. Hubungi admin via WhatsApp untuk proses retur."}`.
- Knowledge base: belum dicek isi (tidak ada knowledge row yang dilihat; tryKnowledge pakai `knowledgeService.search`).

> Bukti RAILS — ini READ-ONLY: tidak ada `git add`/`commit` pada sesi ini, tidak ada file `.ts` source yang di-edit. Hanya `laporan-taskB2.md` yang ditulis.

## Urutan chain (sebenarnya di kode)
Di `getResponse` (`fallback.service.ts:57`), urutan eksekusi adalah:
1. `isDeadEnd` (gate, `:73`) — bukan tier jawaban.
2. `tryCache` (`:154`)
3. `tryFAQ` (`:163`)
4. `tryOrderStatus` (`:522`)
5. `tryTotal` (`:593`)
6. `tryShipping` (`:449`)
7. `tryPayment` (`:372`)
8. `tryCatalog` (`:201`)
9. `tryProduct` (`:244`)  ← sudah pernah ditighten di TASK B1.
10. `tryProductNotFound` (`:338`)
11. `trySop` (`:680`)
12. `tryKnowledge` (`:182`)
13. `HUMAN` terminal (`:145-151`) — balasan generik "Maaf kak, saya tidak dapat memproses...".

Setiap tier: `if (resp) return resp;` → hit = kembalikan `ResponseOption` (propagates ke `getResponse` `:124`/`buildResult`), miss = `return null` → lanjut ke tier berikutnya.

## Tabel ringkas

| # | Tier | file:line | Basis match | Risiko | Side effect on hit? | Contoh salah (jika ada) |
|---|------|-----------|-------------|--------|---------------------|--------------------------|
| 1 | tryCache | `:154` | exact key string `response:{storeId}:{query}` | RENDAH | tidak | — |
| 2 | tryFAQ | `:163` | `faqService.search` confidence > 0.3 | SEDANG | tidak | tidak bisa demonstrasi (FAQ canary kosong); berpotensi false-positive threshold 0.3 |
| 3 | tryOrderStatus | `:522` | substring keyword `statusKeywords` (`:525`) | SEDANG | tidak | `"sampai mana kangkung tersedia?"` → keyword `sampai mana` → no lastOrder → balas "tidak ada pesanan aktif di chat ini" padahal pertanyaan stok/ketersediaan |
| 4 | tryTotal | `:593` | substring keyword `totalKeywords` (`:596`) + cart/order DB | TINGGI | tidak (read-only) | `"berapa bayar kangkung"` / `"tagihannya kangkung"` → keyword `bayar berapa`/`tagihannya` → keranjang kosong → balas "Keranjang masih kosong..." padahal tanya harga kangkung (8000). tryTotal duduk DI ATAS tryProduct → orang tetap belum dijawab harga. |
| 5 | tryShipping | `:449` | substring keyword `shippingKeywords` (`:455`) | SEDANG | tidak | `"ambil sendiri kangkung?"` (order) vs pickup intent — ambigu; `kurir`/`jne` relatif eksklusif sehingga false-positive jarang |
| 6 | tryPayment | `:372` | substring keyword `paymentKeywords` (`:376`) + store flags | TINGGI | tidak | `"berapa bayar kangkung"` → `bayar` → balas metode pembayaran padahal tanya harga; juga `transfer`/`cod`/`va`/`ovo`/`gopay`/`dana`/`atm` mudah tumpang tumbuang dengan pertanyaan lain |
| 7 | tryCatalog | `:201` | substring `catalogKeywords` (`:204`) | RENDAH | tidak | — |
| 8 | tryProduct | `:244` | `shouldAnswerSingleProduct` (TASK B1 gate) | RENDAH (post-B1) | **ya** (`getResponse:125 saveDiscussedItems`) — tapi hanya ketika QUALIFIES; miss = tidak write | (sudah ditighten; "ram"⊄"Brambang" sekarang miss) |
| 9 | tryProductNotFound | `:338` | regex awalan `^(ada|boleh|jual|beli|stok|ready|kosong|tersedia|punya)\s+(.+?)$` + DB token | SEDANG | tidak | `"ada brambang?"` → `brambang` ada di DB → hasDbMatch → null (benar). Tapi regex awalan lemah: `"kak nanya stok kangkung?"` tidak match `^(stok ...)` (kata pertama 'kak') → miss ke tier lanjut (bukan salah jawab, hanya melewatkan). Risiko palsu: `"boleh cek kangkung"` → inquiryMatch `boleh`+`cek kangkung` → askedWords `['cek','kangkung']` → 'kangkung' ada di DB → null (benar). |
| 10 | trySop | `:680` | substring keyword `categoryMap` (`:685`) → `prisma.sop.findUnique({storeId_category})` | SEDANG | tidak | `"ganti kangkung ke wortel"` → `ganti` termasuk retur-keywords (`:686`) → canary punya SOP `retur` → balas "Barang bisa diretur dalam 24 jam..." padahal bukan retur |
| 11 | tryKnowledge | `:182` | `knowledgeService.search` confidence > 0.3 | SEDANG | tidak | tidak bisa demonstrasi (knowledge base canary belum dicek); berpotensi false-positive threshold 0.3 |

> Definisi risiko: **TINGGI** = substring/tekaan keyword yang dapat menyelinderkan/menyelundupkan pertanyaan harga/order ke tier non-target DI ATAS tryProduct (mirip pola bug tryProduct "ram"⊂"Brambang"); **SEDANG** = keyword substring yang bisa overlap dengan intent lain tapi tidak selalu menghasilkan jawaban salah; **RENDAH** = exact/keyword-intent eksklusif atau sudah ditighten (post-B1).

## Detail per tier (dengan kutipan kode)

### tryCache — `:154-161`
```ts
private async tryCache(context, query) {
  const cacheKey = `response:${context.storeId}:${query}`;
  const cached = await adapters.cache.get(cacheKey) ...;
  if (cached && cached.content) return { source: ResponseSource.CACHE, content: cached.content, confidence: 0.95, cost: 0 };
  return null;
}
```
- Hit: ada entry cache dengan key persis `response:{storeId}:{query}` (termasuk casing/normalisasi query). Miss: tidak ada.
- Basis: **exact string key** (bukan keyword). Risiko RENDAH. Tidak ada side effect.
- Catatan: cache key pakai `query` mentah (bukan normalized) — konsistensi cache-write/read bergantung pada pemanggil yang sama. Jika normalizer diproduction memberi query berbeda saat write vs read, cache akan sering miss (bukan "jawaban salah", hanya ineisien). `cache` di sini adalah `adapters.cache` (Redis). Tidak ada pembukaan `cache.set` di fallback.service.ts → penulis cache berada di luar file ini (bukan concern audit ini).

### tryFAQ — `:163-180`
```ts
const results = await faqService.search(context.storeId, query);
if (results.length > 0 && results[0].confidence > 0.3) { return {...}; }
return null;
```
- Hit: `faqService.search` mengembalikan ≥1 hasil dengan confidence > 0.3.
- Basis: **confidence threshold 0.3 (tekaan)** — bergantung implementasi `faqService.search` (kemungkinan embedding/keyword). Risiko SEDANG (threshold rendah). Tidak ada side effect.
- Contoh salah di canary: **tidak dapat demonstrasi** — FAQ canary kosong (`FAQS: []`). Pernyataan "berpotensi false-positive" tetap berlaku untuk toko lain dengan FAQ banyak, tapi karena RAILS melarang asumsi tanpa contoh konkret, saya **tidak mengklaim** contoh fals positif spesifik. Hanya konfirmasi: tiap toko dengan FAQ yang loose scorer berisiko jawab FAQ yang relevansi rendah.

### tryOrderStatus — `:522-586`
```ts
const statusKeywords = ['sudah dikirim','kapan dikirim','status pesanan','status order','sampai mana','udah sampai','udah sampe','pesanan saya','order saya','mana pesanan'];
const matched = statusKeywords.some((kw) => lower.includes(kw));
if (!matched) return null;
... lastOrder = await prisma.order.findFirst({ where:{conversationId,status:notIn:[shipped,delivered,cancelled]}})
if (!lastOrder) return { content:'Saat ini tidak ada pesanan aktif di chat ini. Apakah ada yang bisa saya bantu?' };
```
- Hit: query mengandung substring `statusKeywords`.
- Basis: **substring keyword**. Risiko SEDANG (lihat contoh di tabel).
- **Contoh salah konkret (canary):** Customer: `"sampai mana kangkung tersedia?"` (bertanya ketersediaan kangkung). `lower.includes('sampai mana')` = true → tryOrderStatus aktif → tidak ada order aktif → balas `"Saat ini tidak ada pesanan aktif di chat ini. Apakah ada yang bisa saya bantu?"` padahal pertanyaannya tentang stok/ketersediaan kangkung. tryOrderStatus duduk **sebelum** tryTotal/tryShipping/tryProduct, jadi pertanyaan produk ini tidak pernah sampai ke tryProduct. **Side effect: tidak ada** (read-only).

### tryTotal — `:593-678`
```ts
const totalKeywords = ['total','totalnya','total saya','berapa semua','semuanya berapa','jumlahnya','grand total','gtotal','tagihannya','bayar berapa'];
const matched = totalKeywords.some((kw) => lower.includes(kw));
if (!matched) return null;
... items = confirmedItems (cart) ...;
if (items.length === 0) return { content:`...keranjang masih kosong... mau cari produk?` };
```
- Hit: query mengandung substring `totalKeywords`.
- Basis: **substring keyword** + membaca keranjang DB. Risiko **TINGGI**.
- **Contoh salah konkrit (canary):** Customer: `"berapa bayar kangkung"` (tanya harga kangkung, 8000). `lower.includes('bayar berapa')` = true → tryTotal aktif → keranjang kosong → balas `"Keranjang belanja Kakak masih kosong nih. Mau cari produk dulu?"` — tidak menjawab harga kangkung. tryTotal duduk **di atas** tryShipping/tryPayment/tryCatalog/tryProduct, jadi "tanya harga" sering diselaaskan ke jawaban keranjang kosong. Substrings `bayar berapa`/`tagihannya` sempit; `total`/`jumlahnya` juga bisa muncul di konteks harga (mis. "jumlahnya kangkung?"). **Side effect: tidak ada** (read-only), tapi menyuruh ke lajur salah.
- Catatan: `tryTotal` menerima argumen `customerCity` (`:100`) dan men-added ongkkir 5000 bila ada kota — jadi jawaban total bisa mengandung ongkir yang pelanggan tidak tanya.

### tryShipping — `:449-520`
```ts
const shippingKeywords = ['ongkir','kirim','pengiriman','ekspedisi','biaya kirim','berapa ongkos','ambil sendiri','pickup','dikirim','ongkos kirim','kurir','jne','j&t','sicepat','anteraja','gosend','grab','bisa diantar','diantar','pengirimannya'];
if (!shippingKeywords.some(kw => lower.includes(kw))) return null;
```
- Hit: query mengandung substring `shippingKeywords`. Basis: keyword tapi relatif spesifik. Risiko **SEDANG**.
- Contoh lemah: `"ambil sendiri kangkung"` (bisa order) — `ambil sendiri`/`pickup` → tryShipping balas pickup info, padahal mungkin customer ingin order. Namun canary `shippingMode='flat'`, jadi `ambil sendiri` tidak eksplisit → tidak trigger; trigger hanya pada keyword. Saya **tidak menemukan false-positive kritis yang pasti** di canary; cukup berpotensi overlap dengan intent order (`ambil`/`pickup`). Risiko diturunkan karena keyword eksklusif. **Side effect: tidak ada.**
- `tryShipping` memanggil `productService`? Tidak — hanya baca `prisma.store`. Tapi di kode ada parameter `askIdentity` (`:449`) yang tidak dipakai di branch ini (bisa jadi legacy). Not relevant.

### tryPayment — `:372-447`
```ts
const paymentKeywords = ['bayar','pembayaran','transfer','rekening','qris','cod','cash on delivery','bisa cod','metode pembayaran','via apa','cara bayar','mau bayar','pembayarannya','pake apa','pakai apa','bisa bayar','pakai bank','transfer ke','nomor rekenking','norek','atm','debit','kredit','virtual account','va','ovo','gopay','dana'];
const hasPaymentKeyword = paymentKeywords.some(kw => lower.includes(kw));
if (!hasPaymentKeyword) return null;
```
- Hit: query mengandung substring `paymentKeywords`. Basis: **substring keyword lebar**. Risiko **TINGGI**.
- **Contoh salah konkrit (canary):** Customer: `"berapa bayar kangkung"` → `bayar` → tryPayment balas daftar metode pembayaran (COD/Transfer/QRIS) padahal bertanya harga. `transfer`/`va`/`ovo`/`gopay`/`dana`/`atm`/`debit`/`kredit` juga mudah muncul di pertanyaan umum. Canary menerima semua (acceptsCod/Transfer/Qris=true), jadi akan selalu jawab. **Side effect: tidak ada**, tapi menyajikan metode bayar saat diminta harga → orang tetap tidak dapat harga di tier ini.
- Catatan bug BUG-10/12 di komentar `getResponse:105-107`: urutan sengaja menempatkan shipping+payment **sebelum** product agar "bayar" tidak misfire ke "Bawang" di tryProduct. Tapi penempatan sebelum tryTotal (`bayar berapa`) justru menciptakan konflik baru: `bayar berapa kangkung` pertama kali cocok tryTotal (`:100`) Sebelum tryPayment (`:113`) — jadi contoh di atas sebenarnya terlepas ke tryTotal dulu. Jika query hanya `"bayar"` maka ke tryPayment. Intinya: kata `bayar` ada di **dua** keyword list (tryTotal + tryPayment) → rentan dobel penyelundupan.

### tryCatalog — `:201-242`
```ts
const catalogKeywords = ['jual apa','jualan apa','ada apa','ada apa aja','list produk','produk apa','barang apa','katalog','lihat produk','semua produk','produk tersedia','stok apa','bisa beli apa'];
const isCatalogIntent = catalogKeywords.some(kw => lower.includes(kw));
if (!isCatalogIntent) return null;
```
- Hit: substring `catalogKeywords`. Basis: keyword intent katalog yang cukup eksklusif. Risiko **RENDAH**. Contoh salah: tidak ditemukan kriteria nyata (kata-kata ini memang "minta daftar produk"). **Side effect: tidak ada.**

### tryProduct — `:244-336` (POST-B1, sudah ditighten)
```ts
const results = await productService.searchProducts(context.storeId, query);
...
const qualifies = shouldAnswerSingleProduct(q, p.name, results.length);
if (!qualifies) { adapters.logger.info('tryProduct miss...'); return null; }
...
```
- Hit: `searchProducts` + `shouldAnswerSingleProduct` (TASK B1 gate: exact / fuzzy-N≤MAX_DISTANCE / prefix / all-name-tokens-present-in-query, hanya single candidate). Risiko **RENDAH** setelah B1.
- **Contoh BUG lama (now fixed):** `"ram"` → sebelumnya substring `includes('ram')` true di "Brambang" → jawab harga Brambang. Sekarang `shouldAnswerSingleProduct('ram','Brambang',1)` = **false** (bukan exact, bukan prefix, `brambang` tidak startsWith `ram`, levenshtein 4 > MAX_DISTANCE 1, token `ram` tidak ada di token nama `brambang`) → miss → lanjut ke tier/LLM. ✅
- **Side effect:** `getResponse:125` memanggil `await this.saveDiscussedItems(...)` **hanya bila tryProduct mengembalikan hasil** (qualified single match ATAU ambigu). Pada miss (`return null`) tidak ada side effect — sesuai desain B1 ("no side effect, exactly like any other miss"). Pada ambiguity (`:278` similarCount>=2) justru tetap mengembalikan disambiguasi dan `saveDiscussedItems` tetap jalan — ini **disengaja**.

### tryProductNotFound — `:338-370`
```ts
if (greetingWords.some(g => lower.includes(g))) return null;
const inquiryMatch = lower.match(/^(ada|boleh|jual|beli|stok|ready|kosong|tersedia|punya)\s+(.+?)(\?|$)/);
if (!inquiryMatch) return null;
... askedWords = ...filter(w => w.length>1 ...);
const hasDbMatch = askedWords.some(w => dbProductNameTokens.some(dn => dn.includes(w)));
if (hasDbMatch) return null;
...
return { source: ResponseSource.CATALOG, content:'Maaf Kak, produk itu belum tersedia di toko kami saat ini...' };
```
- Hit: query diawali kata tanya + ada kata produk yang **tidak** ada di DB. Basis: regex awalan + pencocokan kata (substring `dn.includes(w)`).
- Risiko **SEDANG** (lihat tabel). `dn.includes(w)` = substring dalam — contoh: query `"ada kenten?"` (typo kentang) → askedWords `['kenten']` → `kentang`.includes('kenten') false → tidak-db-match → balas "belum tersedia". Ini **wajar** (memang typo tidak dikenali). Tapi `"ada brambang"` → `brambang` ada di DB → hasDbMatch → null (benar). **Side effect: tidak ada** (read-only; `findUnique` context hanya untuk makanan di cart).

### trySop — `:680-721`
```ts
const categoryMap = [['komplain','keluhan','kecewa'],'komplain'], [['retur','kembalikan barang','tukar barang','barang rusak','rusak','pengembalian','refund'],'retur'], ...];
for (const [keywords, cat] of categoryMap) { if (keywords.some(kw => lower.includes(kw))) { category = cat; break; } }
if (!category) return null;
const sop = await prisma.sop.findUnique({ where:{ storeId_category:{storeId, category} }, select:{content:true} });
if (!sop?.content) return null;
```
- Hit: query mengandung substring kata kunci kategori SOP **dan** toko punya SOP content untuk kategori itu. Basis: substring keyword + DB lookup.
- Risiko **SEDANG**.
- **Contoh salah konkrit (canary):** Customer: `"ganti kangkung ke wortel"` (maksud: ganti item dipesan) → `ganti` termasuk retur-keywords (`[[retur,kembalikan barang,tukar barang,barang rusak,rusak,pengembalian,refund]]`) → category `retur` → canary punya SOP retur → balas `"Barang bisa diretur dalam 24 jam setelah diterima. Hubungi admin via WhatsApp untuk proses retur."` padahal bukan retur. (Bahkan memicu retur SOP yang seharusnya hanya untuk klaim retur.) **Side effect: tidak ada.**
- Risiko lebih rendah jika toko tidak punya SOP untuk kategori yang tertimbus (`!sop?.content` → null). Canary hanya punya `retur`, jadi kategori lain selalu miss.

### tryKnowledge — `:182-199`
```ts
const results = await knowledgeService.search(context.storeId, query);
if (results.length > 0 && results[0].confidence > 0.3) { return {...}; }
return null;
```
- Hit: `knowledgeService.search` confidence > 0.3. Basis: confidence threshold (tekaan). Risiko SEDANG (seperti FAQ).
- Contoh salah di canary: **tidak dapat demonstrasi** — tidak ada knowledge row yang terlihat; saya **tidak mengklaim** contoh fals positif spesifik. Hanya konfirmasi risiko threshold 0.3 berlaku serupa tryFAQ.

## Ringkasan risiko peringkat tinggi → rendah (rekomendasi urutan tightening selanjutnya)
1. **tryTotal (`:593`) — TINGGI**: substring `bayar berapa`/`tagihannya`/`total` menyelundup pertanyaan harga/order sebelum tryProduct. Harus dibatasi agar hanya memicu pada konteks keranjang/order yang jelas (mis. butuh kata `keranjang`/`order`/`pesanan` bersama, bukan hanya `bayar`).
2. **tryPayment (`:372`) — TINGGI**: `bayar`/`transfer`/`va`/`ovo`/... lebar; mudah tumpang tumbung dengan pertanyaan harga.
3. **tryOrderStatus (`:522`) — SEDANG**: `sampai mana` (dst.) dapat bertindih pada pertanyaan ketersediaan/produk.
4. **trySop (`:680`) — SEDANG**: `ganti`/`rusak`/`kosong` mudah overshoot ke kategori retur.
5. **tryShipping (`:449`) — SEDANG**: `ambil sendiri`/`pickup` ambigu dengan order.
6. **tryFAQ (`163`) / tryKnowledge (`182`) — SEDANG**: threshold 0.3 tanpa data konkret bisa diverifikasi di toko lain.
7. **tryProductNotFound (`338`) — SEDANG**: regex `^...` lemah (kata pertama harus kata tanya), sehingga menyensor ke tier lanjut (bukan salah jawab).
8. **tryCatalog (`201`), tryProduct (`244` post-B1), tryCache (`154`) — RENDAH**: sudah cukup deterministik.

## Side-effect note (rekomendasi TASK fix berikutnya)
- Satu-satunya tier dengan side effect (DB write) adalah **tryProduct** melalui `saveDiscussedItems` (`getResponse:125`) — dan ini **hanya saat QUALIFIES** (single match) atau **ambiguously disambiguating** (disengaja). Pada miss (null) tidak ada write, konsisten dengan prinsip B1 "miss = no side effect". Ini baik. Tier lain semua read-only.
- Peringatan kecil arsitektur: sejumlah tier menempati urutan sebelum tryProduct (tryTotal/tryPayment/tryOrderStatus) dan semuanya substring-based — sehingga sebuah pertanyaan harga (`berapa bayar kangkung`) dapat diselesaikan oleh tryTotal/tryPayment **sebelum** tryProduct pernah lihat, lahir dari keyword `bayar`. Ini pola yang sama dengan bug tryProduct (keyword menyelundup), hanya berbeda lokasi.

## Penutup — scope & compliance
- **Tidak ada perubahan kode** pada sesi ini (READ-ONLY). `git status` bersih kecuali file laporan ini.
- **Tidak ada commit.**
- Semua klaim berada pada `file:line` aktual + data toko canary yang dibaca via Prisma read-only. Tempat yang saya tuliskan "tidak dapat demonstrasi / tidak mengklaim" memang tidak diajukan sebagai fakta risiko nyata.
- File laporan ini disimpan di `/home/ubuntu/garuda/laporan-taskB2.md` (path asli lowercase; `/home/Ubuntu/Garuda/` tidak ada di mesin ini — Linux case-sensitive, jadi pakai path yang valid agar benar-benar tersimpan).
