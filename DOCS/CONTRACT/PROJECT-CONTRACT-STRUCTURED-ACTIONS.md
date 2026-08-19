# QloBot Project Contract — Structured Actions & LLM Boundary

**Status:** DRAFT — owner approval required before implementation
**Scope:** G2 architecture hardening for structured customer actions
**Current first implementation target:** P0 — `ADD_TO_CART`

---

## 1. Purpose

QloBot has two fundamentally different classes of customer input:

1. **Free text** — natural language where interpretation may require the Conversation Engine / LLM.
2. **Structured action** — an explicit UI action whose meaning is already known, such as tapping `+ Keranjang`, `Katalog`, `Produk Lain`, `Keranjang`, or `Hubungi Admin`.

These two classes MUST NOT share the same execution path when the action meaning is already known.

### Final principle

```text
STRUCTURED ACTION
        ↓
Typed Action Router
        ↓
Validated Action Handler
        ↓
Domain Authority

FREE TEXT
        ↓
Conversation Engine / LLM
        ↓
Validated Structured Intent
        ↓
Typed Action Handler
        ↓
Domain Authority
```

The LLM is an interpreter for ambiguous human language. It is NOT the executor or decision-maker for an action whose type and identifiers are already known.

---

## 2. Architecture Principles

### 2.1 Structured actions bypass the LLM

If the client already knows the action and its authoritative identifiers, the action MUST NOT be converted into natural-language text and sent to `/message` for interpretation.

Bad:

```text
Tap + Keranjang
    ↓
"tambah Bawang merah ke keranjang"
    ↓
LLM
    ↓
ADD_TO_CART?
```

Required:

```text
Tap + Keranjang
    ↓
ADD_TO_CART
productId = authoritative product id
quantity = 1
    ↓
Action Registry
    ↓
CartAuthority
```

### 2.2 Free text remains first-class

Natural-language inputs continue through the existing Conversation Engine.

Example:

```text
"Kak, saya mau dua kentang dan satu wortel"
        ↓
Conversation Engine / LLM
        ↓
validated structured intent/actions
        ↓
existing domain authority
```

The goal is NOT to remove the LLM. The goal is to stop using it where interpretation is unnecessary.

### 2.3 One domain authority

A structured action and an LLM-derived action MUST converge on the same domain authority.

For cart mutations:

```text
Structured UI action ─┐
                      ├─→ CartAuthority
LLM validated action ─┘
```

There must not be separate Web-cart and conversation-cart business logic.

### 2.4 Backend authority

Frontend state is presentation/input state only. Product identity, stock, price, cart state, order state, tenant ownership, and customer ownership remain server/domain authoritative.

### 2.5 Preserve existing Conversation Engine

This contract does NOT authorize a rewrite of the Conversation Engine.

The first migration must happen at the input/action boundary and use existing domain authority wherever possible.

---

## 3. Five Mandatory Questions Before Any Change

Every robot/agent proposing a change MUST answer these five questions BEFORE modifying code:

### Q1 — Input classification

Is this input:

- a structured action, or
- free-form human language?

### Q2 — Authority

Who is the authoritative owner of the resulting business action/state?

### Q3 — LLM necessity

Does this input genuinely require an LLM to interpret?

If the action is already explicit, the answer is **NO**.

### Q4 — Unnecessary LLM path

If the action does not require an LLM, why is it currently passing through the Conversation Engine?

The answer must identify the exact boundary to remove or bypass.

### Q5 — Regression boundary

What exact existing behavior, contract, file, test, UI surface, or domain invariant must NOT change?

Any change without explicit answers to all five questions is out of contract.

---

## 4. Action Registry Contract

The Action Router MUST be a typed registry, NOT a growing `if/else` or `switch` statement.

Each action definition owns:

- action type
- request schema
- response type
- handler
- error mapping
- authorization/context requirements

Conceptual TypeScript contract:

```ts
import { z } from 'zod';

type ActionType =
  | 'ADD_TO_CART'
  | 'OPEN_CATALOG'
  | 'SHOW_RELATED_PRODUCTS'
  | 'OPEN_CART'
  | 'CONTACT_ADMIN'
  | 'CLEAR_CHAT';

interface ActionContext {
  storeId: string;
  customerId: string;
  conversationId: string;
  channel: 'web' | 'whatsapp';
  requestId: string;
}

interface ActionDefinition<
  TType extends ActionType,
  TRequest extends z.ZodType,
  TResponse,
> {
  type: TType;
  requestSchema: TRequest;
  execute(
    request: z.infer<TRequest>,
    context: ActionContext,
  ): Promise<TResponse>;
}

type ActionRegistry = {
  [K in ActionType]: ActionDefinition<K, z.ZodType, unknown>;
};
```

