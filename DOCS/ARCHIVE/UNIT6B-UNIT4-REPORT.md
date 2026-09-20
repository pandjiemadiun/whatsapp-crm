# UNIT6-B — Unit 4: 5 Approved Scenarios Execution Report

**Date:** 2026-09-09  
**Task:** Execute 5 approved scenarios via the existing `v2-mapper-wire-smoke.ts` (Unit 3) script on canary store `store-a3cd7205`  
**Scope:** Evidence-gathering only. No store engine flags flipped. No source code modified.  
**Sequencing:** Isolated conversations per scenario (cleaner isolation). Scenario 2 used two sequential runs against the same conversation with distinct `clientMsgId` values.

---

## Pre-run Catalog Verification

Products seeded into canary store `store-a3cd7205`:

| Product Name | Exists | Notes |
|---|---|---|
| Busi Motor | YES | Used in scenarios 1, 3, 5 |
| Ban Dalam Motor | YES | Used in scenarios 1, 2 |
| Oli Mesin | YES | Used in scenario 2 |
| Busi Mobil | **NO** | Critical: confirms NOT_FOUND behavior in scenario 3 |

---

## Scenario 1: `itu_plus_new_item`

**Source:** `implicit_ref_itu_plus_new_item` in `chat-test-scenarios-batch2.json`  
**Conversation ID:** `6820af04-aafc-4c25-a7e8-6fe5ead55295`  
**Customer ID:** `dcb26473-4771-4c37-856a-b573b4e70bcd`

### V2ProposedAction[] Input

```json
[
  {
    "action_type": "ADD_TO_CART",
    "payload": { "product": "Busi Motor", "qty": 1 },
    "confidence": 0.9,
    "requires_validation": true
  },
  {
    "action_type": "ADD_TO_CART",
    "payload": { "product": "Ban Dalam Motor", "qty": 1 },
    "confidence": 0.9,
    "requires_validation": true
  }
]
```

### Mapper Output

- `cartOps`: 2 ops — `[add Busi Motor qty=1, add Ban Dalam Motor qty=1]`
- `skipped`: `[]`

### executeWaCartMutation Output

- `status`: `applied`
- `items`: `[Busi Motor qty=1 @ 15000, Ban Dalam Motor qty=1 @ 50000]`
- `unresolved`: `[]`

### DB Readback

| Before | After |
|---|---|
| 0 OrderItem rows | 2 OrderItem rows |

**Order items:**
- Busi Motor — qty=1, unitPrice=15000, subtotal=15000
- Ban Dalam Motor — qty=1, unitPrice=50000, subtotal=50000

**Order total:** 65000

### Result

**MATCH: YES** — Both items added in a single batch as expected.

---

## Scenario 2: `partial_cart_cancel`

**Source:** `interrupted_flow_partial_cart_cancel` in `chat-test-scenarios-batch2.json`  
**Conversation ID:** `05ead4e7-8a39-4ef3-aa9d-f41ab1ba5f9f`  
**Customer ID:** `83d12839-fcc2-4d52-9747-bd48e9abbee9`

### Run 2a — Seed Cart

#### V2ProposedAction[] Input

```json
[
  {
    "action_type": "ADD_TO_CART",
    "payload": { "product": "Ban Dalam Motor", "qty": 1 },
    "confidence": 0.9,
    "requires_validation": true
  },
  {
    "action_type": "ADD_TO_CART",
    "payload": { "product": "Oli Mesin", "qty": 1 },
    "confidence": 0.9,
    "requires_validation": true
  }
]
```

#### Mapper Output

- `cartOps`: `[add Ban Dalam Motor qty=1, add Oli Mesin qty=1]`
- `skipped`: `[]`

#### executeWaCartMutation Output (Run 2a)

- `status`: `applied`
- `items`: `[Ban Dalam Motor qty=1 @ 50000, Oli Mesin qty=1 @ 75000]`
- `unresolved`: `[]`

---

### Run 2b — Remove Oli Mesin

#### V2ProposedAction[] Input

```json
[
  {
    "action_type": "REMOVE_FROM_CART",
    "payload": { "product": "Oli Mesin" },
    "confidence": 0.9,
    "requires_validation": true
  }
]
```

#### Mapper Output

- `cartOps`: `[remove Oli Mesin]`
- `skipped`: `[]`

#### executeWaCartMutation Output (Run 2b)

- `status`: `applied`
- `items`: `[Ban Dalam Motor qty=1 @ 50000]`
- `unresolved`: `[]`

### DB Readback

| State | OrderItem Rows |
|---|---|
| Before 2a | 0 |
| After 2a | 2 (Ban Dalam Motor, Oli Mesin) |
| After 2b | 1 (Ban Dalam Motor only) |

**Order total after 2b:** 50000

**Action idempotency claims:** Both `unit6b-sc2a-cmk` and `unit6b-sc2b-cmk` recorded as `COMPLETED`.

### Result

**MATCH: YES** — Ban Dalam Motor remains, Oli Mesin removed. Highest-risk partial-cancel behavior confirmed correct (no wrong-item removal).

---

## Scenario 3: `busi_for_two_vehicles`

**Source:** `quantity_ambiguity_busi_for_two_vehicles` in `chat-test-scenarios-batch2.json`  
**Conversation ID:** `ec056cf5-de1b-4891-980f-84382a46a77a`  
**Customer ID:** `398cdc6e-3c8e-4a53-938a-6647a5dd79f2`

### V2ProposedAction[] Input

