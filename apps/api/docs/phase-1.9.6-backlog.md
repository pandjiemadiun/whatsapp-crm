# Phase 1.9.6 — Backlog Teknis (Rekomendasi, Belum Diimplementasi)

> Dokumen backlog dari post-release hardening. Item di sini **tidak wajib** untuk rilis
> saat ini — masing-masing berisi konteks, alasan, dan dampak agar bisa diprioritaskan.

---

## 1. Metrik `avgConfidenceSuccessOnly`

**Status: backlog — TIDAK diimplementasikan (sesuai instruksi).**

- **Konteks**: Saat ini `averageConfidence` menghitung rata-rata dari **semua** record,
  termasuk `failed` yang ber-confidence `0`. Akibatnya satu extraction gagal menurunkan
  rata-rata secara signifikan (mis. 2 sukses 0.95 + 1 gagal 0 → avg 0.63).
- **Usulan**: Tambah KPI terpisah `avgConfidenceSuccessOnly` (rata-rata hanya dari
  `status=success`) di response `summary` + card UI "Avg Confidence (sukses)".
- **Dampak**: Backward-compatible (field baru ditambahkan, tidak mengubah `averageConfidence`).
  Membantu user membedakan "kualitas ekstraksi sukses" vs "kesehatan keseluruhan pipeline".
- **Estimasi**: Kecil — 1 aggregate query tambahan + 1 KPI card.

## 2. Timezone per-store

**Status: sebagian selesai — mitigasi TZ Asia/Jakarta AKTIF (2026-08-01).**

- **Konteks**: Server berjalan di UTC. `parseLocalDay()`/`localDayKey()` memakai
  timezone proses (bukan per-user).
- **Yang SUDAH dilakukan**: `ecosystem.config.js` API kini menetapkan `TZ=Asia/Jakarta`,
  sehingga `parseLocalDay`/`localDayKey` menghitung dalam WIB. Filter/trend kini benar
  untuk mayoritas user (WIB) — diverifikasi dengan record 06:01 WIB yang masuk filter
  `from=2026-08-01` setelah TZ diset.
- **Yang BELUM**: Store punya kolom `timezone` (bisa Makassar/Jayapura/dll) tapi filter
  belum parse per-timezone store. Untuk user non-WIB, perilaku tetap berbasis WIB server.
- **Usulan jangka panjang**: `parseLocalDay` menerima `timeZone` param dari `Store.timezone`
  dan response trend membawa label zona. Perlu menambah param query `tz` opsional agar
  test/backward-compatible.
- **Catatan**: Perubahan TZ memengaruhi SEMUA parsing tanggal proses API (termasuk
  `new Date()` di tempat lain). Sudah diverifikasi health-check/smoke-test tetap pass.

## 3. Daily rollup untuk skala besar

**Status: backlog — TIDAK diimplementasikan.**

- **Konteks**: Endpoint analytics melakukan ~6 query per request (count, aggregate,
  findMany trend, findMany distribusi, groupBy source, findMany history) dengan index
  `[storeId, createdAt]`. Untuk data MVP (ratusan run/store) ini aman.
- **Usulan**: Saat volume tumbuh, tambah rollup harian (cron seperti `scheduleBackups`)
  yang menulis agregat per store per hari ke tabel terpisah, lalu endpoint baca rollup
  untuk summary/trend dan hanya query detail untuk history (paginated).
- **Dampak**: Query summary/trend menjadi O(1) lookup, history tetap diskrit.
- **Catatan**: Jangan memakai tabel `analytics` lama (daily message rollup) — isinya
  berbeda domain. Buat tabel rollup baru `magic_paste_run_daily` jika diperlukan.

## 4. Minor — dokumentasi perilaku `extractedEntities` untuk failed

**Status: backlog.**

- Record `failed` menyimpan `extractedEntities` minimal `{name, price, confidence}`
  (bukan struktur lengkap seperti success). API hanya mengekspos `extractedName` dan
  `categoryHint` — aman. Jika suatu saat UI ingin menampilkan detail failed, perlu
  menyimpan struktur lengkap di path failed juga.

## 5. Minor — query `successRuns` ganda

**Status: backlog.**

- `medianConfidence` dan `distribution` masing-masing fetch semua `successRuns`
  (2 query hampir identik). Bisa digabung jadi 1 fetch + hitung di memori.
  Optimasi kecil, tidak mengubah behaviour.