Implementation requirements:

- registry entries are registered independently;
- adding a new action MUST NOT require growing a central switch-case;
- each handler validates its own payload before execution;
- the registry does not own business authority — it delegates to the domain service;
- authorization/tenant/customer context is resolved server-side.

---

## 5. P0 — ADD_TO_CART Contract

### 5.1 Request

The client sends a typed action. The client does NOT send product name as authority.

```ts
type AddToCartRequest = {
  actionId: string; // UUID/idempotency key for this user intent
  type: 'ADD_TO_CART';
  payload: {
    productId: string;
    quantity: number;
  };
};
```

### 5.2 Validation

```ts
const AddToCartSchema = z.object({
  actionId: z.string().uuid(),
  type: z.literal('ADD_TO_CART'),
  payload: z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
  }),
});
```

`storeId`, `customerId`, `conversationId`, and channel MUST NOT be trusted from arbitrary client payload as business authority. They are resolved server-side from the authenticated/verified Web customer context and store route.

### 5.3 Authority

```text
PWA
 ↓
Action Router
 ↓
ADD_TO_CART handler
 ↓
CartAuthority.executeOps(..., tx) — see §6A.1, the only permitted entry point
 ↓
OrderItem / canonical cart representations
```

The P0 handler MUST reuse the existing `CartAuthority` rather than recreating cart logic. Per the locked transaction design in §6A, this MUST be `CartAuthority.executeOps()` specifically — `addLine()` opens its own transaction and cannot participate in the idempotency-locked transaction boundary.

CartAuthority remains responsible for:

- product identity validation,
- tenant/store scope,
- price authority,
- stock checks appropriate to cart semantics,
- transactionality,
- cart representation synchronization.

### 5.4 Response

The action response is a deterministic action result, not an LLM response.

```ts
type AddToCartResponse = {
  success: true;
  actionId: string;
  type: 'ADD_TO_CART';
  status: 'applied' | 'already_applied';
  result: {
    productId: string;
    quantityAdded: number;
    cart: {
      items: Array<{
        id: string;
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
        subtotal: number;
      }>;
      total: number;
    };
  };
};

type ActionErrorResponse = {
  success: false;
  actionId: string;
  type: 'ADD_TO_CART';
  error: {
    code:
      | 'VALIDATION_ERROR'
      | 'UNAUTHORIZED'
      | 'TENANT_MISMATCH'
      | 'PRODUCT_NOT_FOUND'
      | 'INSUFFICIENT_STOCK'
      | 'CART_ERROR'
      | 'INTERNAL_ERROR';
    message: string;
  };
};
```

The exact transport envelope may be adapted to existing API conventions, but the semantic contract above MUST remain: typed action in, authoritative deterministic result out.

### 5.5 No fake success

A successful UI state MUST NOT be displayed until the authoritative server action succeeds.

The frontend may show a loading state while the request is pending.

The frontend MUST NOT:

- increment a fake cart count;
- calculate a fake cart total;
- create a second cart state;
- persist cart authority in localStorage.

---

## 6. Idempotency Rules

> **Superseded.** The high-level principles below (two-level protection, `actionId` scope) still hold, but the concrete persistence mechanism, transaction boundary, and state machine are now fully specified and LOCKED in **§6A**. Where §6 and §6A appear to differ on mechanism, §6A is authoritative. §6 is kept for the original UI-debounce rationale.

Idempotency is required at TWO levels because idempotency keys alone do not prevent two intentionally separate taps from having two different keys.

### 6.1 UI double-tap protection

The UI action control MUST use a short interaction lock/debounce so one physical gesture cannot immediately produce two action requests.

Requirements:

- disable/lock the button while the same action is in-flight;
- use a bounded short debounce for rapid duplicate taps;
- do not silently discard a later intentional tap after the first action has completed.

The exact debounce duration is implementation detail, not business authority.

### 6.2 Server idempotency

Every structured action request carries a unique `actionId` generated for that single user intent.

Network retries MUST reuse the same `actionId`.

The server must atomically guarantee:

```text
same customer + same store + same action type + same actionId
        ↓
execute at most once
```

If the identical request is retried after a successful execution, return the previously committed result with:

```ts
status: 'already_applied'
```

It MUST NOT add the product a second time.

### 6.3 Idempotency key scope

The uniqueness scope MUST bind the key to the server-resolved tenant/customer context, not merely the raw UUID.

Recommended logical uniqueness:

```text
storeId + customerId + actionType + actionId
```

The implementation may use an existing persistence mechanism if one exists. If a durable idempotency record/table is required, that is a separate backend design decision — this decision has now been made and locked in **§6A**.

Do NOT use frontend-only debounce as the sole protection.

---

## 6A. P0 Transaction & Idempotency — Final Design (Locked)

