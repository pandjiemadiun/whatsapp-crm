# QloBot Master Roadmap — Architecture, Structured Actions, Hardening & Release

**Document status:** MASTER ROADMAP  
**Purpose:** satu sumber kendali roadmap agar pekerjaan tidak berputar, fase tidak terlupakan, dan status tidak ditentukan hanya dari klaim robot.  
**Update policy:** status dianggap `VERIFIED` hanya jika dibuktikan dari current source + test/build/evidence. Historical phase reports tidak dianggap bukti final.

---

# 0. MASTER STATE — CURRENT SNAPSHOT

## 0.1 Structured Actions

| Phase | Scope | Current Status | Evidence / Rule |
|---|---|---:|---|
| P0 | `ADD_TO_CART` | ✅ VERIFIED | 22 acceptance tests; lease/idempotency/transaction contract proven |
| P1 | `SHOW_RELATED_PRODUCTS` | ✅ VERIFIED | 19 API tests + browser E2E |
| P2 | `OPEN_CATALOG` | ✅ VERIFIED | 16 API tests + browser E2E |
| P3 | `OPEN_CART` | ✅ VERIFIED | 18 API tests + browser E2E |
| P4 | Quick Action Contract | ✅ VERIFIED | label-as-command cleanup + production smoke |
| P5 | `OPEN_ORDER_HISTORY` / Status Pesanan | ✅ VERIFIED | 20 API tests + production browser E2E |
| P6 | Natural Language → Validated Actions | ⏳ NOT IMPLEMENTED | Next structured-action phase |
| P7 | WhatsApp → same typed action contract | ⏳ NOT IMPLEMENTED | WA remains text-first; no native buttons/lists assumed |
| P8 | Regression / Release Gate | ⏳ NOT FINALIZED | Release gate, not “start testing” phase |

## 0.2 Generation 2 / Architecture

| Phase | Scope | Current Status | Notes |
|---|---|---:|---|
| G2-A | Baseline | ✅ VERIFIED COMPLETE | Baseline/exit criteria previously completed |
| G2-B | Core Hardening | ✅ VERIFIED COMPLETE | Previous claimed-but-unwired items were forensic-fixed and reverified |
| G2-C | CartAuthority | ✅ VERIFIED COMPLETE | CartAuthority is current cart/write authority |
| G2-D | Conversation State | 🟡 FORENSIC + ARCHITECTURE COMPLETE; MIGRATION PENDING | L-001/L-002/L-003 remain the migration focus |
| G2-E | Next generation product/storefront work | ⏳ NOT OPENED | Do not infer detailed status without dedicated audit |
| G2-F | Checkout/payment foundation | ⏳ NOT OPENED | Payment success must never be faked |
| G2-G | Realtime/scale/reliability expansion | ⏳ NOT OPENED | Build on hardened Redis/PM2 baseline |
| G2-H | Release readiness | ⏳ NOT OPENED | Final release gate |

## 0.3 Explicitly Deferred / Owner-Controlled

| Item | Status |
|---|---:|
| Fonnte major refactor | ⏸ OWNER DEFERRED — separate scope to be opened later |
| GOWA HMAC/signature | ⏸ OWNER HOLD |
| G2-D migration | 🟡 Pending architecture/implementation execution |
| Legacy cart/state cleanup outside approved migration | ⏸ Deferred until G2-D/explicit approval |

---

# 1. ROADMAP PRINCIPLES

## 1.1 Source of truth

Priority order:

1. Current source code.
2. Locked architecture contract.
3. Current tests/build/e2e evidence.
4. Approved implementation reports.
5. Historical phase reports — historical context only.

A report saying “implemented” is NOT proof.

## 1.2 Structured Action contract

The locked Structured Actions contract requires:

- structured UI actions bypass the Conversation Engine/LLM;
- free text remains first-class and continues through the existing Conversation Engine;
- structured and LLM-derived actions converge on the same domain authority;
- frontend state is presentation/input only;
- store/customer/conversation identity is server-resolved;
- Action Registry is typed and extensible;
- missing backend capability is documented instead of faked.

