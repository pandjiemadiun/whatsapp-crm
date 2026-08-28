# QloBot Project Contract — Product Variants

**Status:** LOCKED (P0-P3a/b implemented; P2 display in progress)
**Scope:** Product variants (size/warna/dst) + koneksi ke magic-paste

## Catatan penting: file ini baru masuk repo 28 Agu 2026

File ini sebelumnya hanya ada sebagai referensi kerja (project knowledge),
BELUM pernah di-commit ke repo. Isi di bawah adalah versi final dengan
§2.1 sudah diamandemen berdasarkan implementasi nyata yang sudah live
(PV-P0 s/d PV-P2b) — bukan draft asli lagi.

## AMANDEMEN §2.1 (28 Agu 2026): ProductVariant TIDAK punya deletedAt

Ditemukan saat verifikasi PV-P2b: skema `ProductVariant` aktual (migration
`20260823154014_add_product_variants`) TIDAK memiliki kolom `deletedAt`,
berbeda dari draft awal yang mengasumsikan pola sama seperti `Product`
(isActive + deletedAt terpisah).

Konfirmasi dari kode nyata:
- Delete varian dari dashboard admin (`variants.ts` DELETE handler →
  `productService.deleteVariant()`) melakukan **hard delete**
  (`prisma.productVariant.delete`), BUKAN soft-delete.
- Satu-satunya status flag varian adalah `isActive` (Boolean).
- Kalau semua varian sebuah produk dihapus, `Product.hasVariants` di-set
  `false` otomatis.

Keputusan: kontrak diamandemen — `ProductVariant` TIDAK akan punya
`deletedAt`. `isActive` tetap satu-satunya mekanisme "nonaktifkan".
Kalau soft-delete/reaktivasi varian dibutuhkan di masa depan, itu adalah
perubahan skema + keputusan produk terpisah, bukan bagian kontrak ini.

## Schema ProductVariant (final, sesuai implementasi nyata)

```prisma
model ProductVariant {
  id          String   @id @default(uuid())
  productId   String
  product     Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  storeId     String
  sku         String?
  attributes  Json
  price       Float
  stock       Int?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  orderItems  OrderItem[]

  @@unique([storeId, sku])
  @@index([productId])
  @@map("product_variants")
}
```

## Status implementasi (per 28 Agu 2026)

- PV-P0 — Schema foundation: SELESAI (`35836b3`)
- PV-P1 — CartAuthority variant-aware dedup: SELESAI (`d3b9742`)
- PV-P2 — ADD_TO_CART variantId + VARIANT_REQUIRED: SELESAI (`4c2e4f2` + fix `a314ce4`)
- PV-P3a/b — Dashboard admin CRUD varian: SELESAI (`50f906d`, `70912a8`)
- PV-P2a — Backend display data shape (enrichProduct + hasVariants): SELESAI (`80cf3bf`)
- PV-P2b — PWA selector UI + cart display: SELESAI (commit pending di task ini)
- PV-P2c — WA text representation (composer-v2.ts, fallback.service.ts): BELUM DIKERJAKAN
- PV-P3 (magic-paste variant extraction): BELUM DIKERJAKAN, sesuai urutan
  kontrak dikerjakan PALING TERAKHIR setelah P0-P2 stabil.