**STATUS: LOCKED — owner-approved transaction-boundary decisions A–T.**

This section is the final transaction and idempotency contract for P0 `ADD_TO_CART`.
It is not a design suggestion. These decisions MUST NOT be re-evaluated, re-designed,
or silently changed during implementation.

### 6A.1 CartAuthority Entry Point — Final

P0 structured `ADD_TO_CART` MUST use exactly:

```text
CartAuthority.executeOps(
    ops,
    storeId,
    customerId,
    conversationId,
    tx
)
```

Rules:

- `CartAuthority.executeOps(...)` is the **only** CartAuthority entry point for P0.
- `CartAuthority.addLine()` MUST NOT be used.
- `ConversationService.executeCartOps()` MUST NOT be used.
- **CartAuthority MUST NOT be modified for P0.**
- The external `tx` MUST be the same transaction that owns the
  `ActionIdempotency` row lock and final state transition.

### 6A.2 ActionIdempotency Schema — Final — **AMENDED 2026-08-16**

> **AMENDMENT:** `actionType` is now an explicit schema field and the
> database MUST enforce logical uniqueness with
> `(storeId, customerId, actionType, actionId)`. `idempotencyKey` remains a
> secondary lookup key and is not the sole uniqueness enforcement.

**Historical pre-amendment text retained for audit/history:**

<details>
<summary>Original §6A.2 before amendment</summary>

```text
ActionIdempotency {
  idempotencyKey   String @id
  actionId         String
  customerId       String
  storeId          String
  status           String  // CLAIMED | COMPLETED | FAILED
  claimedAt        DateTime
  result           Json?
  error            Json?   // { code, message } — NOT stack trace
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  completedAt      DateTime?
}
```

Logical uniqueness:

```text
storeId + customerId + actionType + actionId
```

</details>

**Amended schema:**

```text
ActionIdempotency {
  idempotencyKey   String @id
  actionId         String
  actionType       String
  customerId       String
  storeId          String
  status           String  // CLAIMED | COMPLETED | FAILED
  claimedAt        DateTime
  result           Json?
  error            Json?   // { code, message } — NOT stack trace
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  completedAt      DateTime?

  @@unique([storeId, customerId, actionType, actionId])
}
```

Retention is **PERMANENT**.

- No TTL.
- No automatic deletion because a lease expired.
- No cleanup that can erase historical idempotency identity.

Logical uniqueness is enforced by the database:

```text
storeId + customerId + actionType + actionId
```

`idempotencyKey` remains available as a secondary lookup key. It MUST NOT be
relied upon as the only enforcement of logical uniqueness.

### 6A.3 The Only Stage-2 Execution Path — **AMENDED 2026-08-16**

> **AMENDMENT:** A locked re-check that finds `FAILED` MUST return the stored
> business error immediately. It MUST NOT call `executeOps()` again. This closes
> the race where the initial plain SELECT observed `CLAIMED` but the status became
> `FAILED` before the `FOR UPDATE` lock was acquired.

There is exactly **one** Stage-2 executor:

```text
executeClaimedAction()
```

There MUST NOT be separate implementations for the original claimant
and lease-expired recovery.

Both MUST use:

```text
BEGIN TRANSACTION
        ↓
SELECT ActionIdempotency FOR UPDATE
(via tx.$queryRaw; Prisma 5.22.0)
        ↓
RE-CHECK latest status
        ↓
IF COMPLETED
    → return stored result
    → STOP
        ↓
IF FAILED
    → return stored error
    → STOP
    → DO NOT call executeOps()
        ↓
IF CLAIMED
    → CartAuthority.executeOps(..., tx)
        ↓
IF SUCCESS
    → mark COMPLETED
    → store deterministic result
    → COMMIT
        ↓
IF ERROR
    → ROLLBACK
    → classify error
```

### 6A.4 Permanent Locking Rule

> **No one may call `CartAuthority.executeOps()` for a structured action
> without first acquiring a `FOR UPDATE` lock on the corresponding
> `ActionIdempotency` row and performing the latest state re-check inside
> the SAME transaction.**

This applies to every path, including the original Stage-1 claimant.

There is no bypass.
There is no special normal path.
There is no recovery-only lock.

### 6A.5 Initial Plain-SELECT Routing — Four Branches — **AMENDED 2026-08-16**

> **AMENDMENT:** A plain SELECT that finds `FAILED` returns the stored error
> immediately. It MUST NOT enter `executeClaimedAction()` and MUST NOT execute
> the cart mutation again.

