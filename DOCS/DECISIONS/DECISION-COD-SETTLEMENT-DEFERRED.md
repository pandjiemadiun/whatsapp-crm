# DECISION LOG ADDENDUM — COD Settlement (G2-F, ditunda)

## Keputusan: COD → paid TIDAK diimplementasikan di G2-F

Konteks: G2-F (Checkout/Order/Payment) memperkenalkan `paymentStatus`
+ Payment Report/Admin Verification untuk `transfer`/`qris`. COD tidak
punya bukti bayar di titik checkout — customer belum membayar apa pun
saat order dibuat, uang baru berpindah tangan ke kurir saat barang
diterima.

Keputusan: `paymentMethod='cod'` TIDAK PERNAH masuk `pending_verification`
dan TIDAK PERNAH otomatis jadi `paid` di scope G2-F. `paymentStatus`
COD tetap `unpaid` selama G2-F berjalan. Endpoint `payment-report` dan
`payment-verify` MENOLAK request untuk order dengan `paymentMethod='cod'`.

Alasan:
- `pending_verification` secara semantik berarti "customer klaim sudah
  bayar, perlu diverifikasi" — tidak berlaku untuk COD sebelum barang
  diterima. Memaksakan status ini ke COD = klaim palsu di data.
- COD settlement (siapa yang boleh ubah COD→paid, kapan, lewat
  mekanisme apa) berkaitan dengan fulfillment/delivery yang BELUM
  punya kontrak arsitektur di project ini. Membuat mekanisme settlement
  sekarang berarti mendesain fulfillment tanpa dasar.
- Sama seperti prinsip P0 structured actions: jangan desain solusi
  untuk kapabilitas yang belum ada (lihat §11 PROJECT-CONTRACT — "Do
  not add fake ... capability").

Siapa yang setuju: owner (Pandjie), Claude.

## 🟡 OPEN ITEM — belum diputuskan, BUKAN bug, perlu keputusan produk

**Bagaimana COD akhirnya menjadi `paid`?**

Dua kandidat desain, BELUM dipilih:
- (A) Admin manual mengubah COD → paid setelah konfirmasi barang
  diterima (mirip pola `PUT /:id/status` sekarang, tapi butuh guard
  eksplisit khusus COD, bukan reuse `payment-verify`).
- (B) Mekanisme fulfillment/delivery terpisah yang mengonfirmasi COD
  paid sebagai bagian dari lifecycle pengiriman.

**TIDAK diimplementasikan di G2-F.** Task terpisah setelah owner
memutuskan, dan setelah ada kejelasan soal fulfillment/delivery
architecture (belum ada di project ini saat ini).
---

## UPDATE 20 Agu 2026 (G2-F6b) — Opsi (A) SEBAGIAN diimplementasi

Opsi (A) dari OPEN ITEM di atas **SEBAGIAN** diwujudkan lewat G2-F6b:

- Endpoint `POST /api/orders/:id/cod-settle` memungkinkan admin **manual**
  menandai `paymentStatus` pesanan COD jadi `paid` (set `paymentVerifiedAt`,
  `verifiedByAdminId` = email auth context). Guard ketat: HANYA jalan kalau
  `paymentMethod==='cod'` DAN `paymentStatus==='unpaid'`, selain itu 400.
- Dashboard mendapat halaman **terpisah** "COD" (di samping "Verifikasi
  Pembayaran") dengan tab **Belum Lunas** (`unpaid`) vs **Sudah Lunas**
  (`paid`) supaya merchant langsung tahu mana yang perlu ditagih ke kurir
  vs sudah beres. Tombol "Tandai Lunas" memanggil `cod-settle`.

**YANG TETAP DEFERRED (belum diimplementasi):**
- Integrasi ke `orderStatus` / fulfillment. `cod-settle` **SENGAJA tidak
  memanggil `transitionOrder()`** — `orderStatus` tidak berubah sama sekali.
  Admin tetap lanjutkan order via `PUT /:id/status` secara terpisah kalau
  perlu. Keputusan produk soal "kapan COD otomatis mengubah orderStatus"
  belum diambil.
- Opsi (B) — mekanisme fulfillment/delivery terpisah yang mengonfirmasi COD
  `paid` sebagai bagian dari lifecycle pengiriman — **TETAP belum ada**, dan
  tetap butuh keputusan arsitektur terpisah kalau nanti dibutuhkan.

Kesimpulan: settlement COD kini bisa dicatat manual oleh admin (visibility +
aksi eksplisit), tapi otomatisasi/transisi status order tetap deferred
sesuai keputusan awal.

## UPDATE 2026-08-20 — Opsi (B) RESMI DITUTUP (bukan deferred lagi)

Konteks: owner mengevaluasi integrasi RajaOngkir (shipping cost API) sebagai
kandidat mekanisme Opsi (B) — TERNYATA TIDAK RELEVAN. RajaOngkir adalah
kalkulator ongkir (harga kirim), BUKAN pelacak status pengiriman/konfirmasi
barang diterima. Fitur lacak resi (waybill tracking) yang bisa memberi
sinyal "barang sampai" adalah kapabilitas TERPISAH yang butuh integrasi
nomor resi per order + polling/webhook — scope besar, TIDAK ADA rencana
sekarang.

Keputusan: Opsi (B) (mekanisme fulfillment/delivery otomatis konfirmasi
COD paid) RESMI DITUTUP untuk saat ini — bukan "menunggu keputusan", tapi
"tidak ada jalur teknis yang sudah tersedia/direncanakan untuk itu". Kalau
nanti ada rencana integrasi lacak resi kurir, ini dibuka kembali sebagai
task terpisah.

Opsi (A) (admin manual tandai lunas, `cod-settle` endpoint) TETAP dan
DIKUNCI sebagai satu-satunya mekanisme settlement COD.

Siapa yang setuju: owner (Pandjie), Claude.
