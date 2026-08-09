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
## DARI DOKUMEN LAMA — MASIH VALID, BELUM DIKERJAKAN
- I11: kamus slang normalizer (toralin→total) — typo masih lolos tier total
- I12: guard nama produk di normalizer — belum diverifikasi
- Golden dataset + test invarian permanen I8-I15 — baru test unit parsial
- Eskalasi ke pemilik toko setelah retry klarifikasi — belum ada
- Keputusan terbuka: "dua duanya" jika opsi >2; retry LLM dihitung panggilan atau tidak

## ROADMAP SETELAH ENGINE V2 STABIL: PWA WEB CHATBOX
- Blueprint lengkap ada di chat 9/8 00:50 (simpan sbg 04_PWA_BLUEPRINT.md).
- Prinsip: zero-friction auth (uid URL->localStorage), <300KB, multi-tenant
  qlobot.web.id/c/<slug>, UI mirip WA.
- 3 endpoint: GET /api/pwa/:slug/init, GET .../history?uid=, POST .../message
  (POST menembak pipeline AI sama -> gratis tanpa Fonnte).
- 5 milestone: skeleton -> session handoff -> 2-way chat -> manifest+katalog -> push.
- Bonus: M1-M3 = test harness gratis pengganti Fonnte.
- CATATAN: uid map ke conversationId existing (store:<nomor>); channel WA/WEB
  field terpisah, JANGAN timpa field source.

## UPDATE 9/8 10:45 — BUG FLAGSHIP (MULTI-ADD) CLOSED
1. fast-path: guard multi-produk+order-verb -> hit:false, ke LLM.
2. validator-v2 defensif + reasoning.ts try/catch; silent fallback v1 hilang.
3. executor: intent order/buy diterima + iterasi SEMUA entity per act.
4. composer-v2: reply tidak pernah kosong.
Acceptance lulus; Halo/katalog/total tanpa regresi.
NEXT: golden dataset I8-I15 + test WA kondisi nyata.