```text
                         ACTION REQUEST
                              │
                              ▼
                    ┌──────────────────┐
                    │    PLAIN SELECT  │
                    │    NO ROW LOCK   │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼─────────────────────┬──────────────────┐
          │                  │                     │                  │
          ▼                  ▼                     ▼                  ▼
     NO RECORD          COMPLETED              CLAIMED             FAILED
          │                  │                     │
          │                  │              ┌──────┴──────┐
          │                  │              │             │
          │                  │        LEASE VALID   LEASE EXPIRED
          │                  │              │             │
          │                  │             409            │
          │                  │                            │
          ▼                  ▼                            ▼
       STAGE 1          return stored             executeClaimedAction()
       short TX             result
       INSERT CLAIMED
          │
        COMMIT
          │
          └──────────────────────┐
                                 ▼
                         executeClaimedAction()
```

#### Branch 1 — No record

1. Short independent transaction.
2. INSERT `CLAIMED`.
3. Commit.
4. Enter `executeClaimedAction()`.
5. No shortcut directly to `executeOps()`.

#### Branch 2 — COMPLETED

- Return stored deterministic result.
- Do NOT enter `executeClaimedAction()`.
- Do NOT execute the cart mutation again.

#### Branch 4 — FAILED

- Return the stored structured business error directly.
- Do NOT enter `executeClaimedAction()`.
- Do NOT acquire `FOR UPDATE`.
- Do NOT call `CartAuthority.executeOps()`.
- `FAILED` is definitive and the original rejected mutation MUST NOT be retried
  under the same `actionId`.

#### Branch 3 — CLAIMED

**Lease valid:**

- immediate `409 action_in_progress`;
- no `FOR UPDATE`;
- no waiting;
- no polling;
- no held connection.

**Lease expired:**

- enter `executeClaimedAction()` recovery.

Initial lease target is 30–60 seconds, but the final value MUST be derived
from measured worst-case `executeOps()` latency plus realistic DB contention.

### 6A.6 executeClaimedAction() — Locked Execution Detail — **AMENDED 2026-08-16**

> **AMENDMENT:** The locked status re-check has three outcomes: `COMPLETED`,
> `FAILED`, or `CLAIMED`. If `FAILED` is observed, return the stored error and
> stop. `executeOps()` MUST NOT be called again.

```text
executeClaimedAction()
        │
        ▼
BEGIN interactive transaction
        │
        ▼
SELECT ActionIdempotency
FOR UPDATE
        │
        ▼
RE-CHECK latest status
        │
   ┌────┼──────────────┐
   │    │              │
   ▼    ▼              ▼
COMPLETED FAILED       CLAIMED
   │    │              │
   ▼    ▼              ▼
return return       CartAuthority.executeOps(
result  stored error     ops,
STOP    STOP             storeId,
        no executeOps()  customerId,
                         conversationId,
                         tx
                       )
                           │
                      ┌────┴────┐
                      │         │
                   SUCCESS    ERROR
                      │         │
                      ▼         ▼
               mark COMPLETED  classify error
               + result             │
                      │       ┌─────┴──────────┐
                      │       │                │
                      │    BUSINESS      INFRASTRUCTURE
                      │       │                │
                      │       ▼                ▼
                      │ ROLLBACK TO       outer TX fails
                      │ SAVEPOINT         / ROLLBACK
                      │       │                │
                      │       ▼                ▼
                      │ status=FAILED      status remains
                      │ error={code,msg}   CLAIMED
                      │       │                │
                      │       ▼                ▼
                      │    COMMIT          LEASE/RECOVERY
                      │
                      ▼
                   COMMIT
```

The initial plain SELECT is never trusted as the final execution decision.
The locked transaction MUST re-check the latest state. `FAILED` is terminal for
that `actionId`: its stored error is returned and the cart mutation is never
executed again.

### 6A.7 Lease / Recovery Rule

```text
CLAIMED + lease valid
    → immediate 409

CLAIMED + lease expired
    → executeClaimedAction()
    → FOR UPDATE + latest state re-check
```

Lease expiry is a recovery threshold, NOT record retention.

Expired records remain permanently stored.

### 6A.8 claimToken — Explicitly Excluded

P0 does **NOT** contain `claimToken`.

PostgreSQL `FOR UPDATE` is the concurrency arbiter.

A token would add optimistic compare-and-swap complexity without adding
correctness to this pessimistic-lock design.

### 6A.9 Error Classification — Final — **AMENDED 2026-08-16**

> **AMENDMENT:** The business-error path now uses a SAVEPOINT inside the
> existing Stage-2 transaction. The `ActionIdempotency` row lock is therefore
> retained while cart mutations are rolled back and `FAILED` is recorded.
> The infrastructure-error semantics remain unchanged: the outer transaction
> fails, the status remains `CLAIMED`, and lease/recovery handles the uncertain
> outcome.

**Historical pre-amendment text retained for audit/history:**

