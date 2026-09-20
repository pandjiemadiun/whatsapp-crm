# Struktur dokumentasi

Dokumen wajib baca (tetap di root repo):
- RAILS.md — kontrak kerja AI, baca pertama tiap sesi
- PROJECT-STATE-REPORT.md — status project terverifikasi
- DEFERRED-WORK-TRACKER.md — semua item yang sengaja ditunda
- PROJECT-CONTRACT-CHAT-ENGINE-V2-REWRITE.md — kontrak V2 rewrite (aktif)
- PROJECT-CONTRACT-PRODUCT-VARIANTS.md — kontrak product variants (LOCKED, P2 in progress)
- BUG-BELUM-DIBERESKAN.md — indeks bug/risk belum dibereskan (aktif)
- .gitignore, .env.example, README.md

Struktur di sini:
- DOCS/CONTRACT/ — kontrak yang sudah closed tapi masih locked/dirujuk
- DOCS/DECISIONS/ — dokumen keputusan (DECISION-*.md)
- DOCS/AUDIT/ — hasil audit baseline + audit report
- DOCS/ARCHIVE/ — laporan task lama, histori, sudah tidak aktif dirujuk
- DOCS/ARCHIVE/RAW/ — laporan mentah (laporan-*.md) per task/fase
- DOCS/MASTER/ — dokumen master/roadmap utama
- DOCS/SECURITY-INCIDENT-2026-09-04.md — catatan kejadian keamanan
- DOCS/KEY-ROTATION-RUNBOOK.md — prosedur rotasi kunci

Reorganisasi dilakukan 19 Sep 2026 karena VPS evacuation — lihat commit
"docs: reorganize scattered .md files into DOCS/ structure (VPS evacuation cleanup)".
