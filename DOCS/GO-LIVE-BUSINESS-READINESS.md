# GO-LIVE BUSINESS READINESS

> **Status:** 31 Agu 2026. This document tracks items that are explicitly
> NOT engineering bugs — they are business/legal/product decisions the
> owner has not yet made, discovered during 31 Aug go-live review.
> These block real merchant onboarding even though the engineering
> foundation is production-ready.

---

## 🔴 OPEN — owner decision required, blocks real merchant onboarding

### 1. Billing / pricing model

No subscription/plan/billing schema exists anywhere in the codebase.

Open questions:
- Free vs paid tiers? Trial period?
- Per-message/per-order pricing vs flat subscription?
- Payment collection mechanism for merchant fees (separate from customer-facing payment flow already built)?

**Status:** UNDECIDED. No code exists for this.

### 2. Merchant onboarding flow

Technical registration exists (`storeRegisterSchema`, phone/address/origin required). No guided setup wizard exists for non-technical merchant owners to:
- Connect their own WhatsApp number
- Add products without admin help
- Understand the dashboard

**Status:** Registration works. Onboarding UX is minimal/admin-assisted only.

### 3. Terms of Service / Privacy Policy

Platform stores encrypted PII (phone numbers, addresses) for both merchants and their customers. No ToS or Privacy Policy exists in the repo or referenced anywhere. Indonesia's UU PDP (Personal Data Protection Law) applies to any platform processing personal data at this scale.

**Status:** NOT STARTED. This is a legal requirement, not optional polish, before onboarding real third-party merchants who then process their own customers' data through this platform.

---

## ⏸️ NOTE

These are NOT engineering tasks for Kilo/Copilot to execute — they require owner (business/legal) decisions first. Once decided, they may generate engineering follow-up tasks (e.g. billing schema + Stripe/Midtrans integration once pricing model is chosen).