<details>
<summary>Original §6A.9 before amendment</summary>

```text
Stage 2 transaction
    ↓
FOR UPDATE
    ↓
state re-check
    ↓
executeOps()
    ↓
business error
    ↓
ROLLBACK
    ↓
NEW short transaction
    ↓
status = FAILED
error = { code, message }
    ↓
return business error
```

</details>

#### Business validation error → FAILED

Examples:

- insufficient stock;
- invalid product;
- invalid quantity;
- tenant/business invariant.

Flow:

```text
BEGIN transaction
    ↓
SELECT ActionIdempotency FOR UPDATE
    ↓
state re-check
    ↓
SAVEPOINT cart_action
    ↓
executeOps(..., tx)
    ↓
business error
    ↓
ROLLBACK TO SAVEPOINT cart_action
    ↓
UPDATE ActionIdempotency
  status = FAILED
  error = { code, message }
    ↓
COMMIT
    ↓
return business error
```

The `FOR UPDATE` lock is never released between rollback of the business
mutation and the `FAILED` state transition. The business mutation is rolled
back to the savepoint, while the idempotency state transition remains inside
the same outer transaction.

`FAILED` means:

> **The action was definitively rejected by the business authority.**

#### Infrastructure error → CLAIMED

Examples:

- DB timeout;
- connection reset;
- process crash;
- transaction timeout;
- other uncertain infrastructure failures.

Flow:

```text
Stage 2
    ↓
infrastructure error
    ↓
outer transaction fails / ROLLBACK
    ↓
status remains CLAIMED
    ↓
lease + recovery
```

Do NOT classify uncertain infrastructure outcomes as `FAILED`.

`CLAIMED` means:

> **There is not yet definitive evidence that the action completed or was
> definitively rejected.**

`COMPLETED` means:

> **The action succeeded definitively and its result was durably stored.**

### 6A.10 Full P0 Final Flow — **AMENDED 2026-08-16**

> **AMENDMENT:** `FAILED` is now an explicit terminal branch in both the initial
> plain SELECT and the locked re-check inside `executeClaimedAction()`. A stored
> `FAILED` error is returned directly and `executeOps()` is never re-run for that
> `actionId`.

The complete P0 `ADD_TO_CART` flow is now consistent with the amended
`ActionIdempotency` schema and SAVEPOINT error handling.

```text
                         STRUCTURED ADD_TO_CART
                                  │
                                  ▼
                         PLAIN SELECT (FAST)
                         no FOR UPDATE here
                                  │
              ┌───────────────────┼─────────────────────┬──────────────────┐
              │                   │                     │                  │
              ▼                   ▼                     ▼                  ▼
         NO RECORD            COMPLETED              CLAIMED             FAILED
              │                   │                     │                  │
              │                   │              ┌──────┴──────┐           │
              │                   │              │             │           │
              │                   │        LEASE VALID   LEASE EXPIRED    │
              │                   │              │             │           │
              │                   │             409            │           │
              │                   │       immediate return    │           │
              │                   │                            │           │
              ▼                   ▼                            ▼           ▼
        STAGE 1 SHORT TX    RETURN STORED             executeClaimedAction()
        INSERT CLAIMED          RESULT                         │      RETURN STORED
              │               STOP                            │      ERROR; STOP
           COMMIT                                             │      NO executeOps()
              │                                              │
              └──────────────────┐                           │
                                 ▼                           │
                         executeClaimedAction() ◄────────────┘
                                 │
                                 ▼
                         BEGIN TRANSACTION
                                 │
                                 ▼
                         SELECT FOR UPDATE
                                 │
                                 ▼
                         RE-CHECK STATUS
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
                COMPLETED      FAILED       CLAIMED
                    │            │            │
                    ▼            ▼            ▼
               RETURN       RETURN STORED   SAVEPOINT
               RESULT       ERROR; STOP     cart_action
               STOP         NO executeOps()      │
                                                  ▼
                                          executeOps(..., tx)
                                                  │
                                          ┌───────┴────────┐
                                          │                │
                                       SUCCESS           ERROR
                                          │                │
                                          ▼                ▼
                                     RELEASE          classify error
                                     SAVEPOINT              │
                                          │          ┌──────┴──────────┐
                                          │          │                 │
                                          │       BUSINESS       INFRASTRUCTURE
                                          │          │                 │
                                          │          ▼                 ▼
                                          │    ROLLBACK TO        outer TX fails
                                          │    SAVEPOINT          / ROLLBACK
                                          │          │                 │
                                          │          ▼                 ▼
                                          │    status = FAILED    status remains
                                          │    error={code,msg}   CLAIMED
                                          │          │                 │
                                          │          ▼                 ▼
                                          │       COMMIT          LEASE/RECOVERY
                                          │
                                          ▼
                                   status = COMPLETED
                                   + deterministic result
                                          │
                                          ▼
                                       COMMIT
                                          │
                                          ▼
                                    RETURN RESULT
```

