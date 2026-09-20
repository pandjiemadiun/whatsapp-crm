# Rollback Runbook — V2 Active Mode Flip (store-a3cd7205)

**Store:** store-a3cd7205 (bengkel.didik.test)
**Tujuan:** Runbook rollback untuk flip store-a3cd7205 dari shadow ke active mode,
serta prosedur revert. **Semua command diverifikasi dari kode aktual — bukan asumsi.**

**Status saat ini (verified):**
- Global flag `chatEngine.v2Mode = 'shadow'` (system_settings, DB)
- Per-store Redis key `store:store-a3cd7205:engine` **tidak ada** (TTL=-2) → store
  default ke V1 engine; V2 shadow observer aktif hanya untuk store ini.

---

## 1. Mekanisme Flag — Verbatim dari Kode

### 1.1 Per-store engine flag (Redis)

**Sumber:** `apps/api/src/services/chat/engine-config.ts:12`

```typescript
const getStoreKey = (storeId: string) => `store:${storeId}:engine`;

export async function getStoreEngine(storeId: string): Promise<EngineVersion> {
  const redisAdapter = await getRedis();
  const config = await redisAdapter.get<StoreEngineConfig>(getStoreKey(storeId));
  return config?.engine || 'v1';     // ← default 'v1' bila key tidak ada
}
```

- **Redis key:** `store:store-a3cd7205:engine` (pattern: `store:${storeId}:engine`)
- **Format value:** JSON `{"storeId":"...","engine":"v1"|"v2","enabledAt":"<ISO>","canaryStartDate":"<ISO>"}`
- **Default:** `'v1'` bila key tidak ada (`.ts:22`)
- **In-process cache:** TIDAK ADA — `getStoreEngine()` baca Redis fresh per request
- **Dipanggil dari:** `conversation.service.ts:129` → `if (engine === 'v2') { /* V2 path */ }`

**`redisAdapter.set()` TTL default:** `apps/api/src/adapters/cache/redis.adapter.ts:56`
```typescript
async set<T>(key: string, value: T, ttlSeconds: number = 3600): Promise<void> {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
}
```
- Default TTL = **3600 detik (1 jam)**. `setStoreEngine()` tidak override → key expire 1 jam.
- Reference key yang sudah ada (store-f7140b5c): `redis-cli TTL` → `-1` (no expiration, persisten).

### 1.2 Global V2-mode flag (PostgreSQL system_settings)

**Sumber:** `apps/api/src/services/chat/v2-engine/shadow-wiring.ts:34,44-51`

```typescript
export const V2_MODE_FLAG_KEY = 'chatEngine.v2Mode';
export type V2Mode = 'off' | 'shadow' | 'active';

async function getV2Mode(): Promise<V2Mode> {
  const value = await configService.getConfig(V2_MODE_FLAG_KEY);
  if (value === 'shadow' || value === 'active') return value;
  return 'off';
}
```

- **DB table:** `system_settings`, key = `chatEngine.v2Mode`
- **Format value:** plain string `'off' | 'shadow' | 'active'` (bukan JSON)
- **Nilai saat ini:** `'shadow'` (verified via SQL)
- **Cache:** 5 menit via `ConfigService.CACHE_TTL = 5 * 60 * 1000` (`config.service.ts:11`)
- **Cache invalidation:** `configService.setConfig()` → `this.cache.delete(key)` (`config.service.ts:107`)
  — langsung. Raw SQL perubahan **tidak** invalidate cache → butuh
  `POST /api/admin/config/reload-cache` atau tunggu ≤5 menit.

**`fireShadowV2Call` hanya jalan bila** `shadow-wiring.ts:97,100`:
```typescript
if (v2Mode !== 'shadow') return;        // 'off' atau 'active' → skip
if (storeId !== SHADOW_STORE_ID) return; // hanya untuk store-a3cd7205
```
`SHADOW_STORE_ID = 'store-a3cd7205'` (`shadow-wiring.ts:31`).

