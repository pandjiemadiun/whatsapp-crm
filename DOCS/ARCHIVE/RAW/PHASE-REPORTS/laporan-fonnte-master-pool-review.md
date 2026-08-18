# Review Framework: “Fonnte Master Pool, Auto-Routing, dan The Kill-Switch”

> Review **read-only** (tidak ada kode yang di-generate). Lintasan ke kode yang
> sudah ada (`apps/api` + `apps/dashboard`) dilampirkan agar rencanaan nyambung ke
> basis kode Garuda WhatsApp CRM. Disimpan untuk diskusi keputusan sebelum Fase 1.

---

1. Apakah sudah cukup mendetail?
2. Alur sistem (end-to-end)
3. Apa yang dipakai (+ apa yang sudah ada, bisa direuse)
4. Kesulitan / risiko pengkodean
5. Rekomendasi penyempurnaan sebelum developer kerjakan
6. Jawaban langsung pertanyaan

---

## 1. Apakah sudah cukup mendetail?

**Cukup — tapi belum “printer-ready”.** Ini adalah *blueprint* yang bagus: roadmap
fase 1→4 rapi, pemisahan Admin vs UMKM jelas, dan reuse komponen ada. Dokumen ini
cukup untuk *sprint planning* / diberikan ke tim developer. Tapi ada **6 celah teknis**
yang harus dilengkapi **sebelum eksekusi**, supaya tidak “bom” di tengah-tengah:

1. **Kontrak API response Fonnte** — framework panggil `/add-device`, `/update-device`,
   `/delete-device`, `/get-devices` pakai `deviceToken`/`accountToken`, tapi
   struktur response (field, error codes) belum didefinisikan. Developer harus buka
   Postman Fonnte & mapping ke model.
2. **`delete-device` butuh OTP** (dokumen Fonnte: “*Membutuhkan kode OTP*”) — framework
   panggil pakai `token` doang → *pasti error 400/401*. **Risk.**
3. **Race condition pada kapasitas master** — dua toko alokasikan bersamaan →
   `usedCapacity` over. Perlu atomic `UPDATE … WHERE usedCapacity < maxCapacity` +
   retry, atau Redis lock.
4. **Counter `chatCount` atomic + idempotent** — webhook Fonnte bisa *resend*; perlu
   dedup (`message_id`) supaya counter naik sekali.
5. **Migrasi data existing** — toko lama punya `Store.fonnteToken`; harus migrasi ke
   pool device, atau jalankan *dual-mode*. Tidak ada di framework.
6. **Reset kuota tidak konsisten** — logika “1000 msg / 30 hari” tapi UI bilang
   “reset dalam 12 hari”. Harus didefinisikan: rolling 30d? fixed cycle? kapan
   `chatCount` nol-lagi?

### Yang sudah bagus
- Roadmap fase-ter-pisah (DB → routing → webhook/kill-switch → fitur penuh) → cocok urutkan PR.
- Memanfaatkan pola ada: `messageProcessorService.processMessage` (pipeline
  dedup→mutex→circuit-breaker→LLM→presence→retry); `axios` (`fonnte.service.ts`
  pakai axios); Redis cache (`adapters.cache`).
- UI wireframe jelas (capacity bar, form 2 kolom, toggle, quota bar).

---

## 2. Alur sistem (end-to-end)

```
1. Store butuh WA         2. Allocate slot (auto-routing)   3. Incoming WA (webhook)    4. Outgoing reply
(WhatsAppConnect.tsx)                                           (Fonnte → webhook)        (sendMessage engine)
        |                          |                              |                             |
  "Connect WA"          SELECT master active                  ^                             |
  → POST frontend            & used < max                    |                             |
  → api/whatsapp/.../allocate  ORDER BY used ASC   ┌─ body.status?        ┌─ typing: device.typingIndicator
                                    LIMIT 1 (atomic)|   connect/disconnect |  delay: device.delayConfig
                                          |        |   → invalidate cache |  url/filename (optional)
                       POST fonnte.com/add-device   └─ message event ──► messageProcessor .processMessage
                       POST fonnte.com/update-dev   (increment chatCount,   → AI → send)
                         (webhook = /api/webhooks/fonnte?secret=) atomic)            if QUOTA_EXCEEDED
                                          |                                      → balas via Web Chatbox
                             INSERT FonnteDevice,          └─ kill-switch check  → balasan via Web Chatbox
                             usedCapacity++               (chatCount>=1000 or        (gateway: 'web')
                                                          days>=MAX_DAYS)        |
                                        5. Admin UI             if tripped ─────►   |
                              (Fonnte Gateway               POST fonnte.com/       |
                              Manager)                         delete-device (OTP!) |
                                                               usedCapacity--      |
                                                               status=QUOTA_EXCEEDED
```

