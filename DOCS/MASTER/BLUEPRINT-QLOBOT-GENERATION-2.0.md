# QLOBOT GENERATION 2.0
## Product + Architecture Blueprint

**Status:** Proposed / Owner-approved direction for next-generation redesign
**Date:** 2026-08-14

---

## 1. NORTH STAR

> **Membangun user experience terbaik untuk customer dan merchant, tidak peduli serumit apa kode di belakangnya.**

### Product North Star

> **WhatsApp untuk komunikasi. Chatbox untuk pengalaman. PWA untuk menjadi toko.**

### UX North Star

> **Semudah chat, senyaman toko, secanggih aplikasi.**

### Visual North Star

> **JANGAN PERMALUKAN WEBSITE SAYA.**

Chatbox adalah gerbang pertama customer mengenal merchant dan QloBot. Visual bukan kosmetik; visual adalah produk.

### Product definition

> **QloBot Chatbox = storefront yang bisa diajak ngobrol.**

Bukan WhatsApp clone. Bukan chatbot dengan bubble cantik. Bukan marketplace mini yang penuh menu.

Conversation + commerce + human assistance harus terasa sebagai satu pengalaman.

---

## 2. STRATEGIC POSITION

WhatsApp tetap kanal utama dan pintu komunikasi yang paling familiar.

Customer yang lebih nyaman menggunakan WhatsApp **tidak dipaksa pindah**.

Customer yang membuka Chatbox mendapatkan pengalaman yang lebih kaya:

- product discovery,
- visual catalog,
- conversation commerce,
- cart,
- human assistance,
- notification,
- merchant-branded PWA.

QloBot tidak melawan WhatsApp. QloBot menggunakan WhatsApp sebagai distribution/channel dan Chatbox sebagai superior experience layer.

---

## 3. CUSTOMER EXPERIENCE PRINCIPLES

### Zero learning curve
User tidak perlu belajar aplikasi.

### Tap-first
Jika tindakan dapat dilakukan dengan satu tap jelas, jangan memaksa user mengetik.

### Complexity behind the UI
Kompleksitas berada di backend/domain, bukan dibebankan kepada user.

### Awam != UI buruk
Target user awam berarti cognitive load rendah, bukan visual quality rendah.

### Merchant pride
Merchant harus mau membagikan link Chatbox tanpa malu.

### Progressive disclosure
Tampilkan yang diperlukan sekarang; detail muncul ketika dibutuhkan.

### Familiar interaction, higher capability
Gunakan pola chat yang sudah familiar, tetapi berikan kemampuan commerce yang jauh lebih kaya.

---

## 4. VISUAL DESIGN DIRECTION

### Target feel

- professional
- modern
- premium
- warm
- clean
- confident
- lightweight
- mobile-first

### Hindari

- flat-white/form-like UI,
- childish UI,
- excessive pills,
- excessive gradients,
- excessive glassmorphism,
- neon AI aesthetic,
- heavy shadows,
- emoji sebagai design system utama,
- dashboard-like customer UI,
- marketplace navigation yang kompleks,
- icon-only actions untuk fungsi penting.

### Reference DNA

Gunakan pattern sebagai referensi, bukan copy literal:

- OpenShip Marketplace / conversational commerce,
- Storefront UI / commerce component quality,
- Next Minimal Store / premium simplicity.

QloBot tetap memiliki design system sendiri.

---

## 5. CUSTOMER STOREFRONT MODEL

```text
Merchant Identity
      ↓
Welcome / Search / Discovery
      ↓
Product
      ↓
Conversation
      ↓
Cart
      ↓
Human / WhatsApp
      ↓
Future Checkout / Order / Tracking
```

Satu experience, bukan banyak aplikasi.

### First open
Dalam ≤5 detik user harus tahu:

1. ini toko siapa,
2. apa yang bisa dilakukan,
3. cara melihat produk,
4. cara bertanya,
5. bahwa produk terlihat profesional.

Customer tidak wajib mengetik untuk memulai.

---

## 6. MERCHANT EXPERIENCE

Merchant juga harus mendapatkan low-learning-curve experience:

```text
Login
 ↓
lihat percakapan yang perlu perhatian
 ↓
AI menangani
 ↓
Take over bila perlu
 ↓
Balas
 ↓
Resolve
```

Dashboard bukan ERP. Prioritasnya adalah inbox, customer, status, reply, dan operasional yang memang diperlukan.

---

## 7. CONVERSATIONAL COMMERCE

Target interaction:

```text
Customer: "Ada minyak 2 liter?"
        ↓
AI / engine
        ↓
Product / Product List authoritative payload
        ↓
Visual commerce card
        ↓
Customer memilih
        ↓
Conversation berlanjut
```

Structured type tetap authoritative. Frontend tidak boleh melakukan string matching untuk menentukan product/cart/order.

Specialized UI utama:

- text,
- product,
- product_list,
- cart,
- quick_reply,
- handoff.