### 6A.10.1 Final transaction semantics

For the successful path:

```text
BEGIN
  SELECT ActionIdempotency FOR UPDATE
  RE-CHECK latest status
  SAVEPOINT cart_action
  executeOps(..., tx)
  RELEASE SAVEPOINT cart_action
  mark COMPLETED + deterministic result
COMMIT
```

For a business validation error:

```text
BEGIN
  SELECT ActionIdempotency FOR UPDATE
  RE-CHECK latest status
  SAVEPOINT cart_action
  executeOps(..., tx)
  ROLLBACK TO SAVEPOINT cart_action
  UPDATE ActionIdempotency
    status = FAILED
    error = { code, message }
COMMIT
```

The row lock remains held until the outer transaction commits. There is no
rollback-to-new-transaction gap between the business mutation rollback and
the `FAILED` transition.

For an infrastructure error:

```text
BEGIN
  SELECT ActionIdempotency FOR UPDATE
  RE-CHECK latest status
  SAVEPOINT cart_action
  executeOps(..., tx)
  infrastructure error
  outer transaction fails / ROLLBACK
```

The `ActionIdempotency` row therefore remains `CLAIMED` for lease/recovery.
No second transaction is opened merely to mark an uncertain infrastructure
outcome as `FAILED`.

### 6A.10.2 Lease threshold — LOCKED at 30000ms (30s) — 2026-08-19

> **OWNER DECISION (2026-08-19, III-9):** The final lease value is now
> **LOCKED at `LEASE_FINAL_MS = 30000` (30 seconds)**, the lower bound of the
> §6A.5 target range (30–60s).

The initial target remains 30–60 seconds. The final lease value was previously
unresolved; it is now locked by owner decision at the lower bound because there
is **no real `executeOps()` p99 latency measurement in the repo** — so the
conservative lower bound is used: far enough above normal DB-write latency, but
not holding recovery hostage on a real crash.

This value is an **owner-decided interim value**, NOT evidence-based. If
production data (p99 `executeOps()` latency under realistic DB contention)
becomes available, the threshold MAY be corrected based on that evidence — not
before. (See BUG-BELUM-DIBERESKAN.md III-9.)
### 6A.11 Stage-2 Prohibitions — Permanent P0 Rules

1. **No `claimToken`.**
2. **No polling/`PROCESSING` state in client responses.**
3. **No network calls or LLM calls inside Stage-2 transaction.**
4. **No deletion of `ActionIdempotency` records because lease expires.**
5. **No CartAuthority modification for P0.**
6. **No Conversation Engine modification for P0.**
7. **No second Stage-2 implementation.**
8. **No direct `CartAuthority.executeOps()` without the `FOR UPDATE` +
   state-re-check invariant.**

### 6A.12 Prisma 5.22.0 Locking Boundary

P0 uses the project's current Prisma **5.22.0**.

The required row lock is obtained through raw SQL inside the same
interactive transaction:

```text
interactive transaction
    ↓
tx.$queryRaw(... SELECT ... FOR UPDATE ...)
    ↓
state re-check
    ↓
typed transaction queries /
CartAuthority.executeOps(..., tx)
    ↓
COMMIT / ROLLBACK
```

The raw lock query and typed Prisma operations MUST use the same transaction
client.

This section does NOT authorize implementation, migration, or Prisma upgrade.

### 6A.13 P0 Scope Lock

This locked design does NOT authorize:

- implementation code;
- database migration;
- Action Router creation;
- CartAuthority changes;
- Conversation Engine changes;
- LLM redesign;
- P1–P8 actions.

Implementation begins only after explicit owner approval.

---

## 7. Identity / Session Consistency

Structured actions and LLM-derived actions MUST resolve to the SAME server-side customer/conversation context.

### Canonical context

```ts
interface ActionContext {
  storeId: string;
  customerId: string;
  conversationId: string;
  channel: 'web' | 'whatsapp';
  requestId: string;
}
```

### Web

The existing Web boundary already resolves customer/conversation using store + `webUid` and verifies the Web conversation ownership/channel. This resolver MUST be reused or extracted into a shared resolver rather than duplicated.

### LLM path

The existing Conversation Engine already receives/resolves conversation context. When a validated LLM action reaches the domain action layer, it MUST carry the same authoritative `storeId`, `customerId`, and `conversationId` context.

### Critical rule

There must NOT be:

```text
Structured Action → identity resolver A
LLM Action        → identity resolver B
```

Instead:

```text
Structured Action ─┐
                   ├─→ shared authoritative ActionContext
LLM Action ────────┘
```

