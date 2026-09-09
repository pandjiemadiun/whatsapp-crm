# ROLLBACK-RUNBOOK-V2-ACTIVE-MODE.md

**Store:** store-a3cd7205 (bengkel-didik-test)  
**Tujuan:** Runbook rollback 1 halaman untuk revert dari active mode ke shadow mode, terverifikasi dari kode aktual.  
**Tanggal:** 9 Sep 2026  

---

## 1. Mekanisme Flag Engine Per-Toko

### 1.1 Redis Key Format

**Key:** `store:${storeId}:engine`  
**Value (JSON):**
```json
{
  "storeId": "store-a3cd7205",
  "engine": "v1" | "v2",
  "enabledAt": "2026-09-09T03:00:00.000Z",
  "canaryStartDate": "2026-09-09T03:00:00.000Z"
}
```

**Default:** `v1` jika key tidak ada atau expired.  
**TTL:** 3600 detik (1 jam) — diset oleh `redisAdapter.setex(key, ttlSeconds, JSON.stringify(value))` di `engine-config.ts:38` via `redis.adapter.ts:58`. Setelah TTL expire, key hilang dan `getStoreEngine` return `v1` (default).

### 1.2 Command Redis CLI PERSIS

```bash
# READ flag saat ini
redis-cli GET store:store-a3cd7205:engine

# WRITE: flip ke active (v2)
redis-cli SET store:store-a3cd7205:engine '{"storeId":"store-a3cd7205","engine":"v2","enabledAt":"2026-09-09T04:00:00.000Z","canaryStartDate":"2026-09-09T04:00:00.000Z"}'

# WRITE: revert ke shadow (v1)
redis-cli SET store:store-a3cd7205:engine '{"storeId":"store-a3cd7205","engine":"v1","enabledAt":"2026-09-09T04:00:00.000Z","canaryStartDate":null}'
```

**Via Admin API (alternative, super_admin only):**
```bash
# GET current config
curl -H "Authorization: Bearer <ADMIN_TOKEN>" http://localhost:PORT/api/admin/engine/store-a3cd7205

# POST set engine
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"engine":"v2"}' http://localhost:PORT/api/admin/engine/store-a3cd7205
```

### 1.3 Apakah butuh pm2 restart?

**TIDAK.** Flag dibaca fresh dari Redis pada SETIAP pesan masuk:

`conversation.service.ts:129`:
```ts
const engine = await getStoreEngine(storeId);
```

`getStoreEngine` (`engine-config.ts:19-23`) memanggil `redisAdapter.get()` langsung — tidak ada application-level cache. Perubahan flag生效 di request berikutnya secara langsung.

**Catatan TTL:** Karena `redisAdapter.set` menggunakan default TTL 3600 detik, key akan expire setelah 1 jam jika tidak di-refresh. Jika key expired, flag revert ke default `v1`. Untuk canary active mode, pastikan TTL tidak kadaluarsa dengan periodic refresh, atau set TTL lebih panjang via direct Redis command:

```bash
# Set dengan TTL 7 hari (604800 detik)
redis-cli SETEX store:store-a3cd7205:engine 604800 '{"storeId":"store-a3cd7205","engine":"v2","enabledAt":"2026-09-09T04:00:00.000Z","canaryStartDate":"2026-09-09T04:00:00.000Z"}'
```

---

## 2. Mid-Conversation Flip Behavior

### 2.1 Apa yang terjadi saat flag di-flip di tengah percakapan?

**Konfirmasi dari kode:**

1. **Flag dibaca per-message** (`conversation.service.ts:129`) — tidak ada session-level cache. Flip flag = effect on next message immediately.

2. **V2 writes to canonical state** (`canonical-context.service.ts:841-870`):
   - `workspace_v2` (JSON column di `conversation_context`) adalah canonical state
   - V2 engine menulis `draft_cart` + canonical fields (pendings, resolved_facts, intent, dll) ke `workspace_v2`

3. **V1 can read V2 state** (`canonical-context.service.ts:724-750`):
   ```ts
   async getCanonicalWithLegacyFallback(conversationId: string): Promise<CanonicalConversationState | null> {
     const row = await prisma.conversationContext.findUnique({
       where: { conversationId },
       select: { workspace_v2: true, extractedEntities: true },
     });
     // 1. Canonical state: workspace_v2 ada isi
     if (row.workspace_v2 !== null && row.workspace_v2 !== undefined && row.workspace_v2 !== '') {
       return loadCanonical(row.workspace_v2);
     }
     // 2. Legacy fallback: extractedEntities
     if (row.extractedEntities !== null && row.extractedEntities !== undefined) {
       return fromLegacyExtractedEntities(row.extractedEntities, adapters.logger);
     }
     // 3. Default state
     return { ...DEFAULT_CANONICAL_STATE };
   }
   ```

