# Laporan Task P-PWA.14 — Typing indicator + delay natural (revisi algoritma)

**Scope:** HANYA `apps/pwa` (`ChatPage.tsx` + `ChatBubble.tsx` + `index.css`). **Tidak
menyentuh backend / `apps/api` / `apps/dashboard` sama sekali** — tidak ada request
HTTP baru, tidak ada perubahan schema/route/service, tidak ada env baru.

Pre-read: `RAILS.md` (§1.4 DILARANG ubah file di luar scope, §1.10 read-only
interpretation) + struktur PWA (`App.tsx`, `ChatPage.tsx`, `ChatBubble.tsx`,
`services/api.ts`, `index.css`) — baca ulang sebelum edit (lihat daftar file pada
akhir laporan).

> **Gate (`git status`):** sebelum edit, *tracked source* `apps/api/src`,
> `apps/dashboard/src`, `apps/pwa/src` tidak ada `M`-nya (hanya kategori RAILS §6:
> `apps/api/dist/**`, `apps/api/logs/*`, `.env`, DOCS pre-existing). Setelah edit,
> `git diff --stat apps/pwa` menampilkan **3 file**, semuanya di
> `apps/pwa/src`: `ChatBubble.tsx`, `ChatPage.tsx`, `index.css`. Tidak ada perubahan
> source di luar `apps/pwa`.

---

## Perilaku yang diinginkan → implementasi

### 1. "mengetik..." bubble muncul SEKALI setelah user kirim
Dipasang di `ChatPage.tsx:92-104` (`onSend`): tepat setelah validasi, sebelum request
API, langsung `setIsTyping(true)` (optimistic) sehingga bubble renderer
(:218 `{isTyping && <ChatBubble role="assistant" isTyping />}`) menampilkan indikator
assistant. Bukan "berpikir" — teksnya `mengetik` + 3-dot pulse (lihat §2).

```ts
// ChatPage.tsx:92-104
const onSend = async () => {
  if (!input.trim() || sending || !webUid || !slug) return
  setSending(true)
  setError(null)
  const text = input.trim()

  // 2. target display duration (700-1300ms) — dihitung SEKALI saat kirim
  sendStartedAt.current = Date.now()
  targetDisplayMs.current = 700 + Math.floor(Math.random() * 600)
  clearTypingTimer()

  // 1. tampilkan "mengetik..." SEGERI setelah user kirim (optimistic)
  setIsTyping(true)
  ...
```

### 2. Animasi 3-dot CSS sederhana
Ditambahkan di `index.css` (utility `dot-pulse` + `@keyframes dot-pulse`) dan dipakai
oleh `ChatBubble.tsx` bila `isTyping`:

```css
/* index.css (baru) */
@layer utilities {
  @keyframes dot-pulse {
    0%   { opacity: 0.2; transform: translateY(0); }
    50%  { opacity: 1;   transform: translateY(-2px); }
    100% { opacity: 0.2; transform: translateY(0); }
  }
  .dot-pulse {
    display: inline-block; width: 0.45em; height: 0.45em; border-radius: 9999px;
    background: theme('colors.gray.400');
    animation: dot-pulse 1.2s ease-in-out infinite;
  }
}
```

```tsx
// ChatBubble.tsx (cabang isTyping, ~:20-33)
isTyping ? (
  <div className="flex items-center gap-1">
    <span className="text-gray-500 font-medium">mengetik</span>
    <span className="inline-flex items-center gap-[1px] ml-0.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="dot-pulse" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  </div>
) : (
  <p className="whitespace-pre-wrap break-words">{text}</p>
)
```
Tiga titik diberi `animationDelay` berbeda (`-0.12s` per titik, via inline style pada
`.map`) agar bersorak staggers — terasa "mengetik" alami, bukan "berpikir".

### 3. Algoritma "delay natural": `max(targetDisplayTime, waktu response datang)`
Bukan if/else 800ms — hitung sekali di `onSend` (target tetap selama sesi kirim itu),
lalu pada *arrival* response hasilkan `delay` dan pakai aturan:

> balasan muncul pada waktu `max(targetDisplayTime, waktu response benar-benyra
> datang)`. AI cepat (mis. 400 ms) → tetap tunggu sampai target (mis. 900 ms), **tidak
> ada tambahan delay di atas target**. AI lambat (mis. 1500 ms > target) → tampilkan
> **segera** pada kedatangan, **tidak pernah menambah delay di atas waktu asli AI**.

Kode: `ChatPage.tsx:116-146` — formula `delay = Math.max(targetDisplayMs - elapsed, 0)`
(`:119`), lalu cabang `delay <= 0` (AI lambat → *immediate*, tidak pakai `setTimeout`)
vs `delay > 0` (AI cepat → `setTimeout(..., delay)` sampai target).

