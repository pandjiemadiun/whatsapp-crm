# ROADMAP QLOBOT GENERATION 2.0
## From WhatsApp Bot to Intelligent Commerce Experience

**Status:** Proposed master roadmap
**Date:** 2026-08-14

---

## 0. CURRENT POSITION

Generation 1 sudah menghasilkan fondasi yang kuat:

- Fase 0 — contracts/verification
- Fase 1 — web realtime
- Fase 2 — structured messages
- Fase 3 — dashboard ↔ web human messaging
- Fase 4 — web push notification
- Fase 5 — UI/UX implementation partially complete but not yet at final product-quality gate

Gen 2 tidak menghapus hasil tersebut. Gen 2 mengambil yang sudah bagus, memperbaiki boundary yang terbukti rapuh, lalu membangun experience yang jauh lebih kuat.

---

# 1. GEN 2 PHASE MAP

```text
GEN 2.0
│
├── G2-A  Baseline + Safety Freeze
│
├── G2-B  Core Architecture Hardening
│   ├── Webhook security
│   ├── AI provider boundary
│   ├── retry/circuit policy
│   └── dead entry-point cleanup
│
├── G2-C  Commerce Domain Refactor
│   ├── Cart aggregate
│   ├── CartItem identity
│   ├── Order snapshot
│   └── typed commerce actions
│
├── G2-D  Conversation State Refactor
│   ├── single working-state source
│   ├── V1/V2 cutover strategy
│   └── golden dataset protection
│
├── G2-E  Storefront UI / UX
│   ├── OpenShip-inspired commerce patterns
│   ├── premium QloBot design system
│   ├── chat + commerce
│   └── merchant PWA
│
├── G2-F  Checkout / Order / Payment Foundation
│   ├── customer order API
│   ├── checkout
│   ├── payment
│   └── tracking
│
├── G2-G  Realtime + Scale Hardening
│   ├── event delivery cleanup
│   ├── multi-instance readiness
│   └── presence hardening
│
└── G2-H  Release Readiness
    ├── browser E2E
    ├── security audit
    ├── load/reliability test
    ├── visual QA
    └── production release
```

---

# 2. G2-A — BASELINE + SAFETY FREEZE

### Goal
Membuat baseline yang bisa dibandingkan selama refactor besar.

### Tasks

- tag/branch Gen 2 baseline,
- record current smoke suites,
- run golden dataset,
- record cart invariants,
- record AI provider behavior,
- record webhook flows,
- record realtime flows,
- record PWA/browser screenshots.

### Exit criteria

Tidak ada baseline yang hilang.

---

# 3. G2-B — CORE ARCHITECTURE HARDENING

Urutan:

### B1 — Webhook security

Verify and implement HMAC/secret validation at inbound boundary.

Acceptance:

- forged webhook rejected,
- valid webhook accepted,
- tenant resolution unchanged,
- Fonnte/GOWA legitimate flow preserved.

Audit identified the GOWA boundary as unauthenticated today. fileciteturn8file14

### B2 — AI provider boundary

Move V2 LLM calls away from direct `groqAdapter` imports toward one provider abstraction/manager.

Acceptance:

- engine does not import concrete AI provider,
- Gemini/Groq policy works as intended,
- token attribution remains correct,
- golden dataset remains green.

### B3 — Retry/circuit policy

Unify external-provider reliability policy.

Acceptance:

- one clear owner per retry/breaker,
- bounded latency,
- no retry storm,
- telemetry understandable.

### B4 — Dead code cleanup

Verify and remove `message.handler.ts` only after final reference/build verification.

---

# 4. G2-C — COMMERCE DOMAIN REFACTOR

This is the most important backend refactor.

### C1 — Cart aggregate

Create stable:

```text
Cart
CartItem
productId
variantId?
quantity
price snapshot
```

### C2 — Typed commerce actions

Conversation stage outputs typed actions.

### C3 — Transactional executor

Actions execute atomically.

### C4 — Order snapshot

Order is created from cart/checkout state, not maintained as a competing cart representation.

### C5 — Legacy migration

Backfill and cut over in phases.

### Exit criteria

- one cart source of truth,
- no name-based fuzzy cart identity,
- no dual cart mutation,
- atomic mutation,
- cart/order invariant tests green.

Audit rated current cart/state architecture high-risk and migration-heavy. fileciteturn8file14

---

# 5. G2-D — CONVERSATION STATE REFACTOR

### Goal
Menghapus state writer/reader yang berkompetisi antara legacy `extractedEntities` dan `workspace_v2`.

### Tasks

- define canonical working state,
- migrate readers/writers,
- remove silent no-op path,
- cut over V1/V2 carefully,
- preserve clarification/context behavior.

### Guardrails

- golden dataset,
- multi-turn tests,
- clarification tests,
- cart tests,
- no regression to handoff.

### Exit criteria

Tidak ada dual writer untuk state kerja yang sama.

Audit confirmed the existing state split and migration fragility. fileciteturn8file17

---

# 6. G2-E — MERCHANT STOREFRONT EXPERIENCE

Ini adalah customer-facing centerpiece.

### E1 — Design system

Adopt pattern DNA from OpenShip + Storefront UI + premium storefront references, then build QloBot-native design system.

### E2 — First impression

User dapat melihat merchant identity, search/discovery, product preview, chat, dan WhatsApp tanpa belajar.