> **Catatan stal:** Komentar di `shadow-wiring.ts:306` dan `:286` menyebut
> "store-4f4f67bd" — itu **stale**. Kode aktual pakai `'store-a3cd7205'`.

### 1.3 Dua flag berperan berbeda

| Flag | Storage | Dibaca oleh | Efek | In-process cache? |
|---|---|---|---|---|
| `store:${storeId}:engine` | Redis (JSON) | `getStoreEngine()` → `conversation.service.ts:129` | `engine==='v2'` → V2 primary; else V1 | **TIDAK** (fresh per request) |
| `chatEngine.v2Mode` | PostgreSQL `system_settings` | `getV2Mode()` → `shadow-wiring.ts:97` | `'shadow'` → V2 shadow observer ON; `'active'`/`'off'` → OFF | 5 menit (ConfigService) |

---

## 2. Command PERSIS — Flip ke Active

### Option A: Via Redis CLI (langsung, no restart)

```bash
# 1. Baca flag saat ini
redis-cli GET store:store-a3cd7205:engine

# 2. Flip ke active (v2) — gunakan SETEX dengan TTL untuk canary safety
#    TTL 3600s = 1 jam (auto-revert jika tidak di-refresh)
#    Atau gunakan SETEX 604800 (7 hari) untuk canary lebih lama
redis-cli SETEX store:store-a3cd7205:engine 604800 \
  '{"storeId":"store-a3cd7205","engine":"v2","enabledAt":"2026-09-09T08:52:52.000Z","canaryStartDate":"2026-09-09T08:52:52.000Z"}'

# 3. (Opsional) Matikan V2 shadow observer — sudah tidak perlu karena V2 aktif
psql "$DATABASE_URL" -c \
  "UPDATE system_settings SET value = 'active' WHERE key = 'chatEngine.v2Mode';"

# 4. (Opsional) Invalidate config cache agar perubahan DB langsung ke semua process
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.qlobot.web.id/api/admin/config/reload-cache
```

### Option B: Via Admin API

```bash
# 1. Set per-store engine ke v2 (super_admin)
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"engine":"v2"}' \
  https://api.qlobot.web.id/api/admin/engine/store-a3cd7205

# 2. Set global chatEngine.v2Mode ke 'active' (super_admin)
curl -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":"active","category":"feature_flag"}' \
  https://api.qlobot.web.id/api/admin/config/chatEngine.v2Mode

# 3. Reload cache (opsional, pastikan semua instance pick up)
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.qlobot.web.id/api/admin/config/reload-cache
```

> **API routes** (`apps/api/src/index.ts:152,145`):
> - `POST /api/admin/engine/:storeId` → `adminAuthMiddleware` + `requireAdminRole(['super_admin'])`
> - `PUT /api/admin/config/:key` → `adminAuthMiddleware` + `requireAdminRole(['super_admin'])`
> - Auth: Bearer token via `adminAuthToken` table (email + role verified)

---

## 3. Command PERSIS — Revert ke Shadow (Rollback)

```bash
# 3a. Via Redis CLI (langsung)
#    Hapus key → auto default ke 'v1' (cepat)
redis-cli DEL store:store-a3cd7205:engine

#    ATAU: set eksplisit ke v1 (persist, no TTL)
redis-cli SET store:store-a3cd7205:engine \
  '{"storeId":"store-a3cd7205","engine":"v1","enabledAt":"2026-09-05T04:34:58.000Z"}'

#    ATAU: set ke v1 dengan TTL 1 jam (auto-cleanup)
redis-cli SETEX store:store-a3cd7205:engine 3600 \
  '{"storeId":"store-a3cd7205","engine":"v1","enabledAt":"2026-09-05T04:34:58.000Z"}'

# 3b. Kembalikan global flag ke 'shadow'
psql "$DATABASE_URL" -c \
  "UPDATE system_settings SET value = 'shadow' WHERE key = 'chatEngine.v2Mode';"

# 3c. Invalidate config cache (WAJITU — karena perubahan via SQL)
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.qlobot.web.id/api/admin/config/reload-cache

# 3d. Via Admin API (alternatif)
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"engine":"v1"}' \
  https://api.qlobot.web.id/api/admin/engine/store-a3cd7205

curl -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":"shadow","category":"feature_flag"}' \
  https://api.qlobot.web.id/api/admin/config/chatEngine.v2Mode
```