Unknown/unavailable type → text fallback.

---

## 8. DOMAIN ARCHITECTURE V2.0

Generation 2.0 tidak mempertahankan backend lama hanya karena sudah ada.

Prinsip:

> **Preserve behavior that is good; refactor boundaries that are harmful.**

### Target conceptual flow

```text
Inbound Message
      ↓
Authentication / tenant validation
      ↓
Normalization / Fast Path
      ↓
Semantic Interpretation
      ↓
Typed Actions / Intent
      ↓
Validation
      ↓
Transactional Domain Execution
      ↓
Persistence
      ↓
Domain Events
      ↓
Delivery
       ├── WebSocket
       ├── WhatsApp
       ├── Dashboard
       └── Push Notification
```

### Stage A — Pure decision

Stage A tidak melakukan DB mutation.

Menghasilkan typed actions, misalnya:

```ts
export type CommerceAction =
  | { type: "cart.add"; productId: string; variantId?: string; quantity: number }
  | { type: "cart.remove"; lineItemId: string }
  | { type: "cart.update"; lineItemId: string; quantity: number }
  | { type: "product.search"; query: string }
  | { type: "product.list" }
  | { type: "handoff.request" };
```

Bentuk final harus mengikuti repository setelah redesign contract.

### Stage B — Transactional execution

Satu domain executor menjalankan actions dalam transaksi yang benar.

Business mutation tidak boleh tersebar di parser/interpreter/presentation.

---

## 9. CART AS FIRST-CLASS DOMAIN

Audit menemukan QloBot memiliki beberapa representasi cart: `confirmedItems`, `draft Order.items`, dan `OrderItem`. Ini merupakan sumber kompleksitas dan risiko divergence. fileciteturn8file14turn8file16

### Target Gen 2.0

Satu authoritative cart aggregate:

```text
Cart
 ├── CartItem
 │    ├── productId
 │    ├── variantId (optional)
 │    ├── quantity
 │    └── authoritative price snapshot
 └── totals
```

Identity tidak boleh bergantung pada nama produk/fuzzy matching.

Order adalah snapshot/hasil checkout dari cart, bukan sumber kebenaran kedua yang paralel.

### Migration principle

Migration bertahap:

1. create new model,
2. backfill,
3. dual-read verification if needed,
4. cutover writes,
5. cutover reads,
6. remove legacy representation.

C1/C5 adalah refactor besar dan tidak boleh dilakukan sebagai satu big-bang change. fileciteturn8file14

---

## 10. CONVERSATION STATE

Audit menemukan state tersebar di `lastMessages`, `extractedEntities`, dan `workspace_v2`, dengan risiko migrasi V1→V2 yang rapuh. fileciteturn8file17

### Target

Satu clear source of truth untuk working conversation state.

Legacy state tidak boleh terus menjadi active writer setelah cutover.

Migration harus:

- observable,
- reversible during transition,
- tested against golden dataset,
- tidak menyebabkan silent no-op.

---

## 11. AI PROVIDER BOUNDARY

QloBot sudah memiliki AI provider manager dengan Gemini primary, Groq fallback, key rotation/cooldown/circuit-breaker, tetapi V2 masih memiliki direct `groqAdapter` imports. fileciteturn8file8

### Target

```text
Conversation Engine
      ↓
AI Provider Interface
      ↓
AI Provider Manager
   ├── Gemini
   ├── Groq
   └── Future providers
```

Engine tidak boleh mengimpor provider konkret secara langsung.

Satu policy retry/provider fallback dan satu observability boundary.

---

## 12. RETRY / RELIABILITY POLICY

Audit menemukan empat lapis retry/circuit-breaker yang bertumpuk. fileciteturn8file14

### Target

Satu kebijakan reliability per external boundary:

- AI provider,
- WhatsApp gateway,
- push provider,
- other external integrations.

Jangan ada retry storm.

Setiap retry harus memiliki:

- timeout,
- max attempts,
- backoff,
- observability,
- clear owner.

---

## 13. WEBHOOK SECURITY

Audit menemukan GOWA webhook saat ini tidak melakukan HMAC/secret verification pada boundary masuk. Ini harus diperlakukan sebagai security workstream, bukan cosmetic improvement. fileciteturn8file14

### Target

```text
Inbound webhook
 ↓
Verify signature/secret
 ↓
Tenant resolution
 ↓
Process
```

Perubahan dilakukan bertahap dengan rollout aman dan test terhadap traffic sah.

---

## 14. DEPENDENCY / ADAPTER BOUNDARY

Ambil pola OpenShip yang baik: typed adapter/registry dan provider abstraction. fileciteturn8file17

QloBot boleh bergerak dari service locator yang rapuh menuju dependency boundary yang lebih eksplisit.

Target:

- typed interfaces,
- explicit dependencies,
- testable adapters,
- no accidental direct provider imports.

Jangan rewrite seluruh container sekaligus.

---

## 15. REALTIME