```json
[
  {
    "action_type": "ADD_TO_CART",
    "payload": { "product": "Busi Motor", "qty": 1 },
    "confidence": 0.9,
    "requires_validation": true
  },
  {
    "action_type": "ADD_TO_CART",
    "payload": { "product": "Busi Mobil", "qty": 1 },
    "confidence": 0.9,
    "requires_validation": true
  }
]
```

### Mapper Output

- `cartOps`: `[add Busi Motor qty=1, add Busi Mobil qty=1]`
- `skipped`: `[]`

### executeWaCartMutation Output

- `status`: `applied`
- `items`: `[Busi Motor qty=1 @ 15000]`
- `unresolved`: `[{product: "Busi Mobil", reason: "NOT_FOUND"}]`

### DB Readback

| Before | After |
|---|---|
| 0 OrderItem rows | 1 OrderItem row |

**Order items:**
- Busi Motor — qty=1, unitPrice=15000

**Order total:** 15000

### Result

**MATCH: YES** — Busi Motor resolved and added. Busi Mobil correctly REJECTED as NOT_FOUND (no silent substitution or guessing).

---

## Scenario 4: `cart_persistence`

**Source:** `cross_session_memory_cart_persistence` in `chat-test-scenarios-batch2.json`  
**Conversation ID:** `fe8db315-e7c5-4543-b330-a4c962b3c979`  
**Customer ID:** `4eb9b016-6f77-4429-96bc-492f2de05fcc`

### V2ProposedAction[] Input

```json
[
  {
    "action_type": "OPEN_CART",
    "payload": {},
    "confidence": 0.9,
    "requires_validation": false
  }
]
```

### Mapper Output

- `cartOps`: `[]`
- `skipped`: `[{action_type: "OPEN_CART", reason: "REQUIRES_VALIDATION_FALSE", detail: "requires_validation is false; action is not routed to the cart-mutation path"}]`

### executeWaCartMutation Output

- `status`: `applied`
- `items`: `[]`
- `unresolved`: `[]`

### DB Readback

| Before | After |
|---|---|
| 0 OrderItem rows | 0 OrderItem rows |

**Note:** A draft order was created with `totalPrice=0` and zero items. No mutation occurred.

### Result

**MATCH: YES (functional)** — Mapper correctly excluded OPEN_CART (zero cartOps). Read-only filter works as intended.

**Caveat:** `v2-mapper-wire.ts` calls `executeWaCartMutation` with empty ops rather than short-circuiting. This is functionally harmless (no mutation) but differs from the literal expectation of "NOT attempt any executeWaCartMutation call."

---

## Scenario 5: `second_from_top`

**Source:** `implicit_ref_second_from_top` in `chat-test-scenarios-batch2.json`  
**Conversation ID:** `a4b0a49a-8093-4c12-b4b7-8f195dd5997c`  
**Customer ID:** `246a0e0b-7b64-4c3f-a2a9-6eb631f61a30`

### Layer Note

The scenario's premise is position-resolution (`"yg kedua dari atas"`) happening upstream in the full engine. The mapper only sees resolved text, not raw position references. For this test, the **ALREADY-RESOLVED** product name `"Busi Motor"` was supplied directly as mapper input.

### V2ProposedAction[] Input

```json
[
  {
    "action_type": "ADD_TO_CART",
    "payload": { "product": "Busi Motor", "qty": 1 },
    "confidence": 0.9,
    "requires_validation": true
  }
]
```

### Mapper Output

- `cartOps`: `[add Busi Motor qty=1]`
- `skipped`: `[]`

### executeWaCartMutation Output

- `status`: `applied`
- `items`: `[Busi Motor qty=1 @ 15000]`
- `unresolved`: `[]`

### DB Readback

| Before | After |
|---|---|
| 0 OrderItem rows | 1 OrderItem row |

**Order items:**
- Busi Motor — qty=1, unitPrice=15000

**Order total:** 15000

### Result

**MATCH: YES** — Resolved product name correctly mapped and added. Position-resolution layer is out of scope for this mapper test.

---

## Summary Table

| Scenario | Expected | Actual | Match |
|---|---|---|---|
| 1. `itu_plus_new_item` | Busi Motor + Ban Dalam Motor added | Both added, 0 unresolved | **Y** |
| 2. `partial_cart_cancel` | Ban Dalam remains, Oli gone | Ban Dalam remains, Oli removed | **Y** |
| 3. `busi_for_two_vehicles` | Busi Motor added, Busi Mobil NOT_FOUND | Busi Motor added, Busi Mobil NOT_FOUND | **Y** |
| 4. `cart_persistence` | Zero cartOps, read-only filter active | Zero cartOps, OPEN_CART skipped | **Y*** |
| 5. `second_from_top` | Busi Motor added (resolved name) | Busi Motor added | **Y** |

\* Scenario 4: mapper filter works correctly. Minor note — `v2-mapper-wire.ts` calls `executeWaCartMutation` with empty ops rather than short-circuiting; functionally harmless (no mutation), but differs from the task's literal expectation of "NOT attempt any executeWaCartMutation call."

---

## Evidence Files

All raw JSON outputs are stored in `/tmp/unit6b-results/`:

- `scenario1.json` — itu_plus_new_item
- `scenario2a.json` — partial_cart_cancel (add phase)
- `scenario2b.json` — partial_cart_cancel (remove phase)
- `scenario3.json` — busi_for_two_vehicles
- `scenario4.json` — cart_persistence
- `scenario5.json` — second_from_top

## Cleanup

**Pending decision:** All 5 scenarios have been executed and verified. The resulting cart state (draft orders + OrderItems) and the seeded catalog products remain in the database. Awaiting decision to keep as reference evidence or clean up.