The contract explicitly states that structured and LLM-derived cart mutations must converge on `CartAuthority`. fileciteturn15file2L1-L15

## 1.3 P0 §6A is LOCKED

P0 transaction/idempotency decisions are locked.

Do not redesign:

- `CartAuthority.executeOps(..., tx)` entry point;
- `ActionIdempotency` state machine;
- `SELECT ... FOR UPDATE`;
- status re-check;
- SAVEPOINT `cart_action`;
- business-error rollback → `FAILED`;
- infrastructure-error outer rollback → lease recovery;
- Prisma 5.22.0 locking boundary;
- Stage-2 prohibitions.

The contract explicitly marks §6A as locked and excludes implementation of P1–P8 from that locked P0 design. fileciteturn15file12L1-L15

## 1.4 No fake capabilities

Never fake:

- order history;
- help/FAQ;
- checkout/payment success;
- cart totals;
- frontend cart authority;
- customer/store ownership.

The contract explicitly lists future order history, help/FAQ, and checkout/payment as blocked until real capability exists. fileciteturn15file19L1-L15

---

# 2. STRUCTURED ACTIONS ROADMAP

## P0 — ADD_TO_CART ✅

### Objective
Replace product-card add-to-cart intent with a deterministic typed action.

### Contract
```text
PWA
  ↓
POST /api/pwa/:storeSlug/action
  ↓
Action Registry
  ↓
claimAction / ActionIdempotency
  ↓
executeClaimedAction
  ↓
FOR UPDATE + status re-check
  ↓
SAVEPOINT
  ↓
CartAuthority.executeOps(..., tx)
  ↓
COMPLETED / FAILED
```

### Required invariants
- `actionId` UUID.
- `productId` UUID.
- positive integer quantity.
- server-derived identity.
- tenant isolation.
- UI duplicate protection.
- durable server idempotency.
- lease recovery.
- business vs infrastructure error classification.

### Verification
- 22/22 acceptance tests.
- Production browser proof.
- CartAuthority regression.
- Protected surfaces unchanged.

### Status
**DONE — DO NOT RE-DESIGN.**

---

# 3. P1 — SHOW_RELATED_PRODUCTS ✅

### Objective
Move related-product discovery from client-side fabrication to backend-authoritative discovery.

### Authority
`productService.getRelatedProducts()`.

### Semantics
Current implemented definition:

- same category;
- same store;
- active;
- non-deleted;
- exclude source product;
- deterministic ordering;
- bounded result.

### UI
Product card → structured action → backend result → structured `product_list`.

### Status
**DONE — DO NOT REOPEN unless a new product-discovery requirement is explicitly approved.**

---

# 4. P2 — OPEN_CATALOG ✅

### Objective
Replace `📖 Katalog` text injection into `/message` with deterministic catalog opening.

### Path
```text
Katalog tap
  ↓
OPEN_CATALOG
  ↓
existing catalog authority
  ↓
backend product result
  ↓
ProductList rendering
```

### Rules
- no LLM;
- no ActionIdempotency;
- no fake local catalog;
- tenant comes from server-resolved session/store slug.

### Status
**DONE.**

---

# 5. P3 — OPEN_CART ✅

### Objective
Replace `lihat keranjang` free-text routing with direct authoritative cart read.

### Authority
`CartAuthority.getCartSummary(conversationId)`.

### Rules
- read-only;
- no mutation lease;
- no frontend cart state;
- backend total authoritative.

### Status
**DONE.**

---

# 6. P4 — QUICK ACTION CONTRACT ✅

### Objective
Remove explicit UI commands that were being injected as free-text labels.

### Completed
- `🎧 Hubungi CS` → existing `/handoff`.
- `Lihat semua` → existing `OPEN_CATALOG`.

### Remaining status surface at historical midpoint
`📦 Status Pesanan` was initially blocked because no customer-scoped order authority existed.

### Final resolution
P5 later implemented `OPEN_ORDER_HISTORY`, so the former P4 blocker is now resolved by P5.

### Status
**DONE.**

---

# 7. P5 — OPEN_ORDER_HISTORY ✅