### Verifikasi setelah rollback

```bash
# Per-store flag
redis-cli GET store:store-a3cd7205:engine        # expect: {"engine":"v1",...} atau (empty)
redis-cli TTL store:store-a3cd7205:engine          # expect: -2 (deleted) atau -1 (no expire)

# Global flag
psql "$DATABASE_URL" -t -c "SELECT value FROM system_settings WHERE key = 'chatEngine.v2Mode';"
# expect: shadow
```

---

## 4. Apakah Butuh Restart?

**TIDAK.**

- **Per-store flag:** `getStoreEngine()` membaca Redis fresh per request — tidak ada
  in-process cache (`engine-config.ts:19-23`). Efek langsung pada request berikutnya.
- **Global flag:** 5-min cache via ConfigService. Perubahan via admin API (`setConfig`)
  **langsung invalidate** cache (`config.service.ts:107`). Perubahan via raw SQL perlu
  `reload-cache` API atau tunggu ≤5 menit.
- **pm2 `instances: 1`** (`ecosystem.config.js:7`) — single instance, tidak ada
  multi-instance cache desync.

---

## 5. Mid-Conversation Flip — State Compatibility (verified from code)

### V2 engine routing

`conversation.service.ts:129-131`:
```typescript
const engine = await getStoreEngine(storeId);
if (engine === 'v2') { /* V2 path */ }
// ── Fall through ke V1 logic ──
```

### V2→V1 fallback (circuit breaker)

`conversation.service.ts:388-398`:
```typescript
} catch (err) {
  // CIRCUIT BREAKER: fallback ke v1
  adapters.logger.error('Engine v2 failed, fallback to v1', { storeId, conversationId, error: ... });
  // Fall through ke logic v1 di bawah
}
// ── LOGIC V1 EXISTING (tidak diubah) ──
```

**Two failure paths:**
1. **V2 throw sebelum mutation** (`v2MutationExecuted === false`): outer catch →
   **fallback ke V1** (V1 logic tetap jalan).
2. **V2 throw setelah mutation** (`v2MutationExecuted === true` — `conversation.service.ts:393`):
   **TIDAK fallback ke V1** → return safe-reply:
   > "Baik kak, pesanan Kakak sudah kami catat. Silakan ketik *total* atau
   > *cek pesanan* untuk melihat ringkasan ya. 🙏"
   (buildSafeReply, `conversation.service.ts:147`)

### V1 CAN read V2-written state (verified)

`canonicalConversationStateService.getCanonicalWithLegacyFallback()` (`canonical-context.service.ts:724`):
```typescript
// Priority: workspace_v2 → extractedEntities → default
if (row.workspace_v2 !== null && row.workspace_v2 !== '' && ...) {
    return loadCanonical(row.workspace_v2);  // ← V1 reads V2-written canonical state
}
if (row.extractedEntities !== null && ...) {
    return fromLegacyExtractedEntities(row.extractedEntities, ...);  // ← legacy V1 fallback
}
```

**State compatibility matrix:**

| State | Lokasi | V1 baca? | Catatan |
|---|---|---|---|
| Canonical fields (pendings, resolved_facts, intent, conversation_summary) | `workspace_v2` JSON | **YA** | Via `getCanonicalWithLegacyFallback()` |
| `draft_cart` (V2-specific transient) | `workspace_v2` JSON | Dilewati | V1 tidak punya logic untuk `draft_cart`; CartAuthority = cart authority |
| Cart items (OrderItem) | Tabel `order_items` | **YA** | CartAuthority single source, independent dari engine flag |
| Order status | Tabel `orders` | **YA** | V1 baca via `activeOrder`/`tryTotal` |

**Kesimpulan:** Revert dari V2 ke V1 mid-conversation **aman**. V1 membaca
canonical state dari `workspace_v2` yang ditulis V2. `draft_cart` (V2-specific)
diabaikan V1 — V1 pakai CartAuthority. Tidak ada migrasi data yang diperlukan.

