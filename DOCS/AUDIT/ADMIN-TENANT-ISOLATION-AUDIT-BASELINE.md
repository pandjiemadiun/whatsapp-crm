# ADMIN TENANT ISOLATION AUDIT BASELINE
**Date:** 2026-08-27  
**Scope:** All admin API endpoints (`/api/admin/*`)  
**Auditor:** Kilo (read-only audit, no code changes)  
**Trigger:** PV-P3-VERIFY finding — any authenticated admin can access/modify any store's data

---

## 1. ADMIN IDENTITY MODEL — DOES STORE OWNERSHIP EXIST ANYWHERE IN THE DATA MODEL?

### 1.1 Admin authentication models (schema.prisma verbatim)

```
// apps/api/prisma/schema.prisma:430-458
model AdminUser {
  id            String        @id @default(uuid())
  email         String        @unique
  passwordHash  String
  role          String        @default("support_admin")
  isActive      Boolean       @default(true)
  lastLoginAt   DateTime?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  deletedAt     DateTime?

  tokens        AdminAuthToken[]

  @@index([email])
  @@index([createdAt])
  @@map("admin_users")
}

model AdminAuthToken {
  id            String        @id @default(uuid())
  adminUserId   String
  token         String        @unique
  expiresAt     DateTime
  revokedAt     DateTime?
  createdAt     DateTime      @default(now())

  adminUser     AdminUser     @relation(fields: [adminUserId], references: [id])

  @@index([adminUserId])
  @@index([expiresAt])
  @@map("admin_auth_tokens")
}
```

**Finding:** `AdminUser` has NO `storeId` field. There is NO association between an admin identity and any store in the schema. The `AdminAuthToken` also has no `storeId`. Admin authentication is a **single global identity** with no store association.

### 1.2 Is there ANY field associating an admin with a store?

**No.** Exhaustive grep of `schema.prisma` for `storeId` in admin-related models returns zero results. The only `storeId` fields exist in `Store`, `Product`, `ProductVariant`, `Order`, `Customer`, `Conversation`, etc. — all tenant-scoped business entities, never in admin auth models.

### 1.3 Merchant registration flow — what gets created?

**Admin registration** (`POST /api/admin/auth/register`) — verbatim from `src/routes/admin/auth.ts:14-48`:
```typescript
router.post('/register', ..., async (req: Request, res: Response) => {
  const { email, password } = getValidated<{ email: string; password: string }>(req);
  const admin = await prisma.adminUser.create({
    data: { email, passwordHash, role: 'support_admin', isActive: true },
  });
  const token = await prisma.adminAuthToken.create({
    data: { adminUserId: admin.id, token, expiresAt },
  });
  res.status(201).json({ success: true, data: { adminId, email, role, token } });
});
```

**Creates:** `AdminUser` + `AdminAuthToken` only. **No Store row is created.** There is no merchant self-registration flow in the admin auth routes.

**Store creation** is a separate operation (via `POST /api/admin/stores` or direct DB insert). The admin who creates a store is not recorded — no foreign key from `Store` to `AdminUser`.

**Conclusion:** "Merchant" and "admin" are currently the same thing — a global admin user with no store association. There is no concept of "store owner" in the data model.

---

## 2. AUTH MIDDLEWARE — WHAT'S ACTUALLY IN THE TOKEN/SESSION?

### 2.1 Admin auth middleware (verbatim)

**File:** `src/middleware/adminAuth.ts` (complete file, 62 lines)
```typescript
export interface AuthenticatedAdminRequest extends Request {
  admin?: { adminId: string; email: string; role: string };
}

export async function adminAuthMiddleware(req: AuthenticatedAdminRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = authHeader.slice(7);
  try {
    const tokenRecord = await prisma.adminAuthToken.findUnique({
      where: { token },
      include: { adminUser: true },
    });
    if (!tokenRecord) return res.status(401).json({ error: 'Invalid token' });
    if (tokenRecord.revokedAt) return res.status(401).json({ error: 'Token has been revoked' });
    if (new Date(tokenRecord.expiresAt) < new Date()) return res.status(401).json({ error: 'Token expired, please login again' });
    const admin = tokenRecord.adminUser;
    if (!admin.isActive || admin.deletedAt) return res.status(401).json({ error: 'Account suspended or inactive' });
    req.admin = { adminId: admin.id, email: admin.email, role: admin.role };
    next();
  } catch (error) {
    adapters.logger.error('Admin auth middleware error', error as Error);
    return res.status(500).json({ error: 'Authentication error' });
  }
}
```

**Claims/fields decoded from token:**
- `adminId: string` — AdminUser.id
- `email: string` — AdminUser.email
- `role: string` — AdminUser.role (default: `"support_admin"`)