QloBot mempertahankan Socket.IO + EventBus untuk kebutuhan Web customer, dashboard, typing, presence, handoff, dan notification coordination.

OpenShip SSE tidak otomatis lebih baik untuk QloBot karena problem domain berbeda. Audit sendiri menyatakan C9 sebagai architectural/high-risk change. fileciteturn8file14

### Rule

Jangan mengganti transport realtime tanpa bukti yang mengalahkan fondasi yang sudah berjalan.

Yang boleh diperbaiki adalah:

- dispatch clarity,
- event contract,
- tenant isolation,
- multi-instance readiness ketika diperlukan,
- duplicate delivery prevention.

---

## 16. WHATSAPP

WhatsApp tetap first-class channel.

QloBot mempertahankan:

- Fonnte,
- GOWA,
- existing WA pipeline,
- human/AI handoff compatibility.

Chatbox tidak memaksa customer pindah dari WhatsApp.

---

## 17. PWA MERCHANT APP

PWA adalah strategic differentiator.

Installed experience harus terasa seperti aplikasi merchant:

```text
[Merchant logo]
Merchant Name
```

bukan QloBot generic.

Requirements:

- correct start_url,
- scope `/c/`,
- merchant name/icon,
- standalone experience,
- Service Worker existing tetap owner,
- browser-level verification.

---

## 18. TENANT / SECURITY INVARIANTS

Seluruh redesign/refactor wajib menjaga:

- store isolation,
- conversation ownership,
- customer ownership,
- server-side authorization,
- minimal public fields,
- no secret exposure,
- no client-authoritative business state.

---

## 19. TESTING STRATEGY

Generation 2.0 tidak diterima hanya berdasarkan typecheck.

### Required

- unit tests,
- domain tests,
- golden conversation dataset,
- cart invariant tests,
- persistence invariant tests,
- webhook security tests,
- AI provider failover tests,
- realtime smoke,
- multi-tenant tests,
- browser E2E,
- screenshot visual QA.

### Browser QA

Playwright/Chromium dapat dipasang sementara untuk development verification.

Visual hard gates:

- professional,
- modern,
- premium,
- lightweight,
- not flat/boring,
- not childish,
- not 2000s form,
- merchant pride test,
- five-second test.

---

## 20. GENERATION 2.0 CHANGE PRINCIPLE

Perubahan backend diperbolehkan bila:

```text
Need
 ↓
Verify
 ↓
Design
 ↓
Owner review for high-risk change
 ↓
Minimal migration / refactor
 ↓
Test
 ↓
Cutover
```

"Protected" berarti jangan disentuh tanpa alasan teknis yang kuat, bukan berarti immutable selamanya.

Jika improvement besar memang menghasilkan UX/reliability yang jauh lebih baik, perubahan boleh dilakukan bahkan jika harus membuang sebagian pekerjaan lama.

---

## 21. WHAT WE TAKE FROM OPENSHIP

### Adopt strongly

- conversational commerce patterns,
- typed commerce contracts,
- stable cart identity,
- adapter/provider boundary,
- clean transport/domain separation,
- commerce UI patterns,
- progressive product discovery.

### Adapt carefully

- platform adapter pattern,
- cart abstraction,
- typed tool/action contract,
- frontend statelessness philosophy.

### Do not copy wholesale

- Next.js stack,
- OpenShip routing/auth,
- OpenShip transport/MCP architecture,
- OpenShip database philosophy,
- OpenShip realtime transport.

OpenShip is a reference for patterns, not the QloBot runtime. Audit confirms OpenShip is a stateless proxy while QloBot owns the data. fileciteturn8file7

---

## 22. WHAT WE KEEP FROM QLOBOT

- WhatsApp / Fonnte / GOWA,
- conversation intelligence,
- customer context,
- human handoff,
- structured messages,
- Socket.IO realtime,
- EventBus,
- push notification,
- PWA,
- multi-tenancy,
- dashboard realtime,
- existing persistence/history,
- merchant identity,
- current AI infrastructure where it is demonstrably better.

---

## 23. WHAT WE ARE WILLING TO REFACTOR

High-priority candidates from the OpenShip comparison:

1. Cart architecture.
2. AI provider boundary.
3. Retry/circuit-breaker policy.
4. Webhook authentication.
5. Typed commerce action contracts.
6. Conversation-state single source of truth.
7. Adapter/DI boundary.
8. Dead entry-point cleanup.

C1/C5/C8/C9 are architecture-level work and require separate design + migration plans. Audit marks them report-only until owner review. fileciteturn8file10

---

## 24. FINAL PRODUCT STATEMENT

> **QloBot bukan sekadar bot WhatsApp.**
>
> **QloBot adalah intelligent commerce platform dengan WhatsApp sebagai pintu komunikasi dan Chatbox/PWA sebagai pengalaman belanja premium milik merchant.**
>
> Backend boleh rumit.
> Frontend tidak boleh rumit bagi user.
>
> **Simple in the hand. Sophisticated underneath.**