**Kesimpulan:** Jika flag di-flip dari v2 ke v1 di tengah percakapan:
- V1 akan baca `workspace_v2` yang ditulis oleh V2 (canonical state)
- V1 bisa memahami canonical fields (pendings, resolved_facts, intent, dll)
- **V2-specific transient `draft_cart`** ada di `workspace_v2` JSON tapi TIDAK merupakan canonical cart — V1 tidak akan menggunakannya sebagai authoritative cart (CartAuthority tetap owner cart via OrderItem rows)
- Cart state (OrderItem) tetap aman karena disimpan di tabel terpisah (`Order` + `OrderItem`), bukan di `workspace_v2`

### 2.2 Kompatibilitas v2 mutation state (workspace_v2, draft_cart) dibaca balik oleh v1

| State | Lokasi | V1 bisa baca? | Catatan |
|-------|--------|---------------|---------|
| Canonical fields (pendings, resolved_facts, intent, conversation_summary) | `workspace_v2` JSON | **YA** | Via `getCanonicalWithLegacyFallback()` |
| `draft_cart` (V2-specific transient) | `workspace_v2` JSON | **TIDAK DIKETAHUI** | V1 tidak punya logic untuk interpret `draft_cart`; treated as opaque JSON |
| Cart items (OrderItem rows) | Tabel `order_items` | **YA** | CartAuthority = single source of truth, independent dari engine flag |
| Order status | Tabel `orders` | **YA** | V1 baca via `activeOrder`/`tryTotal` fallback logic |

**Rekomendasi:** Jika mid-conversation flip diperlukan, monitor percakapan yang sedang aktif untuk pastikan V1 tidak crash saat membaca `workspace_v2` yang berisi `draft_cart`. Saat ini tidak ada known issue, tapi `draft_cart` adalah field baru yang V1 tidak di-design untuk memahaminya.

---

## 3. Command PERSIS untuk Flip dan Revert

### 3.1 Flip ke Active Mode (v2)

```bash
# Via Redis CLI (langsung)
redis-cli SET store:store-a3cd7205:engine '{"storeId":"store-a3cd7205","engine":"v2","enabledAt":"2026-09-09T04:00:00.000Z","canaryStartDate":"2026-09-09T04:00:00.000Z"}'

# Via Admin API (super_admin only, butuh auth token)
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"engine":"v2"}' http://localhost:PORT/api/admin/engine/store-a3cd7205
```

### 3.2 Revert ke Shadow Mode (v1)

```bash
# Via Redis CLI (langsung)
redis-cli SET store:store-a3cd7205:engine '{"storeId":"store-a3cd7205","engine":"v1","enabledAt":"2026-09-09T04:00:00.000Z","canaryStartDate":null}'

# Via Admin API (super_admin only, butuh auth token)
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"engine":"v1"}' http://localhost:PORT/api/admin/engine/store-a3cd7205
```

### 3.3 Verifikasi

```bash
# Cek flag saat ini
redis-cli GET store:store-a3cd7205:engine

# Via API
curl -H "Authorization: Bearer <ADMIN_TOKEN>" http://localhost:PORT/api/admin/engine/store-a3cd7205
```

---

## 4. Checklist "Kapan Harus Rollback"

Gejala konkret yang DIDAPAT dari bug patterns yang sudah pernah terjadi di BUG-BELUM-DIBERESKAN.md dan RAILS.md:

### 4.1 Critical — Rollback Immediately

| # | Gejala | Sumber Bug Pattern |
|---|--------|-------------------|
| 1 | **ADD_TO_CART salah item** — item yang tidak dimaksud customer masuk keranjang (wrong-item-removed pattern) | BUG-BELUM-DIBERESKAN §partial_cart_cancel; RAILS 10 Agu P4.2 |
| 2 | **Harga tidak dari DB** — harga cart tidak cocok dengan harga katalog (LLM price hallucination) | BUG-BELUM-DIBERESKAN §I-13; RAILS §2 P2 Truth Boundary |
| 3 | **Silent ADD_TO_CART tanpa eksekusi** — aksi berhasil tapi tidak ada OrderItem di DB | RAILS 9 Agu 2026 TASK C1; BUG-BELUM-DIBERESKAN §silent-ADD |
| 4 | **False cancel/order status berubah tanpa konfirmasi** — percakapan normal tiba-tiba batal order | RAILS 9 Agu P1 B3; BUG-BELUM-DIBERESKAN §false-cancel |
| 5 | **Cross-tenant data leak** — data toko lain muncul di percakapan/store ini | BUG-BELUM-DIBERESKAN §C1 IDOR; RAILS 30–31 Agu tenant isolation |

### 4.2 High — Pertimbangkan Rollback