**NOT present:** `storeId`, `storeIds`, `permissions`, or any other claims.

### 2.2 DIFFERENT auth middleware that DOES check storeId

**File:** `src/middleware/auth.ts` (complete file, 52 lines) — used by PWA/customer routes:
```typescript
export interface AuthenticatedRequest extends Request {
  user?: { storeId: string; email: string };
}

export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = authHeader.slice(7);
  const setting = await prisma.storeSetting.findFirst({
    where: { key: 'auth_token', value: token },
    include: { store: true },
  });
  if (!setting || !setting.store || setting.store.deletedAt) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // ... expiry check ...
  req.user = { storeId: setting.store.id, email: setting.store.email || '' };
  next();
}
```

**Key difference:** This middleware resolves `storeId` from the token itself (stored in `store_settings` table). The token IS the store identifier. This means PWA routes are **inherently store-scoped** — a token can only ever represent one store.

**This pattern COULD be extended to admin routes** by either:
1. Adding a `storeId` field to `AdminAuthToken` and looking it up during auth
2. Creating a separate `StoreAdmin` association model

But this is a design decision, not a bug — the current codebase simply does not have this.

### 2.3 Other auth middlewares

No other auth middleware exists in `src/middleware/`. All admin routes use `adminAuthMiddleware` or `requireAdminRole` (which wraps it).

---

## 3. FULL ADMIN ROUTE INVENTORY

### Routes with `:storeId` in path

| Route | File:Line | storeId Source | Store Ownership Check | Product/Entity Ownership Check |
|---|---|---|---|---|
| `GET /stores/:storeId/products` | `products.ts:30` | `req.params` | ❌ None | ❌ None (lists all products for store) |
| `POST /stores/:storeId/products` | `products.ts:76` | `req.params` | ❌ None | ❌ None (creates product for store) |
| `POST /products/magic-paste` | `products.ts:143` | `body.storeId` | ❌ None | ❌ None |
| `PATCH /products/:productId` | `products.ts:219` | Derived from product | ❌ None | ✅ Via `getProductById` |
| `DELETE /products/:productId` | `products.ts:283` | Derived from product | ❌ None | ✅ Via `getProductById` |
| `GET /stores/:storeId/categories` | `products.ts:312` | `req.params` | ❌ None | ❌ None |
| `GET /stores/:storeId/products/:productId/variants` | `variants.ts:26` | `req.params` | ❌ None | ✅ Via `listVariants` |
| `POST /stores/:storeId/products/:productId/variants` | `variants.ts:41` | `req.params` | ❌ None | ✅ Via `findFirst` product check |
| `GET /stores/:storeId` | `stores.ts:524` | `req.params` | ❌ None | N/A (store detail) |
| `PUT /stores/:storeId/suspend` | `stores.ts:152` | `req.params` | ❌ None | N/A |
| `PUT /stores/:storeId/activate` | `stores.ts:203` | `req.params` | ❌ None | N/A |
| `POST /stores/:storeId/reset-password` | `stores.ts:253` | `req.params` | ❌ None | N/A |
| `POST /stores/:storeId/verify-email` | `stores.ts:314` | `req.params` | ❌ None | N/A |
| `POST /stores/:storeId/disconnect-fonnte` | `stores.ts:350` | `req.params` | ❌ None | N/A |
| `GET /stores/:storeId/gowa-status` | `stores.ts:392` | `req.params` | ❌ None | N/A |
| `POST /stores/:storeId/gowa-connect` | `stores.ts:437` | `req.params` | ❌ None | N/A |
| `POST /stores/:storeId/gowa-reset` | `stores.ts:500` | `req.params` | ❌ None | N/A |
| `GET /metrics/:storeId` | `engine.ts:9` | `req.params` | ❌ None | N/A (no auth middleware at all!) |
| `GET /:storeId` | `engine.ts:16` | `req.params` | ❌ None | N/A (no auth middleware at all!) |
| `POST /:storeId` | `engine.ts:29` | `req.params` | ❌ None | N/A (no auth middleware at all!) |

### Routes WITHOUT `:storeId` in path (entity-scoped via lookup)

| Route | File:Line | Entity Lookup | Store Derived From | Store Ownership Check |
|---|---|---|---|---|
| `PATCH /products/:productId` | `products.ts:219` | `getProductById` | Product.storeId | ❌ None |
| `DELETE /products/:productId` | `products.ts:283` | `getProductById` | Product.storeId | ❌ None |
| `PATCH /variants/:variantId` | `variants.ts:101` | `findUnique` + `include product` | Variant→Product.storeId | ❌ None |
| `DELETE /variants/:variantId` | `variants.ts:169` | `findUnique` + `include product` | Variant→Product.storeId | ❌ None |