### Kill-switch flow (recycling slot)
```
setiap inbound/outbound message
  → chatCount += 1   (atomic, idempotent via message_id dedup)
  → daysConnected = now - connectedAt
  → if chatCount >= 1000  OR  daysConnected >= MAX_DAYS  (MAX_DAYS = 30 di logika)
        POST https://api.fonnte.com/delete-device   (butuh OTP — lihat risiko)
        usedCapacity--  (prisma $tx)
        FonnteDevice.status = QUOTA_EXCEEDED
        rute balasan ke Web Chatbox
```

---

## 3. Apa yang dipakai (+ reuse dari basis kode)

| Layer | Framework butuh | Sudah ada (bisa direuse) | Catatan |
|---|---|---|---|
| DB | model baru `FonnteMaster`, `FonnteDevice` | `schema.prisma` punya `Store` (`fonnteToken`, `fonnteNumber`, `whatsappPhoneId`, `webhookSecret`, `phoneNumber`) — **perlu migrasi** | `FonnteDevice.storeId → Store.id` (unique); `masterId → FonnteMaster.id` |
| WhatsApp send | `POST /send` pakai device token | `FonnteService.sendMessage` (`apps/api/src/services/fonnte.service.ts`) — sudah ada flag `typing: config.typing ?? false` (line ~98) | tinggal tambah `delay`, `url`, `filename` |
| Device mgmt | `/add-device`, `/update-device`, `/delete-device`, `/get-devices` (account token) | **belum ada** — kode sekarang hanya pakai device-token `/device` (`getDeviceStatus`) | /add-device & /delete-device & /get-devices butuh **account-token** scope baru |
| Cache status | invalidate on connect/disconnect | `getWhatsAppConnectionStatus` (`whatsapp-connection.service.ts:75`), `invalidateDeviceCache` (`fonnte.service.ts:56`); Redis key `wa:wa-connection:{id}` TTL 30s; in-process `deviceStatusCache` TTL 60s (`fonnte.service.ts:6`) | reuse — tapi **webhook `/fonnte` di `webhooks.ts:154` saat ini IGNORE‑kan connect/disconnect**; inilah yang Framework Fase 3 ubah |
| Webhook masuk | handle `body.status` + messages, increment chatCount | `POST /api/webhooks/fonnte` (`webhooks.ts:130`) sudah ada + secret-based auth (`?secret=`) | **ganti blok `ignored`** jadi invalidate cache + counter |
| Pipeline pesan | kill-switch hook tiap msg | `messageProcessorService.processMessage` — pipeline ada (dedup→mutex→circuit-breaker→LLM→presence-simulator→retry; lihat komentar `webhooks.ts:100`) | sisipkan step kill-switch (Fase 3) |
| Redis lock / counter atomic | kapasitas & chatCount | `adapters.cache` (`apps/api/src/adapters/container.ts`) = Redis | pakai Prisma `$tx` + Redis lock |
| Logger | event kill-switch | `adapters.logger` (dipakai di `fonnte.service.ts`, `whatsapp.ts`) | reuse |
| Frontend Admin | capacity bar, master table, sync | `apps/dashboard/src/pages/admin/` (`AdminGOWA`, `AdminOverview`, `StoreManagement`, `PlatformConfig`) | ikut pola `AdminGOWA` (GOWA device flow) sebagai referensi |
| Frontend UMKM | status, kuota, toggles | `WhatsAppConnect.tsx` + `FonnteSettings.tsx` (hook `useFonnteSettings`: `fetchStatus`, `handleSave`, `handleDisconnect`) | butuh rewrite pakai API baru (allocate / quota) |
| HTTP client | semua call ke Fonnte | `axios` (`fonnte.service.ts`) | reuse pattern auth-header |
| Deploy | pm2 | `pm2 api` (pid 286707, `:3000`) sedang running | deploy pakai `pm2 reload` graceful |

---

## 4. Kesulitan / risiko pengkodean

