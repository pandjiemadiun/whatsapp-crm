/**
 * H1 — Seed katalog realistis Bengkel Didik (store-4f4f67bd)
 *
 * Test data untuk skenario chat engine testing. Semua produk didamai dengan
 * prefix [TEST] di nama untuk bulk cleanup.
 *
 * Ketentuan:
 * - 10 products total (8 with weight, 2 SENJA weight=0)
 * - 1 product with variants (Ban Dalam Motor — ukuran 100/90-17, 110/90-17)
 * - Stock bervariasi: 0 (2 produk), 5, 15, 20, 25, 30, 40, 50, 100
 * - 1 produk inactive (Kampas Rem Depan, stock=0)
 * - Cleanup: DELETE FROM products WHERE name LIKE '[TEST]%';
 *             DELETE FROM product_variants WHERE "productId" IN (
 *               SELECT id FROM products WHERE name LIKE '[TEST]%'
 *             );
 */
export const H1_SEED_PRODUCTS = [
  { id: 'prod-ban-dalam-test',  name: '[TEST] Ban Dalam Motor',     price: 50000,  weight: 500,  stock: 100, hasVariants: true,  isActive: true,  variants: [{ sku: 'SKU-BAN-001-V1', attributes: '{"ukuran": "100/90-17"}', price: 50000, stock: 40 }, { sku: 'SKU-BAN-001-V2', attributes: '{"ukuran": "110/90-17"}', price: 55000, stock: 30 }] },
  { id: 'prod-busi-motor-test',  name: '[TEST] Busi Motor',           price: 15000,  weight: 200,  stock: 50,  hasVariants: false, isActive: true },
  { id: 'prod-oli-mesin-test',   name: '[TEST] Oli Mesin 4T 1L',     price: 75000,  weight: 1000, stock: 30,  hasVariants: false, isActive: true },
  { id: 'prod-kampas-depan-test', name: '[TEST] Kampas Rem Depan',   price: 35000,  weight: 150,  stock: 0,   hasVariants: false, isActive: false },
  { id: 'prod-kampas-belakang-test', name: '[TEST] Kampas Rem Belakang', price: 40000, weight: 150, stock: 25, hasVariants: false, isActive: true },
  { id: 'prod-rantai-520-test',  name: '[TEST] Rantai Roller 520',   price: 85000,  weight: 300,  stock: 15,  hasVariants: false, isActive: true },
  { id: 'prod-filter-udara-test', name: '[TEST] Filter Udara Motor', price: 30000,  weight: 100,  stock: 40,  hasVariants: false, isActive: true },
  { id: 'prod-accu-test',        name: '[TEST] Accu Motor 12V 7Ah',  price: 250000, weight: 8000, stock: 5,   hasVariants: false, isActive: true },
  { id: 'prod-spark-plug-test',  name: '[TEST] Spark Plug Standard', price: 12000,  weight: 0,    stock: 20,  hasVariants: false, isActive: true },
  { id: 'prod-bearing-test',     name: '[TEST] Bearing Roda Depan',  price: 28000,  weight: 0,    stock: 0,   hasVariants: false, isActive: true },
];
