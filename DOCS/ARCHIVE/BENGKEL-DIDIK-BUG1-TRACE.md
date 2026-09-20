# Bengkel Didik — Bug 1 Deep Trace: Silent ADD_TO_CART
**Store:** Bengkel Didik (`store-4f4f67bd`)  
**Conversation:** `bbab7983-ddb3-40ef-b1a4-a12200566be5`  
**Scope:** Read-only DB + log inspection. ZERO code changes.

---

## Step 1 — Timestamp verification

### 1.1 action_idempotency timestamps (verbatim row)

```json
{
  "idempotencyKey": "store-4f4f67bd:a17cc9ea-a316-4aaa-969a-c97f08894723:ADD_TO_CART:bbab8362-d429-4a9c-94d4-301c4d228ab7",
  "actionType": "ADD_TO_CART",
  "actionId": "bbab8362-d429-4a9c-94d4-301c4d228ab7",
  "status": "COMPLETED",
  "claimedAt": "2026-09-02T13:28:10.239Z",
  "completedAt": "2026-09-02T13:28:10.287Z",
  "createdAt": "2026-09-02T13:28:10.241Z",
  "updatedAt": "2026-09-02T13:28:10.250Z",
  "result": {
    "cart": {
      "items": [
        {
          "productId": "47f82a26-acfa-45dc-a7d6-21fafbf34361",
          "productName": "Ban dalam",
          "quantity": 1,
          "unitPrice": 50000,
          "subtotal": 50000
        }
      ],
      "total": 50000
    },
    "productId": "47f82a26-acfa-45dc-a7d6-21fafbf34361",
    "quantityAdded": 1
  }
}
```

### 1.2 conversation_history timestamps (relevant window)

| createdAt (UTC) | role | content | messageType |
|-----------------|------|---------|-------------|
| 2026-09-02T13:28:01.009Z | assistant | "Boleh dibantu dipastikan Kak, produk mana yang dimaksud?\n\n• Ban dalam — Rp 50.000\n• Ban matic Vario depan belakang — Rp 100.000..." | product_list |
| 2026-09-02T13:28:01.010Z | user | "Ada ban dalam?" | null |
| 2026-09-02T13:28:19.419Z | assistant | "Mau pilih yang mana nih?" | quick_reply |

### 1.3 Gap analysis

- `product_list` shown: `13:28:01.009Z`
- ADD_TO_CART **completed**: `13:28:10.287Z`
- quick_reply shown: `13:28:19.419Z`

**The action completed 9.2 seconds AFTER the product_list was rendered, and 9.1 seconds BEFORE the quick_reply appeared.**

This proves the action happened while the `product_list` message (with "+ Keranjang" buttons) was visible on screen. The quick_reply had not yet been sent.

---

## Step 2 — HTTP request evidence

### 2.1 Nginx access log (rotated log, exact line)

```
103.245.27.5 - - [02/Sep/2026:13:28:10 +0000] "POST /api/pwa/bengkeldidik/action HTTP/1.1" 200 451 "https://qlobot.web.id/c/bengkeldidik" "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36"
```

**Key facts:**
- **Timestamp:** `13:28:10 +0000` — matches `action_idempotency.completedAt` within milliseconds
- **Method:** `POST /api/pwa/bengkeldidik/action`
- **Client:** Chrome 152 on Android 10, same IP as the entire conversation session
- **Response:** `200 451` — successful action execution
- **Referer:** `https://qlobot.web.id/c/bengkeldidik` — same conversation page

### 2.2 Duplicate/replay check

Searched nginx access log window `13:28:05–13:28:12` for this conversation:
- Only ONE `POST /action` request found
- No duplicate `actionId` values in the window
- No other `ADD_TO_CART` requests from this IP/conversation in proximity

**Verdict:** Single request, no evidence of replay or duplication.

### 2.3 App-level logging gap

The application logs (`combined.log`) do **not** contain any entry for `/api/pwa/bengkeldidik/action` at `20:28:10` (UTC+7). The action route (`routes/actions.ts`) does not emit a request log at the same verbosity as the message pipeline. Therefore:
- [UNVERIFIED] Exact request body payload (productId, quantity, variantId)
- [UNVERIFIED] Whether the client included `actionId` matching the idempotency row (inferred: yes, because the claim succeeded)

---

## Step 3 — Client code inspection

### 3.1 ProductCard.tsx (render path for `product_list`)

```typescript
// ProductCard.tsx:93-100
const handleAddToCartClick = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.stopPropagation();
  if (hasVariants) {
    onTap?.(product);
  } else {
    onAddToCart?.(product);
  }
};
```

**Finding:** `onAddToCart` is ONLY called inside `handleAddToCartClick`, which is bound to the button's `onClick` handler. There is:
- No `useEffect` that calls `onAddToCart` on mount/render
- No `useEffect` that calls `onAddToCart` when `product` prop changes
- No auto-trigger via `setTimeout`, `requestAnimationFrame`, or optimistic prefetch
- No call to `sendAction` anywhere outside of explicit button click handlers

### 3.2 ChatPage.tsx (action sender)