### Routes with NO storeId at all (global/system operations)

| Route | File:Line | Scope |
|---|---|---|
| `GET /analytics` | `analytics.ts:12` | Global (no store filter) |
| `POST /analytics` | `analytics.ts:39` | Global |
| `GET /audit-logs/stats` | `audit-logs.ts:14` | Global |
| `GET /audit-logs` | `audit-logs.ts:27` | Global (can filter by storeId in query) |
| `GET /audit-logs/:logId` | `audit-logs.ts:50` | Global |
| `POST /audit-logs/export` | `audit-logs.ts:64` | Global |
| `POST /auth/register` | `auth.ts:14` | Global (no auth) |
| `POST /auth/login` | `auth.ts:61` | Global (no auth) |
| `POST /auth/logout` | `auth.ts:122` | Self (own token) |
| `GET /auth/me` | `auth.ts:140` | Self (own admin record) |
| `GET /backups` | `backups.ts:11` | Global |
| `GET /backups/:filename/verify` | `backups.ts:22` | Global |
| `POST /backups` | `backups.ts:33` | Global |
| `POST /backups/:filename/restore` | `backups.ts:55` | Global (super_admin only) |
| `DELETE /backups/:filename` | `backups.ts:77` | Global (super_admin only) |
| `GET /config` | `config.ts:17` | Global |
| `GET /config/token-usage/last-hour` | `config.ts:25` | Global |
| `GET /config/:key` | `config.ts:42` | Global |
| `PUT /config/:key` | `config.ts:51` | Global (super_admin only) |
| `DELETE /config/:key` | `config.ts:108` | Global (super_admin only) |
| `POST /config/reload-cache` | `config.ts:126` | Global (super_admin only) |
| `POST /config/test-connection` | `config.ts:133` | Global |
| `GET /shadow-summary` | `shadow.ts:8` | Global |
| `GET /shadow-review` | `shadow.ts:15` | Global |
| `POST /shadow-review/:id` | `shadow.ts:21` | Global |
| `GET /system` | `system-metrics.ts:13` | Global |
| `GET /provinces` | `locations.ts:14` | Global (reference data) |
| `GET /cities` | `locations.ts:23` | Global (reference data) |
| `GET /subdistricts` | `locations.ts:36` | Global (reference data) |

### Categorization

**(a) Already has adequate scoping via some other means:**
- None. No admin route has admin-store ownership scoping.

**(b) Genuinely open (same as variant PATCH/DELETE):**
- ALL admin routes listed above. Every route either takes `storeId` from params/body without admin ownership check, or derives it from entity lookup without admin ownership check.

**(c) Unclear/needs deeper look:**
- `engine.ts` routes (`/metrics/:storeId`, `/:storeId`, `POST /:storeId`) — these have NO auth middleware at all (`async (req, res)` without `adminAuthMiddleware`). This is a separate gap (unauthenticated access).

---

## 4. LOGIN FLOW — HOW DOES A MERCHANT END UP AUTHENTICATED FOR THEIR STORE?

### 4.1 Admin login endpoint

**File:** `src/routes/admin/auth.ts:61-120` (verbatim)
```typescript
router.post('/login', validateRequest(loginSchema, 'body'), adminAuthLimiter, async (req: Request, res: Response) => {
  const { email, password } = getValidated<{ email: string; password: string }>(req);
  const admin = await prisma.adminUser.findFirst({ where: { email, deletedAt: null } });
  if (!admin) return res.status(401).json({ error: 'Invalid email or password' });
  if (!admin.isActive) return res.status(401).json({ error: 'Account suspended' });
  // ... password verify ...
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.adminAuthToken.create({ data: { adminUserId: admin.id, token, expiresAt } });
  res.json({ success: true, data: { adminId, email, role, token } });
});
```

**Response contains:** `adminId`, `email`, `role`, `token` — **no storeId**.

### 4.2 Dashboard store selection

**File:** `apps/dashboard/src/pages/admin/AdminProductsPage.tsx:83-99` (verbatim)
```typescript
const res = await adminApi.get('/stores?page=1');
const list: StoreOption[] = (res.data?.data?.stores ?? []).map((s: any) => ({
  id: s.id,
  name: s.name,
}));
if (!cancelled) {
  setStores(list);
  if (list.length > 0) setSelectedStore((prev) => prev || list[0].id);
}
```

**Pattern:** Dashboard fetches **ALL stores** via `GET /api/admin/stores?page=1`, then renders a `<select>` dropdown for the admin to pick ANY store. The selected `storeId` is then sent with every subsequent API call (e.g., `GET /stores/${selectedStore}/products`).