If the current code does not expose a reusable resolver, P0 MUST first identify the exact existing resolver and then introduce the smallest shared boundary necessary. Do not duplicate identity logic inside individual action handlers.

### Tenant invariant

A product/cart action resolved for Store A MUST never mutate Store B state, even if the client attempts to provide Store B identifiers manually.

The server-resolved context is authoritative.

---

## 8. P0 Test Contract

Tests begin with P0. They are NOT deferred to a later "P8" phase.

Minimum P0 acceptance tests:

1. `ADD_TO_CART` request schema accepts a valid UUID productId and positive integer quantity.
2. Invalid payload is rejected before CartAuthority execution.
3. Valid action reaches the existing CartAuthority.
4. Product identity comes from `productId`, not product-name matching in the frontend.
5. Tenant mismatch is rejected.
6. Customer/conversation mismatch is rejected.
7. One valid action adds exactly the requested quantity.
8. Rapid duplicate UI tap cannot create two requests for one physical gesture.
9. Same `actionId` retried over network returns `already_applied` and does NOT add quantity again.
10. A second intentional tap with a different `actionId` is allowed and adds again.
11. Cart total and item state come from authoritative CartAuthority result.
12. No localStorage/frontend cart authority is involved.
13. Existing natural-language `tambah ... ke keranjang` path still works unchanged through the LLM/engine path.
14. Structured action and natural-language action resolve to the same customer/store/conversation context.
15. Existing CartAuthority regression suite remains green.
16. Golden dataset remains green.
17. A business validation failure (e.g. insufficient stock) rolls back the cart mutation, leaves no partial `OrderItem` state, and persists `ActionIdempotency.status = FAILED` with a structured `{code, message}` error.
18. Retrying the same `actionId` after a `FAILED` result does not silently retry the same rejected mutation as `CLAIMED` — behavior matches §6A.9.
19. A `CLAIMED` record whose lease has not expired returns `409 action_in_progress` immediately, with no `FOR UPDATE` acquired and no held connection.
20. A `CLAIMED` record whose lease has expired is only mutated after `executeClaimedAction()` acquires `FOR UPDATE` and re-checks the latest status — a stale read from the initial plain `SELECT` is never trusted for the mutation decision.
21. Two concurrent requests for the same `actionId` (simulated lock contention) result in exactly one `CartAuthority.executeOps()` call; the second resolves via the locked re-check, not a second execution.
22. `CartAuthority.addLine()` and `ConversationService.executeCartOps()` are confirmed unused by the P0 code path (per §6A.1).

A P0 implementation is NOT complete until these tests are green or an explicitly documented blocker is approved.

---

## 9. Structured vs Free-Text Entry Point Matrix

| Entry point | Example | Classification | Target path |
|---|---|---|---|
| Web composer | `ada kentang?` | Free text | Conversation Engine / LLM |
| WhatsApp Fonnte | `ada kentang?` | Free text | Existing WA → Conversation Engine |
| WhatsApp GOWA | `tambah kentang 2` | Free text | Existing WA → Conversation Engine |
| Product card `+ Keranjang` | tap | Structured action | Action Registry → CartAuthority |
| `Produk Lain` | tap | Structured action | Action Registry / discovery handler |
| `Katalog` | tap | Structured action | Direct catalog/discovery handler |
| Header cart | tap | Structured action | Direct authoritative cart read |
| `Hubungi Admin` | tap | Structured action | Existing handoff capability |
| `Hapus Chat` | tap | Structured action | Existing clear-chat capability |
| Back to storefront | tap | UI navigation | Local deterministic UI state |
| Product detail | tap | UI action | Existing product-detail endpoint |
| Order history | future/unreleased | Blocked | Do not fake |
| Help/FAQ | future/unreleased | Blocked | Do not fake |
| Checkout/payment | future | Blocked until customer backend exists | Do not fake |
| Dashboard human reply | admin types | Deterministic | Existing direct persistence/realtime path |

### WA rule

Fonnte/GOWA remain text-only for the current free-tier setup. Do not invent native WA buttons/lists. P7 therefore remains natural-language input until a separate richer WA capability is actually available.

---

## 10. Migration Priority

### P0 — ADD_TO_CART

First structured action. Highest leverage because it is a frequent commerce action and directly affects money/cart state.

### P1 — SHOW_RELATED_PRODUCTS

A UI discovery action. No LLM required.

### P2 — OPEN_CATALOG

Directly open the authoritative product discovery/catalog flow.

### P3 — OPEN_CART

Requires an authoritative customer cart-read capability. Do not fake a cart badge or total if that read capability does not exist.

### P4 — Quick Action Contract

Replace label-as-command for true quick actions with typed action identity. Conversational clarification choices remain compatible with natural-language input when they genuinely represent a conversational answer.

