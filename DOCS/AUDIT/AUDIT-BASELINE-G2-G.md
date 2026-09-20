# AUDIT BASELINE G2-G — Realtime + Scale Hardening

> **Tanggal:** 20 Agu 2026
> **Status:** READ-ONLY AUDIT — baseline sebelum breakdown sub-fase G2-G. **Belum ada implementasi/keputusan arsitektur di sini.**
> **Catatan:** File ini murni pemetaan kondisi (mapping) dari kode yang ada sekarang. BUKAN rencana, BUKAN desain, BUKAN keputusan. Jangan mengambil kesimpulan "solusi" dari sini — lihat §6 yang hanya berisi daftar gap tanpa usulan.

---

## 1. Socket.IO — Arsitektur Sekarang

**Adapter: in-memory default (single-instance).** Tidak ada Redis adapter.

- Deps: `socket.io ^4.8.3` (`apps/api/package.json`). Tidak ada `@socket.io/redis-adapter` / `socket.io-redis` di deps maupun di `import` (grep `redis-adapter|socket.io-redis|@socket.io` → kosong).
- Init server: `apps/api/src/services/realtime.service.ts:60` — `new SocketIOServer(httpServer, { path, cors })` **tanpa `.adapter(...)`** → pakai default **in-memory adapter** (state room ada di 1 proses).
- Event source: `realtime.service.ts:82` subscribe ke **EventBus in-proc** (`event-bus.service.ts`). EventBus = Node `EventEmitter` murni, dokumentasinya sendiri menyatakan "HANYA within-process" dan "Socket.IO Redis Adapter … TIDAK aktif pada single-instance MVP" (`event-bus.service.ts:13-23`).
- Mount: sama `http.Server` dengan Express (`realtime.service.ts:57-68`, `index.ts:173`).

**Dampak konkret kalau `pm2 scale api N` / cluster:**
- Tiap instance = proses Node terpisah dengan adapter & EventEmitter sendiri. Client WS di instance A **tidak** menerima event yang di-emit di instance B. Event `message.created`/`typing.*`/`conversation.*` yang dipublish oleh HTTP handler di instance B hanya sampai ke client yang kebetulan connect ke instance B. → Realtime **diam-diam putus** di multi-instance.
- `onlineByStore` & `customerPresence` terbagi per instance → hitungan "online" & presence per-chat jadi tidak akurat (split-brain).

## 2. Redis — Pemakaian Sekarang

Redis **dipakai & sudah multi-instance-safe** untuk beberapa hal (alamat diambil dari env `REDIS_HOST`/`REDIS_PORT`, `redis.adapter.ts:4` → shared Redis):

| Keperluan | File:line | Multi-inst safe? |
|---|---|---|
| Generic cache (incl. engine config) | `redis.adapter.ts:4,135`; `routes/admin/engine.ts:18,41` | ✅ |
| **Rate limiter** (semua limiter) | `redis-rate-limit-store.ts:14,17`; `rate-limiters.ts:24-125` | ✅ |
| AI key-router cooldown | `ai-key-router.service.ts:16,33` (`groq:cooldown:{hash}` di Redis) | ✅ |
| Webhook **messageId dedup** | `message-queue.service.ts:89,191`; `redis.adapter.ts:109` (`setIfNotExists` EX 300) | ✅ |
| Health check Redis | `health.service.ts:54,104` | ✅ |
| engine-config cache | `engine-config.ts:14` | ✅ |

- **ActionIdempotency**: Postgres `FOR UPDATE` (bukan Redis) — DB-backed, multi-instance safe.
- **Kesiapan config**: `REDIS_HOST`/`REDIS_PORT` terbaca dari env (`redis.adapter.ts:4`, `ai-key-router.service.ts:17`) → siap multi-instance **asal** env menunjuk ke Redis bersama. Bagian yang **belum** pakai Redis (realtime, presence, circuit breaker, mutex per-chat, coalescing) adalah gap-nya (lihat §3/§6).

## 3. State In-Memory yang TIDAK di-backing Redis/DB (tidak scale)