**File:** `apps/dashboard/src/pages/admin/AdminProductsPage.tsx:104`
```typescript
const res = await adminApi.get(`/stores/${selectedStore}/products?limit=50`);
```

### 4.3 Current "scoping" mechanism

**There is no server-side store scoping for admins.** The current system "works" by convention:
1. Admin logs in → gets global token
2. Dashboard fetches ALL stores → admin picks one from dropdown
3. Dashboard sends `storeId` explicitly in every request
4. Server trusts the `storeId` from params/body without verifying admin owns that store

**This is NOT security — it's UI convention.** Any admin can switch to any other store by changing the `selectedStore` dropdown value. There is no server-side enforcement.

### 4.4 Contrast with PWA/customer auth

**File:** `src/middleware/auth.ts` (store-level auth)
```typescript
const setting = await prisma.storeSetting.findFirst({
  where: { key: 'auth_token', value: token },
  include: { store: true },
});
req.user = { storeId: setting.store.id, email: setting.store.email || '' };
```

The PWA auth middleware resolves `storeId` from the token itself. A PWA token can ONLY represent one store. This is a **proper store-scoped auth pattern** that already exists in the codebase but is NOT used for admin routes.

---

## 5. HISTORICAL CONTEXT

### 5.1 RAILS.md

**No prior mentions** of admin/store scoping, multi-admin-per-store, or superadmin concepts. The only match found is `RAILS.md:1028` which references "tenant isolation" in the context of product search, not admin auth.

### 5.2 BUG-BELUM-DIBERESKAN.md

**No prior mentions** of admin tenant isolation or store-scoped admin access.

### 5.3 DECISION-*.md

No DECISION-*.md files exist in the repository.

### 5.4 Current role system

**File:** `src/routes/admin/auth.ts:21` — default role is `"support_admin"`
**File:** `src/middleware/adminAuth.ts` — no role-based store scoping
**File:** `src/routes/admin/*` — `requireAdminRole(['super_admin'])` is used only for destructive/system operations (backup restore, config changes), not for store access control

**Ambiguity:** It is unclear whether the `role` field was intended for future store-scoping or RBAC. The current implementation treats all roles as global — any `support_admin` or `super_admin` can access any store.

---

## SUMMARY OF FINDINGS

### Finding 1: Admin identity has no store association
- `AdminUser` model has no `storeId` field
- `AdminAuthToken` has no `storeId` field
- Admin registration creates only `AdminUser` + `AdminAuthToken`, no `Store` association
- **Severity:** Architectural — no way to enforce store ownership without schema changes

### Finding 2: Admin auth middleware does not provide storeId
- `adminAuthMiddleware` sets `req.admin = { adminId, email, role }` — no `storeId`
- **Severity:** Missing data — even if schema had storeId, middleware doesn't extract it

### Finding 3: Zero admin routes enforce store ownership
- Every admin route either takes `storeId` from params/body or derives it from entity lookup
- None verify that the authenticated admin has any relationship to that store
- **Severity:** Security-critical — any admin can access/modify any store's data

### Finding 4: Dashboard "scoping" is UI-only convention
- Dashboard fetches ALL stores and lets admin pick any via dropdown
- Server trusts whatever `storeId` the frontend sends
- **Severity:** Security-critical — no server-side enforcement

### Finding 5: Store-scoped auth pattern already exists but unused for admin
- `src/middleware/auth.ts` (PWA routes) resolves `storeId` from token
- This pattern could be extended to admin routes but currently is not
- **Severity:** Design gap, not a bug

### Finding 6: `engine.ts` routes have NO auth middleware at all
- `GET /api/admin/engine/metrics/:storeId`
- `GET /api/admin/engine/:storeId`
- `POST /api/admin/engine/:storeId`
- These routes accept `req, res` directly without `adminAuthMiddleware`
- **Severity:** Security-critical — unauthenticated access to engine metrics/control

---

## AMBIGUITIES

1. **Was global admin access intentional?** The codebase shows no evidence of intentional design for global admin access. There are no comments, docs, or prior tickets discussing multi-tenant admin scoping. The absence of `storeId` in `AdminUser` appears to be an oversight rather than a deliberate architectural choice.

2. **Is the `role` field intended for future RBAC?** The field exists and has two values (`support_admin`, `super_admin`) but is only used for gating destructive operations, not for store access control. It's unclear if this was planned for store-scoping or just general permission levels.

3. **Is the `engine.ts` gap intentional?** These routes have no auth middleware at all. This could be intentional (internal service-to-service calls) or an oversight. Without documentation, it's ambiguous.

---

## END OF AUDIT