### Objective
Provide authoritative customer order-history/status without routing explicit UI intent through `/message`.

### Authority
`orderService.getOrderHistoryForWeb(storeId, conversationId)`.

### Safety
- server-resolved store/customer/conversation context;
- `storeId + conversationId` query scope;
- internal fields excluded;
- customer-facing status mapping;
- bounded result set;
- deleted/internal conversational states excluded;
- read-only structured action.

### Structured message
`order_history` added to the structured message contract and rendered by existing PWA structured-message infrastructure.

### Status
**DONE + production verified.**

---

# 8. P6 — NATURAL LANGUAGE → VALIDATED ACTIONS ⏳ NEXT

## 8.1 Purpose

P6 is the convergence phase.

Current system already supports:

```text
Structured UI
    ↓
Action Registry
    ↓
Domain Authority
```

P6 extends the natural-language path so:

```text
Free text
    ↓
Conversation Engine / LLM
    ↓
validated structured intent/action
    ↓
same Action/Domain authority
```

The contract explicitly requires free text to remain first-class while LLM-derived actions converge on the same domain authority used by structured actions. fileciteturn15file5L1-L15

## 8.2 P6 must NOT become an engine rewrite

Do not:

- rewrite Conversation Engine wholesale;
- route deterministic UI taps through the LLM;
- create regex-heavy fake NLU;
- create a second cart implementation;
- execute raw/unvalidated LLM output;
- move business authority into PWA.

The contract explicitly prohibits rewriting the Conversation Engine to solve structured-action routing problems. fileciteturn15file10L1-L15

## 8.3 P6 workstreams

### P6-A — Forensic mapping
Map current natural-language intents/actions:

- add/remove/update cart;
- catalog/product lookup;
- order status;
- clarification;
- fallback/handoff;
- any other business mutations.

### P6-B — Action schema
Define validated machine-level action envelopes.

### P6-C — Validation boundary
LLM output MUST pass:

1. schema validation;
2. business/domain validation;
3. tenant/customer validation;
4. authority execution rules.

### P6-D — Convergence
For cart mutation:

```text
Structured UI action ─┐
                      ├─→ Action/Domain authority
LLM validated action ─┘
```

### P6-E — Regression
Prove existing natural-language behavior remains valid.

### P6-F — Provider boundary
Current Conversation Engine production LLM path:

```text
Conversation Engine
   ↓
LLMGateway
   ↓
Gemini primary
   ↓
GPT-OSS-120B fallback on Groq
```

Do not bypass this boundary.

## 8.4 P6 Definition of Done

P6 is complete only when:

- all targeted NL intents are mapped;
- output schemas validated;
- no unvalidated LLM business mutation;
- structured and NL actions share domain authority;
- tenant/customer identity is server-resolved;
- current P0–P5 tests remain green;
- golden/conversation regression remains green;
- browser regression for affected customer flows passes;
- exact before/after diff is reviewed.

---

# 9. P7 — WHATSAPP → SAME ACTION CONTRACT ⏳

## Objective

Keep WA text-first while converging interpreted customer intent onto the same validated action/domain contract.

### Current rule
Fonnte/GOWA free-tier setup remains text-only.

Do not invent native buttons/lists.

The locked roadmap explicitly states P7 is:

```text
WA free text
   ↓
interpretation
   ↓
validation
   ↓
same typed domain action contract
```

No native WA UI is assumed. fileciteturn15file4L1-L15

## P7 prerequisites

- P6 validated-action boundary stable.
- Fonnte/GOWA architecture explicitly reviewed before implementation.
- Owner Fonnte refactor design incorporated.

## P7 should NOT begin before
- Fonnte refactor scope is presented and approved.
- P6 action contract is proven.
- WA identity/context mapping is proven.

### Status
**NOT IMPLEMENTED.**

---

# 10. G2-D — CONVERSATION STATE MIGRATION 🟡

## Current state

### Completed
- forensic audit;
- architecture review;
- L-001/L-002/L-003 identified.

### Not completed
- controlled migration;
- legacy-state removal;
- final production verification.

## Primary problems to resolve