| State | Lokasi | Risiko multi-inst |
|---|---|---|
| Store online count | `realtime.service.ts:43` `onlineByStore: Map` | ✗ salah hitung |
| Presence per-conversation | `realtime.service.ts:50` `customerPresence: Map<Set>` | ✗ presence salah |
| EventBus (Node EventEmitter) | `event-bus.service.ts` + `realtime.service.ts:82` | ✗ event tak lintas inst |
| **Circuit breaker AI** (in-memory) | `llm-gateway.ts:55` `breaker = {...}`; singleton `llm-gateway.ts:373` (per-proses) | ✗ tiap inst trip sendiri |
| **Mutex per-chat** (concurrency dedup) | `message-queue.service.ts:151` `processingLocks: Map` | ✗ race → dobel balasan AI |
| Coalescing buffer (text/media) | `message-queue.service.ts:155-156` `textBuffers`/`mediaBuffers` | ✗ gagal gabung pesan |
| Typing throttle | `routes/pwa.ts:405` `typingThrottle: Map` | ✗ throttle lemah |
| Read throttle | `routes/pwa.ts:471` `readThrottle: Map` | ✗ throttle lemah |
| Read-cache (minor) | `ai-config.ts:40`, `encryption.ts:25`, `cloudinary.adapter.ts:104` | ⚠ eventual-consistent, rendah |

Catatan: `messageId` dedup sudah Redis (§2) → pesan **persis sama** tidak double-process lintas inst, tapi mutex per-chat yang in-proc **tidak** mencegah dua instans memproses **pesan berbeda** dari chat yang sama secara konkuren.

## 4. pm2 config (`ecosystem.config.js`)

- `api`: `instances: 1`, `exec_mode: 'fork'` (`ecosystem.config.js:7-8`). `dashboard` & `pwa` juga `fork`, `instances: 1` (`:25-26`, `:43-44`).
- Implikasi: saat ini **single instance** → seluruh state in-proc di §3 masih "benar" karena hanya 1 proses. `pm2 scale api N` atau `exec_mode: cluster` akan menyalakan N proses mandiri tanpa shared-nothing → semua gap §3 & §6 langsung aktif. Tidak ada sticky-session / shared-adapter yang disiapkan.

## 5. Health / Monitoring

- **Endpoint ada & cukup untuk LB probe**: `index.ts:142` `GET /api/health` (hanya `SELECT 1`, 200/503); `routes/health.ts:9` `GET /api/health` (`healthService.getSystemStatus` cek **DB + Redis**, `health.service.ts:53-54`); plus `GET /api/admin/health` (detail). Berbasis HTTP status → cocok sebagai health check load balancer.
- **Tidak ada** endpoint metrics infra (Prometheus/OpenTelemetry): grep `prometheus|opentelemetry|new Counter|gauge` → hanya `routes/metrics.ts:10` (stat agregat **per-store**, bukan sistem) dan `admin/engine.ts:9` (config). Tidak ada sistem metrics untuk observability multi-instance.
- Background: `startHealthCheckInterval` (`index.ts:212`) tiap 30s + `health-monitor.service.ts` — timer in-proc, per-instance (aman).
- pm2: `max_memory_restart: '300M'`, `wait_ready`/`min_uptime` → monitoring level proses via `pm2 status`, tapi tidak ada agregasi health antar-instance untuk LB.

## 6. GAP Kritis untuk Scale >1 Instance (daftar — belum usul solusi)

1. **Realtime delivery**: adapter in-memory → event hanya sampai ke client di instance yang sama dengan emitter. Butuh shared adapter (Redis). (`realtime.service.ts:60`, `event-bus.service.ts:13-23`)
2. **Presence/online tracking**: `onlineByStore` + `customerPresence` per-instance → count/presence salah. (`realtime.service.ts:43,50`)
3. **Circuit breaker AI in-memory**: tiap instance trip mandiri → provider dianggap "down" di satu inst tetap dapat trafik di inst lain. (`llm-gateway.ts:55,373`)
4. **Mutex per-chat in-proc**: dua instance bisa memproses chat sama konkuren → duplikat balasan AI / race (messageId-dedup Redis hanya cover pesan identik, bukan konkuren beda pesan). (`message-queue.service.ts:151`)
5. **Coalescing buffer in-proc**: pesan chat sama yang mendarat di inst beda tidak tergabung. (`message-queue.service.ts:155-156`)
6. **Typing/read throttle in-proc**: efektivitas throttle menurun lintas instance (tiap inst punya window sendiri). (`routes/pwa.ts:405,471`) — severity rendah.
7. **EventBus in-proc only**: fan-out event lintas instance butuh transport bersama (Redis pub/sub atau Socket.IO adapter). (`event-bus.service.ts`)
8. **Read-cache minor** (ai-config/encryption/cloudinary): eventual-consistent, risiko inkonsistensi singkat — rendah.

**Positif**: Redis sudah shared & terkonfigurasi (`REDIS_HOST`), dan rate-limit / cache / messageId-dedup / ai-key-router-cooldown **sudah** Redis-backed — arah perbaikan feasible; gap-nya tepat pada komponen yang belum dipindahkan ke Redis/DB (realtime adapter, presence, circuit breaker, per-chat mutex, coalescing).