1. **OTP pada `delete-device`** *(blocker potensial)* — dokumen Fonnte: “*Delete Device … Membutuhkan kode OTP*”. Framework panggil `delete-device` dengan `token` doang → *pasti error*. Solusi: (a) cek apakah Fonnte ada endpoint delete tanpa OTP, atau (b) buat Admin action “request OTP → konfirm OTP” di UI sebelum kill-switch eksekusi. **Butuh keputusan sebelum Fase 3.**
2. **Race condition kapasitas master** — `SELECT … ORDER BY usedCapacity LIMIT 1` + `usedCapacity++` **bukan atomic** bila dua request paralel → over-allocate. Solusi wajib: `UPDATE FonnteMaster SET usedCapacity = usedCapacity+1 WHERE id=? AND usedCapacity < maxCapacity` (cek `affectedRows`), atau Redis distribusi lock `fonnte:alloc:{masterId}` + retry; bila semua gagal → langsung *fallback* ke Web Chatbox.
3. **`chatCount` harus atomic + idempotent** — webhook Fonnte *bisa* kirim berulang; kalau counter naik dua‑kali, kill-switch salah hit. Pakai dedup `message_id` (konsep sudah ada di processor: komentar `webhooks.ts:100` “dedup”) + `prisma.fonnteDevice.update({ chatCount: { increment: 1 } })` dalam transaksi yang sama dengan dedup check.
4. **Migrasi data existing** — toko lama punya `Store.fonnteToken`. Opsi (a) “lazy enroll”: saat `fetchStatus`, migrate‑as‑you‑go ke `FonnteDevice`; (b) script batch satu kali. Risiko: selama migrasi, satu toko punya dua token (lama + baru) → *duplicate device* di Fonnte. Perlu lock migrasi per store.
5. **Reset kuota tidak konsisten** — “1000/30 hari” vs UI “reset dalam 12 hari”. Harus didefinisikan eksplisit: *rolling* (buang msg >30 hari)? *fixed* billing cycle? kapan `chatCount = 0`? Memengaruhi seluruh kill-switch + UI “Sisa Kuota: 850/1000 (reset 12 hari)”.
6. **Fonnte rate-limit & latency** — tiap alokasi/hapus = 1–2 call eksternal. Jika banyak store connect sekaligus (scaling burst), butuh **retry + backoff + circuit-breaker** (pola ada di `message-processor.service.ts`). Jika `add-device` gagal (limit global Fonnte), harus *fallback ke Web Chatbox* → berarti **routing layer** aware‑of‑fallback di seluruh path masuk & keluar.
7. **Testing / sandbox** — tidak ada koneksi Fonnte/WhatsApp riil di dev. Butuh **mock server** (`msw`) + fixture response `/add-device`, `/delete-device`, `/get-devices`, plus unit test: (a) pool allocation saat semua master penuh → fallback; (b) concurrent allocation → tidak over-allocate; (c) kill-switch tepat saat `chatCount == 1000` / `days == 30`; (d) webhook resend → counter naik sekali. Sulit tanpa akun Fonnte test.
8. **Security** — `accountToken` milik `FonnteMaster` punya scope *manage semua device* (lebih sensitif dari device-token). Simpan ter‑enkripsi (sama prinsip dengan `Store.fonnteToken`; patokan RAILS §6 “env/track secrets”). Endpoint `/allocate` wajib admin‑only. Jika Fonnte dukung, tambahkan **webhook signature verification** (bukan sekadar secret query).
9. **Error propagation ke frontend** — bila dialihkan ke Web Chatbox (kill-switch / pool penuh / Fonnte down), PWA & dashboard harus aware bahwa gateway berubah (`gateway: 'web' | 'fonnte'`). Perlu broadcast (SSE/WebSocket) atau setidaknya re‑poll. Saat ini tidak ada WS infra → sementara pakai polling + fallback flag.
10. **Monitoring & alerting** — kill-switch harus *log + alert* (Slack/email). Basis sudah ada `adapters.logger`;perlu ekstensi health Fonnte di `MissionControlPulse.systemHealth` (lihat interface di `apps/dashboard/src/hooks/useMissionControl.ts` — ada `gowa: boolean` tapi belum `fonnte`).

---

## 5. Rekomendasi penyempurnaan sebelum developer kerjakan

Sebelum Fase 1, panjangkan framework dengan:

- **API contract table**: request/response tiap endpoint Fonnte (`/add-device`, `/update-device`, `/delete-device`, `/get-devices`) — termasuk field OTP & error codes.
- **Decision doc OTP**: cara dapatkan/rekam OTP untuk `delete-device` (pilih solusi 1a/1b).
- **Concurrency spec**: atomic allocation query + Redis lock key (`fonnte:alloc:{masterId}`) + retry policy + fallback‑to‑web rule.
- **Idempotency map**: webhook dedup key (`message_id`); counter `incr` dalam transaksi Prisma.
- **Migration plan**: migrasi `Store.fonnteToken` → `FonnteDevice` (lazy vs batch) + dual‑mode window + lock per store.
- **Quota reset definition**: rolling vs fixed; kapan `chatCount` nol.
- **Testing plan**: `msw` fixtures + unit/concurrency/kill-switch test list.

---

## 6. Ringkasan jawaban

- **Cukup mendetail?** → Cukup sebagai *blueprint*; belum cukup dieksekusi langsung. Perlu pelengkapan 6 poin §1 + keputusan OTP/kontrak/migrasi.
- **Alurnya?** → Lihat §2 (end-to-end + kill-switch flow).
- **Apa yang dipakai?** → §3 (reuse mayoritas: Express + Prisma + axios + Redis + logger + message-processor pipeline + webhook secret yang sudah ada; yang baru: account-token pool manager, model baru, UI Admin/UMKM revisi).
- **Kesulitan?** → Ya, 10 poin di §4. **Kritis (blocker):** OTP pada `delete-device`, race condition kapasitas, counter idempotency, migrasi data existing — semua butuh keputusan sebelum kode.

> Catatan lingkungan (untuk konteks): `pm2 api` sedang `online` di `:3000`; pada saat penulisan ini basis `apps/api` (schema/route/service) **tidak di‑edit** — ini dokumen review saja.
