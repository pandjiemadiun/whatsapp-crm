# STATUS ENGINE V2 — 9 Aug 2026 00:05 WIB


## KONTEKS BESAR
Canary engine v3.2 di toko store-f7140b5c. Tujuan: buktikan 3 bug asli fix
(multi-add, negasi, total) sebelum rollout ke tenant lain.


## YANG JALAN (verified produksi)
- Flag v2 aktif; branch v2 terpanggil (log "Engine v2 active")
- Fast-path tier: katalog, total, hapus cart, greeting
- storeId fix (produk tampil benar)
- Resolved (jawaban klarifikasi) dengan total benar
- Circuit breaker v2->v1 bekerja


## YANG MASIH RUSAK
1. FLAGSHIP: multi-add ("mau wortel kangkung kentang") disergap tier
   disambiguasi produk -> klarifikasi; LLM tidak dipanggil (llmCalls=0).
2. Receipt tampil item qty 0 ("Brambang (0x)").
3. Reply resolved terpotong ("adalah?") - kosmetik.
4. Test reasoning-v2 "terminal->fallback" outdated (harusnya expect reasoned).


## LANGKAH SESI BERIKUTNYA
1. Baca fast-path.ts + fallback.service.ts. Cari ResponseSource PERSIS dari
   reply "Boleh dibantu dipastikan Kak, produk mana yang dimaksud?".
2. Buat fast-path return hit:false pada source tersebut.
   Alternatif robust: jika pesan mengandung >=2 nama produk katalog -> hit:false.
3. Verifikasi log: multi-add harus outcome=reasoned, llmCalls=1.
4. Filter qty<=0 di receipt.
5. Update test reasoning-v2 yang outdated.


## FAKTA PENTING
- webhook secret: <lihat DB: stores.webhookSecret>
- device/gateway: 6281231944200
- fonnteToken: sudah di-restore (asli)
- Redis flag: store-f7140b5c:engine = v2
- Test gratis: curl webhook + baca dashboard /dashboard/conversations