---

## 6. Dummy Store — Tidak Butuh Migrasi Data

**Verifikasi DB (query live, store-a3cd7205):**

| Tabel | Count | Keterangan |
|---|---|---|
| `orders` | **0** | Tidak ada order |
| `store_documents` | **0** | Tidak ada TOS/SOP |
| `conversations` | 284 | Data percakapan (read-only, boleh dibiarkan) |
| `v2_shadow_logs` | 464 | Log shadow (read-only, boleh dibiarkan) |
| `store` | 1 | Store itself (bengkel.didik.test) |
| Redis `store:store-a3cd7205:engine` | **tidak ada** | TTL=-2 (key absent) |

**Rollback cukup revert flag** — tidak ada data customer nyata yang perlu di-migrasi.
`v2_shadow_logs` adalah read-only log, tidak dibaca kembali oleh engine.

---

## 7. Checklist — Kapan Harus Rollback

Gejala yang **pernah terjadi** — diambil verbatim dari
`BUG-BELUM-DIBERESKAN.md` + kode aktual:

### 7.1 Critical — Rollback Secepatnya

| # | Gejala | Sumber kode / BUG file |
|---|---|---|
| 1 | **Harga tidak dari DB** — harga cart tidak cocok katalog; LLM price hallucination | VIII-A: `executeOps` price bug + `resolvePriceAndStock` tx-consistency, commit `4c2e4f2` (BUG-BELUM-DIBERESKAN.md:175) |
| 2 | **qty≤0 di subtotal** — item dengan kuantitas 0 masuk perhitungan total | BUG-03/04: `fallback.service.ts:717` filters before subtotal (BUG-BELUM-DIBERESKAN.md:134) |
| 3 | **Safe-reply triggered setelah mutation** — customer dapat "Baik kak, pesanan Kakak sudah kami catat..." | `conversation.service.ts:147` buildSafeReply + `v2MutationExecuted` guard (BUG-BELUM-DIBERESKAN.md:137, B6 RACE-01/02) |
| 4 | **Double cart mutation** — order item ter-create 2x untuk 1 pesan | B6: `atomicCas` + `ActionIdempotency` guard (BUG-BELUM-DIBERESKAN.md:137) |
| 5 | **Cross-tenant leak** — data toko lain muncul di conversation ini | IX-A tenant isolation (BUG-BELUM-DIBERESKAN.md:168, commit `b64babf`) |

### 7.2 High — Pertimbangkan Rollback

| # | Gejala | Sumber |
|---|---|---|
| 6 | **V2 engine crash/exception berulang** — log "Engine v2 failed, fallback to v1" sering | `conversation.service.ts:391` |
| 7 | **V2 shadow call persistent error** — log "V2 shadow call failed (non-blocking)" | `shadow-wiring.ts:166` |
| 8 | **Fallback tier overlap** — V2 memanggil fallback tier V1/V2 dalam urutan salah | III-4: P3 T5 fallback tier overlap, commit `5e7ef42` (BUG-BELUM-DIBERESKAN.md:206) |
| 9 | **Structured action tidak echo** — tap tombol tapi tidak ada konfirmasi di conversation_history | Kontrak §0.5 |
| 10 | **V2ShadowLog banyak mismatch** — V2 output konsisten berbeda dari V1 baseline | `v2_shadow_logs` query (lihat §9) |

### 7.3 Quick Verification Queries

```bash
# Cek V2 error rate di shadow log
psql "$DATABASE_URL" -t -c "
SELECT COUNT(*) as total,
       COUNT(*) FILTER (WHERE v2_output::text LIKE '%\"error\"%' OR v2_output::text LIKE '%\"success\":false%') as errors
FROM v2_shadow_logs WHERE store_id = 'store-a3cd7205';
"

# Cek per-store flag
redis-cli GET store:store-a3cd7205:engine

# Cek global flag
psql "$DATABASE_URL" -t -c "SELECT value FROM system_settings WHERE key = 'chatEngine.v2Mode';"
```