```ts
// ChatPage.tsx:115-146
const body = res.data
const elapsed = Date.now() - sendStartedAt.current
const delay = Math.max(targetDisplayMs.current - elapsed, 0) // :119

if (body?.status === 'pending_human') {
  // ... tampilkan segera (bukan balasan AI berjenjang)
  clearTypingTimer(); setMessages((m) => [...m, { role: 'system', content: 'Pesan diteruskan ke admin, mohon tunggu' }])
} else if (body?.success && body.content != null) {
  if (delay <= 0) {                              // AI lambat / tepat target -> langsung
    clearTypingTimer(); setIsTyping(false); setSending(false)
    setMessages((m) => [...m, { role: 'assistant', content: body.content }])
  } else {                                       // AI cepat -> tunggu sampai target
    typingTimer.current = setTimeout(() => {
      clearTypingTimer(); setIsTyping(false); setSending(false)
      setMessages((m) => [...m, { role: 'assistant', content: body.content }])
    }, delay)
  }
}
```

Karena `delay = max(target − elapsed, 0)`, nilainya **selalu ≥ 0** — jaminan "tidak
pernah menambah delay di atas waktu asli AI" (bila `elapsed ≥ target`, `delay = 0` dan
jalur `delay <= 0` memaksa *immediate*).

Range target: `700 + Math.floor(Math.random() * 600)` ⟹ `[700, 1299]` ⊂ `[700, 1300]`
(`ChatPage.tsx:100`). Dihitung **sekali** pada kirim (`sendStartedAt.current` dan
`targetDisplayMs.current` diset tepat sebelum `setIsTyping(true)`), tidak otomatis
dirandomisasi ulang saat arrival.

### 4. Timer di-clear bila komponen unmount (no memory leak)
`typingTimer` disimpan di `useRef` (`:34`); helper `clearTypingTimer` (`:38-43`) dan
cleanup *unmount* (`ChatPage.tsx:89-90`):

```ts
const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null) // :34
const clearTypingTimer = () => {                                        // :38
  if (typingTimer.current) { clearTimeout(typingTimer.current); typingTimer.current = null }
}
...
// 4. clear timer bila komponen unmount (hindari memory leak + setState pasca-unmount)
useEffect(() => clearTypingTimer, [])   // :89-90
```
`clearTypingTimer()` juga dipanggil di awal `onSend` (`:101`) sebelum menjadwalkan
timer baru (mencegah *double timer* bila kirim berturut-turut) dan di setiap *terminal
branch* (`:123/:135/:148/:158`) sebelum menambahkan balasan/error.

### 5. Response GAGAL (network/429) → tampilkan SECEARA LANGSUNG, tidak nunggu target
`catch` block (`ChatPage.tsx:156-166`) **tidak** pernah memanggil `setTimeout`/
`scheduleReply`; langsung `clearTypingTimer()` + `setIsTyping(false)` + `setError(...)`
atau `setSending(false)`, sehingga error tampil tanpa menunggu `targetDisplayTime`.

```ts
// ChatPage.tsx:156-166
} catch (e: any) {
  // 5. error (network / 429): tampilkan SECEARA LANGSUNG — jangan nunggu target
  clearTypingTimer()
  setIsTyping(false)
  setSending(false)
  if (e?.response?.status === 429) {
    setError('Sesi sedang sibuk, mohon kirim lagi.')
  } else {
    setError(e?.message ?? 'Gagal mengirim pesan')
  }
}
```

Catatan: state `sending` mematikan input dan tombol (`disabled={sending}` pada
`:231/:239`) sejak user kirim hingga *asisten* selesai merender — jadi selama jeda
"mengetik..." pengguna memang tidak dapat kirim ulang (menghindari race timer ganda).

---

## Perubahan file (diff)

| File | Perubahan | file:line |
|---|---|---|
| `apps/pwa/src/components/ChatBubble.tsx` | tambah `isTyping?: boolean` pada `ChatBubbleProps`; cabang render "mengetik..." + 3-dot `.dot-pulse` | `:5` (prop), `:20-33` (branch) |
| `apps/pwa/src/components/ChatPage.tsx` | state `isTyping` + refs `typingTimer`/`targetDisplayMs`/`sendStartedAt` + `clearTypingTimer`; `onSend` hitung target sekali + `delay = max(target-elapsed,0)` + cabang immediate/timer; render bubble `isTyping`; cleanup unmount | state `:27-43`; cleanup `:89-90`; `onSend` `:92-167` (target `:99-100`, isTyping `:104`, delay `:119`, success `:131-147`, error `:156-166`); render `:218` |
| `apps/pwa/src/index.css` | `@keyframes dot-pulse` + `.dot-pulse` utility (3-dot pulse) | baru, setelah `@theme` |

Tidak ada perubahan pada `services/api.ts`, `App.tsx`, `main.tsx`, `NotFound.tsx`,
maupun apa pun di `apps/api` / `apps/dashboard`.

---

