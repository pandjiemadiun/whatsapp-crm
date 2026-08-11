TASK A: P0 Safety Boundary — Cegah double-mutation V2→V1

SCOPE: HANYA apps/api/src/business/conversation.service.ts (branch v2,
sekitar baris 111-318) dan file test-nya. JANGAN ubah fast-path.ts,
validator-v2.ts, composer-v2.ts, reasoning.ts, order.service.ts,
workspace.ts, atau file lain manapun. Ini bukan refactor semantik —
murni menambal boundary eksekusi.

MASALAH (dari audit, verified):
Saat ini kalau branch v2 sudah menjalankan executeCartOps() (menulis
confirmedItems + syncCartStateToDraftOrder ke DB), lalu exception
terjadi di langkah SETELAHNYA (composeReply / buildResult / save
messages / saveWorkspace), catch block di baris ~308-317 melempar
eksekusi ke branch v1 SECARA PENUH — yang bisa memanggil modifyCart
lagi untuk pesan yang sama. Hasilnya: satu pesan customer berpotensi
memicu 2x mutasi cart/order (dobel item / dobel draft order).

PERUBAHAN YANG DIMINTA:
1. Tambahkan flag lokal `v2MutationExecuted` (boolean, default false)
   sebelum pemanggilan executeCartOps() di branch v2 (baris ~253-277
   dan ~184-240 untuk outcome 'resolved').
2. Set `v2MutationExecuted = true` SEGERA setelah executeCartOps()
   selesai sukses (sebelum composeReply/buildResult/save/saveWorkspace
   dipanggil).
3. Bungkus SELURUH langkah setelah mutation (composeReply, buildResult,
   save messages, saveWorkspace) dalam try/catch lokal yang TIDAK
   melempar ke luar. Kalau langkah ini gagal:
   - log level CRITICAL/error dengan storeId, conversationId, ops yang
     sudah dieksekusi, dan error asli.
   - return balasan aman generik ke customer (jangan lempar exception),
     contoh: "Baik kak, pesanannya sudah kami catat. Boleh cek lagi
     dengan ketik 'total' ya" — JANGAN panggil LLM lagi untuk membuat
     balasan ini (harus string statis/template, supaya tidak menambah
     side effect baru).
   - PENTING: fungsi harus return di sini, TIDAK boleh sampai ke catch
     block terluar (baris ~308-317) yang memicu fallback ke v1.
4. Catch block terluar (baris ~308-317) yang sudah ada: TIDAK berubah
   perilakunya untuk exception yang terjadi SEBELUM mutation (tetap
   fallback ke v1 seperti sekarang — ini kasus aman, belum ada side
   effect ganda). Hanya kasus setelah mutation yang diblok masuk sini.

ACCEPTANCE CRITERIA:
- Test baru: simulasikan v2 sukses executeCartOps lalu paksa exception
  di composeReply (mock) → assert:
  (a) branch v1 (modifyCart versi v1 / resolvePending / STAGE-4) TIDAK
      pernah terpanggil untuk pesan yang sama,
  (b) hanya ADA SATU pemanggilan executeCartOps/modifyCart total untuk
      pesan itu,
  (c) fungsi return balasan (tidak throw ke pemanggil).
- Semua test suite existing (fast-path-v2, reasoning-v2, composer-v2,
  prompts-v2, engine-e2e-v2, validator/branch tests) tetap lulus,
  dengan 2 kegagalan PRE-EXISTING yang sudah diketahui (JANGAN
  di-fix, itu di luar scope). TIDAK BOLEH ada kegagalan baru.
- npx tsc --noEmit → 0 error.
- npx tsc → sukses.
- pm2 restart api → sukses, tidak crash loop.

LARANGAN:
- Jangan ubah logic v1 branch sama sekali.
- Jangan ubah fast-path.ts, validator-v2.ts, composer-v2.ts,
  reasoning.ts, order.service.ts.
- Jangan tambah LLM call baru di jalur error-handling ini.
- Jangan commit sebelum semua acceptance criteria di atas lulus.

LAPORKAN: diff yang dibuat, hasil test (pass/fail count + 2
pre-existing failure), hasil tsc, konfirmasi pm2 restart.