---

## 8. Post-Rollback Verification Checklist

- [ ] `redis-cli GET store:store-a3cd7205:engine` → expect `{"engine":"v1",...}` atau kosong
- [ ] `psql -c "SELECT value FROM system_settings WHERE key='chatEngine.v2Mode';"` → expect `shadow`
- [ ] Test ping ke store-a3cd7205 → respons dari V1 engine (bukan safe-reply V2)
- [ ] Log: tidak ada "Engine v2 failed" setelah rollback +5 menit
- [ ] Log: shadow observer berjalan kembali (V2ShadowLog baru tercatat)

---

## 9. Fact Record (verbatim checksums)

| Item | Nilai | Sumber |
|---|---|---|
| Redis key pattern | `store:${storeId}:engine` | `engine-config.ts:12` |
| Default engine | `'v1'` (`config?.engine \|\| 'v1'`) | `engine-config.ts:22` |
| redisAdapter.set default TTL | `3600` detik | `redis.adapter.ts:56` |
| Global flag DB key | `chatEngine.v2Mode` | `shadow-wiring.ts:34` |
| Global flag value format | plain string `'off'\|'shadow'\|'active'` | `shadow-wiring.ts:46-48` |
| ConfigService CACHE_TTL | `5 * 60 * 1000` ms | `config.service.ts:11` |
| Config cache invalidation | `setConfig` → `this.cache.delete(key)` | `config.service.ts:107` |
| getStoreEngine in-process cache | **TIDAK ADA** | `engine-config.ts:19-23` |
| `isCanaryActive()` production callers | **TIDAK ADA** (hanya test) | `engine-config.ts:41` |
| `SHADOW_MODE` env di `.env` | **Tidak diset** | grep result kosong |
| V2→V1 fallback (pre-mutation) | outer catch → fall through ke V1 | `conversation.service.ts:390-398` |
| V2→V1 guard (post-mutation) | `v2MutationExecuted` → safe-reply | `conversation.service.ts:393-397` |
| V1 baca V2 state | `getCanonicalWithLegacyFallback`: workspace_v2 → extractedEntities → default | `canonical-context.service.ts:724-748` |
| V2 menulis ke | `workspace_v2` via `saveWorkspaceV2` | `conversation.service.ts:263,368` |
| `draft_cart` | V2-specific, ignored V1 | `canonical-context.service.ts:843-865` |
| `SHADOW_STORE_ID` | `'store-a3cd7205'` | `shadow-wiring.ts:31` |
| Stale komentar | "store-4f4f67bd" | `shadow-wiring.ts:306,286` (stale) |
| store-a3cd7205 orders | 0 | DB query |
| store-a3cd7205 store_documents | 0 | DB query |
| store-a3cd7205 conversations | 284 | DB query |
| store-a3cd7205 v2_shadow_logs | 464 | DB query |
| store-a3cd7205 Redis key | tidak ada (TTL=-2) | `redis-cli GET/TTL` |
| store-a3cd7205 name | bengkel.didik.test | DB query |
| pm2 instances | 1 | `ecosystem.config.js:7` |
| API base URL | `https://api.qlobot.web.id` | `PUBLIC_API_URL` env |
| Redis URL | `redis://localhost:6379` | `REDIS_URL` env |
| chatEngine.v2Mode current | `'shadow'` | SQL query |
| BUG-03/04 qty<=0 | `fallback.service.ts:717` | `BUG-BELUM-DIBERESKAN.md:134` |
| VIII-A price bug | commit `4c2e4f2` | `BUG-BELUM-DIBERESKAN.md:175` |
| B6 V2→V1 guard | atomicCas pattern | `BUG-BELUM-DIBERESKAN.md:137` |
| III-4 fallback overlap | commit `5e7ef42` | `BUG-BELUM-DIBERESKAN.md:206` |

---

*File ini adalah dokumentasi read-only. Dibuat dari audit kode aktual.*
*VERIFIED: `git diff --stat` kosong kecuali file markdown ini — tidak ada kode yang diubah.*