```typescript
// ChatPage.tsx:473-495
const sendAction = useCallback(
  async (type: string, payload?: Record<string, unknown>) => {
    if (sending || inputDisabled || !webUid || !slug) return
    setSending(true)
    ...
    const res = await api.post(`/pwa/${slug}/action`, {
      uid: webUid,
      action: { actionId: crypto.randomUUID(), type, payload: payload ?? {} },
    })
    ...
  },
  [sending, inputDisabled, webUid, slug, renderActionResult]
)
```

**Finding:** `sendAction` is called ONLY from:
- `handleAddToCart` (`ChatPage.tsx:498-506`) — bound to ProductCard "+ Keranjang" / "Tambah" buttons
- `handleQuickAction` — for quick action chips (not relevant here)
- Other explicit UI interactions (checkout, handoff, etc.)

No `useEffect` in `ChatPage.tsx` calls `sendAction` when `messages` changes or when a `product_list` is rendered.

### 3.3 ProductList.tsx / MessageRenderer.tsx

Pure presentational components. No side effects, no API calls, no `onAddToCart` invocation outside of prop drilling.

### 3.4 Server-side action handler

`routes/actions.ts:25-106` — The `POST /:storeSlug/action` endpoint:
- Validates `action.type` against `actionRegistry`
- Calls `executeAction(actionType, action, context)`
- No auto-execution logic, no message-content parsing, no implicit ADD_TO_CART

`action-registry.ts:640-811` — `handleAddToCart`:
- Only executes when `action.type === 'ADD_TO_CART'` and payload passes Zod schema validation
- No fallback or implicit add logic

**Conclusion for Step 3:** There is **no code path** in the PWA client or server that auto-triggers `ADD_TO_CART` without an explicit user tap on a "+ Keranjang" / "Tambah" button.

---

## Step 4 — Root cause assessment

### Evidence summary

| Evidence | What it proves |
|----------|----------------|
| `product_list` rendered at `13:28:01.009Z` with "+ Keranjang" buttons for Ban dalam | Button WAS visible before action |
| Nginx `POST /action` at `13:28:10 +0000` from same browser session | Real HTTP request from client |
| `action_idempotency.completedAt` = `13:28:10.287Z` | Server executed ADD_TO_CART successfully |
| No duplicate/replay requests in time window | Single tap, not a replay storm |
| Client code: no `useEffect`/auto-trigger | No silent/auto-add mechanism in source |
| Server code: no implicit ADD_TO_CART | No silent/auto-add mechanism in backend |

### [UNVERIFIED] Exact mechanism

While the evidence **rules out** a silent/auto-trigger from code, it **cannot prove** the exact user interaction that caused the POST:

1. **Intentional tap:** User saw "+ Keranjang" on Ban dalam card, tapped it, then forgot/ didn't realize the cart updated.
2. **Accidental tap:** Button touch target may have been hit accidentally (mobile UX issue).
3. **Double-tap / rapid interaction:** User may have tapped twice quickly; idempotency ensures only one add, but the user might not remember either tap.
4. **Client-side race:** [UNVERIFIED] — No evidence in logs, but we cannot rule out a React state race that caused `handleAddToCartClick` to fire without a physical tap. This would require client-side event logging to confirm or deny.

### What we can say with confidence

- **The button was visible** when the action occurred.
- **The action was a legitimate, single, idempotent ADD_TO_CART** from the user's browser session.
- **There is no silent/auto-add code path** in either client or server.
- **The user's claim "I never tapped +Keranjang"** cannot be verified or falsified from server-side evidence alone.

---

## Proposed additional logging (to disambiguate future occurrences)

To capture the exact mechanism next time, add:

1. **Client-side tap telemetry** (`ProductCard.tsx:93`):
   - Log `onAddToCartClick` firings to a client-side event logger (or send as beacon) with timestamp, productId, and `event.type === 'click'`.
   - This would prove whether the tap was a genuine `click` event vs. a programmatic call.

2. **Nginx request body logging** (or app-level request log):
   - Log the full `actionId`, `type`, and `payload` (without secrets) for every `POST /api/pwa/:slug/action`.
   - Current nginx log only shows the request line, not the JSON body.

3. **Action route request log** (`routes/actions.ts:25`):
   - Add `adapters.logger.info('Structured action received', { storeId, customerId, actionType, actionId, payload })` at the top of the route handler.
   - This would create an app-log entry correlating the action with the request.

4. **Conversation engine → cart state diff log**:
   - After every `ADD_TO_CART` action, log the cart delta (added product, quantity) to `conversation_history.metadata` or a dedicated audit table.
   - This would make the cart mutation visible in the conversation timeline.

---

## Verdict

**Bug 1 is NOT reproducible as "silent add-to-cart before button shown" from the current codebase.** The button was rendered at `13:28:01.009Z`; the action occurred at `13:28:10Z`. There is no silent/auto-trigger path in client or server code.

The most likely explanation is a **user-initiated tap** on the "+ Keranjang" button that the user does not remember performing. Without client-side event logging, this cannot be definitively proven or disproven.

**No fix is proposed at this stage** because the root cause is not a code defect. If the owner wants to reduce accidental taps, the fix would be a UX change (e.g., confirmation dialog, larger touch target, haptic feedback) — but that is a product decision, not a bug fix.