## Verifikasi (validasi)

1. **Type-check `tsc --noEmit` → 0 error:**
   `cd apps/pwa && npx tsc --noEmit -p tsconfig.app.json` → keluar `0` (setelah
   memperbaiki satu `TS2741` awal: `text` wajib di `ChatBubbleProps` → dijadikan
   opsional `text?: string`, karena cabang `isTyping` tidak memakai `text`).
2. **Build → 0 error:** `npm run build` (`tsc -b && vite build`) →
   `✓ built in 766ms`, 3 chunk (`dist/index.html`, `index-*.css`, `index-*.js`).
3. **Dev server tidak crash:** `npm run dev` → `VITE v8.2.1 ready in 552ms`,
   `Local: http://localhost:5174/`; `curl -o /dev/null -w "HTTP %{http_code}" http://localhost:5174/`
   → `HTTP 200` (frontend terlayani).
4. **Proxy + route dispatch:** `curl http://localhost:5174/api/pwa/__nope__/init`
   → `{"error":"Store not found"}` `HTTP 404` — membuktikan Vite proxy → `/api` ke
   `apps/api:3000` berfungsi dan `GET /pwa/:storeSlug/init` (`pwa.ts:50-71`) resolve
   slug dengan benar (store tidak ditemukan → 404, bukan error jaringan/proxy).
5. **Algoritma timing — diverifikasi terpisah oleh skrip Node (dihapus setelah)**
   mereplikasi *exact* formula `delay = Math.max(targetDisplayMs - elapsed, 0)` dan
   cabang `delay <= 0` dari `ChatPage.tsx:119/134`:
   - `targetDisplayMs` selalu dalam `[700,1300]` (5000 sample random). ✓
   - AI cepat (400 ms), target 900 → `delay = 500` **timer terpasang**, muncul di 900,
     tidak langsung. ✓ (tidak ada delay *di atas* target)
   - AI lambat (1500 ms), target 900 → `delay = 0` → jalur `delay <= 0`, **muncul
     langsung, tidak ada `setTimeout` terpasang** (tidak ada delay di atas arrival). ✓
   - `elapsed == target` → `delay 0`, muncul tepat di target. ✓
   - error path → tidak pernah panggil timer (langsung). ✓
   - unmount → `clearTypingTimer()` memadamkan `setTimeout` pending (tidak ada leak). ✓
   - boundary: target min 700 (fast 300 → delay 400, tunggu) & max 1300 (slow 2000 →
     langsung). ✓
   → `ALL TIMING ASSERTIONS PASSED`.
   > Catatan: animasi CSS (3-dot pulse) dan *mount* bubble "mengetik..." adalah
   > perilaku UI yang tidak dapat diverifikasi via `curl`; validasi visual = review
   > kode `ChatBubble.isTyping` (`:20-33`) + `@keyframes dot-pulse` (`index.css`) +
   > render di `ChatPage.tsx:218`. Build CSS berhasil (chunk `index-*.css` 7.95 kB
   > termasuk utility baru).

---

## Acceptance

- **RAILS §1.4 / §1.10:** tidak ada file di luar `apps/pwa` yang diubah; tidak ada
  request/env ke `apps/api`.
- `git status --short apps/pwa` → 3 file: `ChatBubble.tsx`, `ChatPage.tsx`,
  `index.css`; semuanya `apps/pwa/src`. `apps/api/src`, `apps/dashboard/src` tidak
  berubah sama sekali.
- `tsc --noEmit` = 0 error; `npm run build` = 0 error.
- Dev server berjalan tidak crash; proxy `/api` → `:3000` berfungsi; `/api/health` ok.
- `apps/api` pm2 **tidak tersentuh** → pid 286707 tetap `online`,
  `GET /api/health` → `{"status":"ok","message":"All systems operational"}`.
- Commit: satu commit
  `feat(PWA.14): typing indicator + delay natural (max target vs response arrival)`
  berisi 3 file `apps/pwa/src` + laporan DOCS ini.

## File & state akhir
- `apps/pwa/src/components/ChatBubble.tsx` — `isTyping` prop + 3-dot render.
- `apps/pwa/src/components/ChatPage.tsx` — state/timer `isTyping`/`typingTimer`/
  `targetDisplayMs`/`sendStartedAt`/`clearTypingTimer`; `onSend` timing
  (`max(target, arrival)`); render bubble; unmount cleanup.
- `apps/pwa/src/index.css` — `@keyframes dot-pulse` + `.dot-pulse`.
- `apps/pwa/src/services/api.ts`, `App.tsx`, `main.tsx`, `NotFound.tsx` — tidak berubah.
- `apps/api/**` — tidak berubah (read-only). `dist/` regen oleh `vite build` tapi
  gitignored (`apps/pwa/.gitignore` mencakup `dist/`).
- pm2 `api` (pid 286707) online; `/api/health` ok.