### P5 — Shortcut Actions

Migrate remaining explicit Web shortcuts such as contact admin, clear chat, and future order-status surfaces according to their actual capabilities.

### P6 — Natural Language → Validated Actions

Strengthen the free-text path so the LLM produces validated structured intent/actions before any domain mutation. Use schema validation and domain validation; do not execute unvalidated LLM output.

### P7 — WhatsApp uses the same action contract after interpretation

WA remains text-first. Its natural language is interpreted and validated, then converges on the same typed domain actions. No native WA buttons/lists are assumed.

### P8 — Regression / release gate

Golden dataset, action-contract suite, cart invariants, tenant isolation, realtime regression, provider regression, and browser visual QA are release gates. P8 does NOT mean "start testing"; action tests begin at P0.

---

## 11. Explicitly Do NOT Do

- Do not route structured UI actions through the LLM.
- Do not convert productId-based actions into product-name text.
- Do not use localStorage as business/cart authority.
- Do not create a second Web cart implementation.
- Do not create separate CartAuthority logic for Web and Conversation Engine.
- Do not add broad regex heuristics that attempt to replace natural-language understanding.
- Do not tune temperature, prompt wording, or model choice as a substitute for deterministic routing of structured actions.
- Do not add retry-on-clarify as a substitute for fixing the structured-action boundary.
- Do not move business authority into the PWA.
- Do not calculate cart totals in the frontend.
- Do not trust client-supplied storeId/customerId/conversationId as business authority.
- Do not create a switch-case Action Router that grows indefinitely.
- Do not add fake order history.
- Do not add fake help/FAQ capability.
- Do not fake checkout/payment success.
- Do not replace Socket.IO merely because another reference product uses a different transport.
- Do not rewrite the Conversation Engine to solve a UI action-routing problem.
- Do not modify WhatsApp gateways to simulate native buttons/lists that the current free-tier gateways do not provide.
- Do not modify UI surfaces outside the stated task when implementing a single-slice action migration.
- Do not claim an action is complete without an action-contract test.
- Do not declare a regression-safe change based on typecheck/build alone.

---

## 12. Regression Contract

Every structured-action migration MUST declare its protected surfaces before implementation.

For P0, minimum protected surfaces are:

- Conversation Engine behavior for free-text messages.
- Existing CartAuthority invariants.
- Golden dataset.
- Existing `/message` natural-language flow.
- Tenant isolation.
- Conversation/customer identity continuity.
- Structured-message contract.
- Existing product cards and storefront UI except the specific action wiring.
- WhatsApp behavior.

A robot MUST produce a before/after diff and test evidence for the protected surfaces.

---

## 13. Definition of Done for Each Action

An action is complete only when:

1. It has a registered typed action definition.
2. Its request schema is validated before execution.
3. Its identity context is server-resolved and tenant-scoped.
4. Its handler delegates to the correct domain authority.
5. Idempotency semantics are defined and tested where mutation/retry is possible.
6. Its response contract is typed.
7. Error codes are typed and mapped deterministically.
8. Its action-contract tests are green.
9. Relevant golden/regression tests remain green.
10. No unrelated behavior was changed.
11. Browser/UI behavior is verified if the action is customer-facing.
12. Any missing backend capability is documented instead of faked.

---

## 14. Verified Blueprint / Phase-Report Basis

### Phase 2 — authoritative structured delivery

Verbatim source excerpt:

> "**Structured Message Contract (data that reaches the PWA)**"

The same report defines the authoritative message shape as `MessageCreatedData` with `type` and `payload`, and explicitly records that the delivery layer owns the final structured mapping. Source: `laporan-fase2-web-realtime-structured.md`.

Most directly relevant verbatim excerpt:

> "**Existing `messageType` ownership:** engine **tidak** pernah menulis kolom ini"

The report then states that the delivery layer is the final owner for the structured message type. This is the source-backed basis for keeping business/presentation authority outside frontend heuristics.

### Phase 3 — admin reply is not routed through Conversation Engine

Verbatim source excerpt:

> "22.2 | admin reply NOT via processCustomerMessage | YES | src | conversations.ts /reply direct INSERT | PASS"

The same Phase 3 report documents admin reply persistence as a direct `conversationHistory.create()` and realtime delivery, rather than a call through `processCustomerMessage`.

Source: `laporan-fase3-forensic-audit.md` / `laporan-fase3-dashboard-human-messaging.md`.

---

## 15. Approval Gate

This document is a project contract, not an implementation authorization by itself.

**Required owner approval before P0 implementation.**

After approval:

- implement P0 only;
- do not implement P1-P8 in the same change;
- do not add unrelated refactors;
- stop after P0 verification and report evidence.

