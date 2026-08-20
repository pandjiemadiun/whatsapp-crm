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