### G2-D-L-001 — Split authority
Identify competing owners of conversation working state.

### G2-D-L-002 — Multiple cart representations
Classify each representation:

```text
CANONICAL
DERIVED
LEGACY
PRESENTATION ONLY
```

### G2-D-L-003 — Direct DB writes
Find all business-state writes bypassing the intended state/authority boundary.

## Critical rule
G2-D MUST NOT automatically rewrite locked P0 §6A.

Any overlap with:
- `CartAuthority`
- `ActionIdempotency`
- Conversation Engine
- Structured Action contract

must be checked against the locked contract first.

## Recommended sequencing
G2-D should be treated as an architecture/migration project adjacent to P6, not as a replacement for the P6 roadmap.

Before implementation:
- re-audit current source;
- compare against previous G2-D findings;
- identify which findings remain real after P0–P5 and hardening;
- produce a migration plan;
- get owner approval;
- migrate one authority boundary at a time;
- prove regressions after every slice.

### Status
**OPEN — but implementation should be controlled, not improvised.**

---

# 11. G2-E — STORE / STOREFRONT / CUSTOMER UX ⏳

## Goal
Turn backend/structured-action foundations into a coherent customer storefront.

Likely workstreams to audit before opening:

- storefront information architecture;
- product discovery;
- product detail;
- catalog;
- cart;
- chat/storefront transition;
- mobile UX;
- empty states;
- contact CTA;
- visual consistency;
- performance.

### Rule
Do not invent scope before reviewing the current G2-E documents/source.

### Status
**NOT OPENED.**

---

# 12. G2-F — CHECKOUT / PAYMENT FOUNDATION ⏳

## Goal

Establish a real transaction flow:

```text
Catalog
  ↓
Product
  ↓
Cart
  ↓
Checkout
  ↓
Order
  ↓
Payment
  ↓
Order lifecycle
```

### Rules
- no fake payment success;
- order state machine remains authoritative;
- transaction/payment state must be server-side;
- tenant/customer ownership server-side;
- existing P0 §6A remains locked.

### Status
**NOT OPENED.**

---

# 13. G2-G — REALTIME / SCALE / OPERATIONAL HARDENING ⏳

## Scope to be audited before execution

- Socket.IO/realtime;
- multi-instance behavior;
- Redis;
- queueing;
- concurrency;
- observability;
- metrics;
- retries;
- timeouts;
- process persistence;
- browser/backend consistency.

### Already hardened
- Redis rate limiting;
- Redis webhook dedup;
- PM2 persistence;
- LLM provider fallback;
- provider cooldown/circuit behavior.

### Status
**NOT OPENED as a separate roadmap phase.**

---

# 14. G2-H — RELEASE READINESS ⏳

## Goal
A final release gate across:

### Security
- tenant isolation;
- auth;
- webhook trust model;
- rate limits;
- secret exposure;
- replay/dedup;
- headers;
- TLS.

### Commerce
- cart invariants;
- order lifecycle;
- checkout;
- payment;
- order history;
- idempotency.

### AI
- LLMGateway;
- Gemini primary;
- GPT-OSS fallback;
- retries;
- cooldown;
- circuit breaker;
- timeout/deadline;
- model configuration.

### PWA
- mobile UX;
- production build;
- browser smoke;
- action wiring;
- no fake business state.

### Operations
- PM2 persistence;
- backups;
- monitoring;
- logs;
- rollback;
- database migration status.

### Status
**NOT OPENED.**

---

# 15. HARDENING BASELINE — COMPLETED

These are no longer “next roadmap items”; they form the baseline.

## LLM
✅ Conversation Engine → `LLMGateway`  
✅ Gemini primary  
✅ Groq fallback = `openai/gpt-oss-120b`  
✅ GPT-OSS token floor  
✅ Retry/circuit/cooldown/deadline verified  
✅ stale Llama fallback defaults corrected

## Redis
✅ Redis-backed rate limiting  
✅ 8 intended limiters mounted  
✅ webhook dedup Redis NX+EX  
✅ TTL 300s  
✅ concurrent duplicate protection verified