### E3 — Product discovery

Public product browsing tanpa wajib mengetik.

### E4 — Conversation commerce

Product/product_list/cart/quick reply/handoff terasa native di conversation.

### E5 — Cart UX

Contextual cart sheet/drawer.

### E6 — Human handoff

Human terasa manusia.

### E7 — PWA merchant app

Installed PWA menampilkan merchant identity dan membuka merchant storefront yang benar.

### E8 — Browser visual QA

Playwright/Chromium required.

### Exit criteria

Semua visual hard gates:

- professional,
- modern,
- premium,
- lightweight,
- no 2000s-form aesthetic,
- merchant pride test pass,
- five-second test pass.

---

# 7. G2-F — CHECKOUT / ORDER / PAYMENT FOUNDATION

Fitur ini memang belum tersedia secara customer-facing pada Gen 1.

### F1 — customer order API
### F2 — checkout session
### F3 — payment provider boundary
### F4 — payment confirmation webhook
### F5 — order tracking
### F6 — structured order/checkout/payment messages

### Rule

Backend authoritative.

Frontend tidak boleh menentukan payment/order success.

---

# 8. G2-G — REALTIME + SCALE HARDENING

Tidak otomatis mengganti Socket.IO.

### Tasks

- event dispatch simplification,
- multi-instance strategy,
- presence durability,
- duplicate event protection,
- reconnect consistency,
- notification coordination.

Redis adapter / distributed presence hanya bila deployment benar-benar membutuhkan.

---

# 9. G2-H — RELEASE READINESS

### Security

- webhook auth,
- auth boundary,
- tenant isolation,
- secret exposure,
- public API audit.

### Reliability

- provider outage,
- webhook replay,
- reconnect,
- AI timeout,
- push failure.

### Performance

- first paint,
- product loading,
- conversation rendering,
- large history,
- mobile network.

### UX

- browser screenshots,
- mobile device testing,
- PWA standalone.

### Release gate

No release until:

- critical tests green,
- security findings resolved,
- visual acceptance green,
- no known data integrity violation.

---

# 10. CROSS-PHASE RULES

### Rule A — Backend is not sacred
Jika perubahan backend memang menghasilkan domain yang lebih benar, lebih reliable, lebih secure, atau UX yang jauh lebih baik, perubahan diperbolehkan.

### Rule B — No blind rewrite
Refactor besar harus memiliki migration plan, rollback/transition story, dan tests.

### Rule C — One source of truth
Untuk setiap business state harus jelas owner-nya.

### Rule D — Frontend is not business authority
UI hanya render/action client; backend/domain tetap authoritative.

### Rule E — WhatsApp remains first-class
Jangan memaksa customer meninggalkan WhatsApp.

### Rule F — OpenShip is reference, not dependency
Ambil pattern terbaik; jangan membawa seluruh architecture OpenShip.

### Rule G — Visual QA is a release gate
Build hijau tidak cukup.

---

# 11. PRIORITY ORDER

Jika resources terbatas:

```text
P0 Security / data integrity
 ↓
P0 Cart + conversation state correctness
 ↓
P1 AI provider / retry boundary
 ↓
P1 Storefront UX
 ↓
P1 Checkout/order/payment foundation
 ↓
P2 realtime scale hardening
 ↓
P2 polish/future integrations
```

---

# 12. WHAT NOT TO DO

- Jangan mengganti QloBot dengan OpenShip secara wholesale.
- Jangan menambahkan migration hanya demi kosmetik.
- Jangan fake checkout/payment.
- Jangan memindahkan authority ke frontend.
- Jangan menghapus WhatsApp.
- Jangan mengganti Socket.IO hanya karena OpenShip menggunakan SSE.
- Jangan big-bang rewrite cart/state tanpa transition plan.
- Jangan menyatakan UI selesai tanpa browser QA.

---

# 13. GEN 2 DEFINITION OF DONE

QloBot Gen 2 dianggap berhasil ketika:

### Customer

- dapat datang dari WhatsApp ke Chatbox dengan friction rendah,
- dapat melihat produk tanpa mengetik,
- dapat chat dengan AI,
- dapat berbicara dengan human,
- dapat melihat cart,
- dapat memilih WhatsApp,
- dapat menginstall PWA merchant,
- merasakan UX yang lebih kaya daripada WhatsApp.

### Merchant

- mudah memahami inbox,
- mudah takeover,
- brand terlihat profesional,
- dapat membagikan Chatbox tanpa malu.

### Backend

- cart satu source of truth,
- conversation state jelas,
- AI provider boundary jelas,
- retry policy jelas,
- webhook secure,
- domain actions typed,
- persistence atomic,
- tenant isolation kuat.

### Engineering

- regression suite green,
- browser E2E green,
- security green,
- performance acceptable,
- rollback/migration story tersedia untuk refactor besar.

---

# 14. FINAL STATEMENT

> **QloBot Generation 2.0 bukan sekadar versi baru UI.**
>
> Ia adalah evolusi dari WhatsApp bot menjadi **intelligent commerce experience**:
>
> **WhatsApp sebagai pintu komunikasi.**
> **Chatbox/PWA sebagai storefront premium milik merchant.**
> **Conversation Engine sebagai otak.**
> **Commerce domain sebagai sumber kebenaran.**
> **Backend kompleks bila perlu, tetapi pengalaman user tetap sederhana.**