| # | Gejala | Sumber Bug Pattern |
|---|--------|-------------------|
| 6 | **Keyword collision / jawaban salah tier** — "berapa bayar X" jawab "keranjang kosong" atau daftar metode bayar | RAILS 9 Agu TASK B3; BUG-BELUM-DIBERESKAN §fast-path |
| 7 | **Reply terpotong tidak lengkap** — balasan bot putus di tengah kalimat | RAILS 10 Agu P5.1; BUG-BELUM-DIBERESKAN §I-2 |
| 8 | **Qty 0 muncul di receipt/cart** — item dengan qty=0 ditampilkan | RAILS 10 Agu P5.1; BUG-BELUM-DIBERESKAN §I-1a |
| 9 | **Kesalahan intent classification** — "mau beli X" diinterpretasikan sebagai pertanyaan harga atau cancel | RAILS 9 Agu TASK B1; keyword collision "ram"⊂"Brambang" |
| 10 | **Double mutation cart** — order item ter-create dua kali untuk 1 pesan | RAILS §2 P0 safety boundary; BUG-BELUM-DIBERESKAN §double-mutation |

### 4.3 Medium — Monitor, Jangan Langsung Rollback

| # | Gejala | Sumber Bug Pattern |
|---|--------|-------------------|
| 11 | **V2 shadow log menunjukkan divergensi besar** — V2 output sangat berbeda dari V1 untuk kasus yang seharusnya sama | RAILS P3 shadow mode design |
| 12 | **Cart state hilang/tidak konsisten** — draft cart tidak bisa di-resume, atau order status lompat ke status yang tidak valid | RAILS P4.2; canonical state compatibility |
| 13 | **Error rate naik drastis** — 5xx/exception di log untuk request yang seharusnya normal | General monitoring indicator |

---

## 5. Konfirmasi: Dummy Store — Tidak Butuh Migrasi Data

**store-a3cd7205 adalah toko dummy/test** (bukan merchant asli/produksi).

- Semua data di toko ini adalah data uji yang di-seed untuk testing
- Rollback hanya perlu revert flag Redis — TIDAK ada migrasi data customer nyata yang perlu di-pertimbangkan
- Cart state (OrderItem) bisa di-reset via cleanup script jika diperlukan, tapi ini opsional untuk test environment
- Tidak ada compliance/legal implication karena tidak ada data PII customer asli

**Jika setelah rollback ingin bersihkan state test:**
```bash
# Hapus semua order item + order + conversation untuk conversation tertentu
redis-cli SET store:store-a3cd7205:engine '{"storeId":"store-a3cd7205","engine":"v1","enabledAt":"2026-09-09T04:00:00.000Z","canaryStartDate":null}'
# Lalu jalankan cleanup script untuk hapus test conversations/orders
```

---

## 6. Prosedur Rollback Step-by-Step

### 6.1 Rollback Cepat (1 menit)

```bash
# 1. Revert flag
redis-cli SET store:store-a3cd7205:engine '{"storeId":"store-a3cd7205","engine":"v1","enabledAt":"2026-09-09T04:00:00.000Z","canaryStartDate":null}'

# 2. Verifikasi
redis-cli GET store:store-a3cd7205:engine
# Expected: {"storeId":"store-a3cd7205","engine":"v1",...}

# 3. Test ping — kirim pesan ke toko, pastikan balasan dari V1
curl -X POST http://localhost:PORT/api/pwa/store-a3cd7205/message \
  -H "Content-Type: application/json" \
  -d '{"customerId":"test-cust","conversationId":"test-conv","message":"halo","messageId":"rollback-test"}'
```

### 6.2 Rollback dengan Cleanup State

```bash
# 1. Revert flag (langkah 6.1)
redis-cli SET store:store-a3cd7205:engine '{"storeId":"store-a3cd7205","engine":"v1","enabledAt":"2026-09-09T04:00:00.000Z","canaryStartDate":null}'

# 2. Hapus test conversations + orders + order items
# (gunakan cleanup script yang ada, atau manual DELETE sesuai pattern GAP1-FIX)

# 3. Verifikasi count = 0
# 4. Test ping seperti 6.1
```

### 6.3 Post-Rollback Checklist

- [ ] Flag terverifikasi = `v1` via Redis CLI
- [ ] Test ping return response dari V1 engine
- [ ] Log tidak ada error baru setelah rollback
- [ ] Jika ada gejala critical dari §4.1, dokumentasi incident + root cause sebelum melanjutkan

---

## 7. Catatan Penting

1. **Tidak ada migration data** — store-a3cd7205 adalah dummy store, semua data adalah test data
2. **Flag tidak butuh restart** — dibaca per-request dari Redis
3. **TTL 1 jam** — jika menggunakan `SET` biasa, key akan expire setelah 1 jam. Gunakan `SETEX` dengan TTL lebih panjang untuk canary active mode
4. **Shadow wiring terpisah** — `chatEngine.v2Mode` system setting ('shadow'/'active'/'off') mengontrol apakah V2 shadow call dijalankan PARALEL dengan V1. Ini BERBEDA dari engine flag. Saat active mode, `v2Mode` sebaiknya diset ke 'active' agar shadow wiring tidak makan resource:
   ```bash
   # Set system setting (via ConfigService atau direct DB)
   # chatEngine.v2Mode = 'active'
   ```
5. **Mid-conversation flip aman untuk cart state** — OrderItem rows tidak terpengaruh oleh engine flag. CartAuthority tetap authoritative.