## PWA
✅ structured contact object  
✅ phoneNumber/internal secrets not exposed

## Structured actions
✅ P0–P5

## Production process
✅ PM2 persistence verified  
✅ PWA 502 recovery verified

---

# 16. CURRENT “DO NOT TOUCH” SET

Unless the active task explicitly requires one of these:

- PROJECT-CONTRACT-STRUCTURED-ACTIONS §6A locked design;
- P0 `ADD_TO_CART`;
- existing P1–P5 action contracts;
- CartAuthority mutation design;
- `order-transition.ts`;
- natural-language `/message` behavior while working on a UI-only slice;
- WhatsApp gateway implementation outside explicit Fonnte/GOWA scope;
- database schema/migration outside explicit approved task;
- deferred G2-D legacy cleanup;
- Fonnte major refactor until owner opens it.

---

# 17. EXECUTION RULES FOR ROBOT

Every future implementation task must use:

```text
FORENSIC
  ↓
SCOPE
  ↓
IMPLEMENT
  ↓
BUILD
  ↓
TEST
  ↓
REGRESSION
  ↓
DIFF AUDIT
  ↓
VERDICT
```

## Robot MUST NOT

- trust prior “implemented” claims;
- silently redesign locked contracts;
- modify protected surfaces outside scope;
- report “complete” without evidence;
- use typecheck/build as the only verification;
- fake missing backend capabilities;
- combine unrelated architecture refactors into feature work;
- restore files from HEAD without proving previous-session changes were not lost.

## Robot MUST report

1. exact files changed;
2. exact diff;
3. raw build/test output;
4. protected-surface verification;
5. production/browser evidence when customer-facing;
6. remaining blockers;
7. final verdict.

---

# 18. MASTER NEXT-ACTION ORDER

## NOW

### Step 1 — G2-D current-source forensic refresh
Do NOT implement yet.

Goal:
- re-run G2-D audit against current source;
- identify which L-001/L-002/L-003 findings remain true;
- map dependencies with P0–P5;
- produce migration plan.

### Step 2 — Decide G2-D migration boundary
Owner approves or rejects each migration slice.

### Step 3 — Execute G2-D controlled migration
One authority boundary at a time.

## THEN

### Step 4 — P6
Natural Language → Validated Actions.

### Step 5 — Fonnte refactor
Insert the owner-provided Fonnte design at the correct point after P6 prerequisites are stable.

### Step 6 — P7
WhatsApp → same validated action contract.

## THEN PRODUCT BUILDOUT

### Step 7 — G2-E
Storefront/customer UX.

### Step 8 — G2-F
Checkout/payment.

### Step 9 — G2-G
Realtime/scale/operations.

### Step 10 — P8 + G2-H
Final regression + release readiness.

---

# 19. STATUS RULE

Do not advance a phase merely because code exists.

Use:

```text
PLANNED
  ↓
FORENSIC
  ↓
APPROVED
  ↓
IMPLEMENTED
  ↓
VERIFIED
  ↓
PROVEN / PRODUCTION-VERIFIED
```

A phase remains in its lower status until evidence moves it forward.

---

# 20. ONE-LINE MASTER ROADMAP

```text
G2-A ✅
→ G2-B ✅
→ G2-C ✅
→ G2-D 🟡 migration
→ P6 ⏳
→ Fonnte refactor (owner-defined)
→ P7 ⏳
→ G2-E ⏳
→ G2-F ⏳
→ G2-G ⏳
→ P8 + G2-H ⏳
→ RELEASE
```

**Important:** P0–P5 are already complete and remain historical foundation milestones, not future work.

---

# 21. ROADMAP INTEGRITY RULE

This file is the master roadmap snapshot.

When a new phase is completed:
- update this file;
- record exact evidence;
- move status only after verification;
- record deferred/blocked decisions explicitly.

When a new audit discovers a contradiction:
- update the status to the proven current state;
- preserve the historical claim as historical context;
- do not silently overwrite history.

When a major new architecture decision is approved:
- update this roadmap;
- link it to the relevant contract/design document;
- do not rely on chat memory as the roadmap.
