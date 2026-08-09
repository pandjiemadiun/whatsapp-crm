# 04_PWA_BLUEPRINT.md — WEB CHATBOX (MINI-APP GENERATOR)
Status: Planned (post engine-v2 stabil).

## TUJUAN
QLobot jadi "platform mini-app toko"; alihkan percakapan dari WA (berbayar)
ke Web PWA (gratis); UMKM merasa punya "aplikasi sendiri".

## PRINSIP
- Zero-friction auth: tanpa daftar; uid dari param URL dikunci ke localStorage.
- Mobile-first, bundle <300KB, loading <1s.
- Single page multi-tenant: 1 frontend ribuan toko; tema/logo dinamis per
  URL qlobot.web.id/c/<slug>.
- UI 90% mirip WhatsApp.

## STACK
- React 19 + Vite (apps/pwa, terpisah dari dashboard).
- Tailwind v4 murni (tanpa Shadcn/MUI).
- manifest.json + Service Worker (push di masa depan).
- DB: pakai Conversation/ConversationHistory existing; tambah field
  channel ('WHATSAPP'|'WEB') — JANGAN timpa field `source`
  (source = sumber balasan ai/faq/sop/...).

## USER JOURNEY
A. Akuisisi: bot WA balas link qlobot.web.id/c/<slug>?uid=WA_<nomor>.
B. Handoff: PWA baca uid -> localStorage -> ambil history; uid MAP ke
   conversationId existing (store:<nomor>) biar history WA & Web nyatu.
C. Retensi: install PWA -> shortcut home screen -> history lama muncul.

## ENDPOINT (apps/api, tipis)
- GET  /api/pwa/:storeSlug/init          (data publik toko)
- GET  /api/pwa/:storeSlug/history?uid=  (riwayat percakapan)
- POST /api/pwa/:storeSlug/message       (proses via rantai AI sama,
  balas ke Web, sinkron dashboard; GRATIS tanpa Fonnte)

## UI
Header sticky (foto/nama toko/"Online (AI)"); chat room balon hijau kanan
(pembeli) putih kiri (AI); input sticky + tombol Katalog; bottom sheet
katalog 60% layar.

## MILESTONE
M1 skeleton PWA + routing (UI statis).
M2 integrasi API + session handoff.
M3 2-way chat AI (sekaligus test harness gratis pengganti Fonnte).
M4 manifest + bottom sheet katalog.
M5 web push (VAPID) broadcast promo.
