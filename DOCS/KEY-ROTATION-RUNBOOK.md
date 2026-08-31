# Key Rotation Runbook

> **When to use:** Only when `FIELD_ENCRYPTION_KEY` needs to change
> (e.g. key compromise, periodic rotation policy, or after the initial
> migration from plaintext to encrypted storage).
>
> **DANGER:** This re-encrypts ALL sensitive data in the database.
> A failure mid-rotation can leave data in an inconsistent state.
> Always have a verified backup before running.

---

## Prerequisites

1. **Backup verified** — The endpoint auto-checks for a backup < 1 hour old.
   If none exists, it triggers a manual backup automatically.
   Verify the backup exists before proceeding:
   ```bash
   ls -la /home/ubuntu/backups/*.gz.enc | tail -5
   ```

2. **Super admin access** — You need a valid super_admin bearer token.

3. **Generate a new 32-byte key** — The key must be a 64-character hex string
   (or base64-encoded 32 bytes). Generate one:
   ```bash
   openssl rand -hex 32
   ```

4. **Confirm no other rotation is in progress** — Only one rotation at a time.

---

## Request Shape

```bash
curl -X POST https://qlobot.web.id/api/admin/key-rotation/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -d '{
    "newKey": "<64-char-hex-string>",
    "confirmationPhrase": "ROTATE ENCRYPTION KEY"
  }'
```

**Response (success):**
```json
{
  "success": true,
  "data": {
    "rowsReEncrypted": 42,
    "modelsAffected": ["Store", "Conversation", "Order", "BankAccount"],
    "newKeyInstalled": true
  },
  "message": "Key rotated successfully. 42 field values re-encrypted across 4 models."
}
```

**Response (confirmation phrase mismatch):**
```json
{
  "error": "Confirmation phrase mismatch. Type exactly: \"ROTATE ENCRYPTION KEY\"",
  "requiredPhrase": "ROTATE ENCRYPTION KEY"
}
```

---

## What It Does

1. Validates the new key (must produce 32 bytes).
2. Retrieves the current key from Platform Config DB.
3. Rejects identical keys (no-op).
4. Validates encrypt/decrypt roundtrip with the new key.
5. Enforces a recent backup (< 1 hour old) or triggers one.
6. **Re-encrypts all rows in a single Prisma transaction:**
   - Models touched: `stores` (phoneNumber, address, fonnteToken, fonnteNumber),
     `conversations` (customerPhone, customerName, notes),
     `orders` (shippingAddress, notes),
     `bank_accounts` (accountNumber, accountName).
   - Reads raw encrypted values via SQL (bypasses Prisma middleware).
   - Decrypts with OLD key, re-encrypts with NEW key.
   - **ANY decryption failure aborts the ENTIRE transaction** (atomic rollback).
7. Writes the new key to Platform Config DB.
8. Invalidates the in-memory key cache.

---

## What It Does NOT Do

- **Does NOT update `.env` or `ecosystem.config.js` automatically.**
  After rotation, you MUST manually update `FIELD_ENCRYPTION_KEY`
  in `/home/ubuntu/garuda/.env` to the new key value.
  Otherwise, the next `pm2 restart` will load the OLD key from env
  and fail to decrypt data.

- **Does NOT rotate the Cloudflare Worker key** (if configured).
  That requires separate rotation at the Worker level.

- **Does NOT touch non-sensitive fields** (product names, prices, etc.).

---

## Rollback Procedure

If rotation fails partway:

1. **Transaction rolled back automatically** — Data remains encrypted with the OLD key.
   The endpoint returns a 500 error. No partial state.

2. **Restore the new key location:**
   - The new key was NOT installed in Platform Config (that happens AFTER
     the transaction commits). So the current key is still the OLD key.
   - If you manually updated `.env` already, revert it to the OLD key.

3. **If data was corrupted** (extremely unlikely given transactional rollback):
   - Restore from the backup created automatically before rotation:
     ```bash
     # Find the latest backup
     ls -t /home/ubuntu/backups/*.gz.enc | head -1
     # Restore (see backup runbook)
     ```

4. **Investigate the failure** — Check `pm2 logs api` for the exact error.
   Common causes:
   - Corrupt data (a row encrypted with a third, unknown key).
   - Database connection failure during transaction.

---

## Dry Run

Before executing, run the dry-run to see how many rows will be affected:

```bash
curl -X POST https://qlobot.web.id/api/admin/key-rotation/dry-run \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "models": {
      "Store": { "rowCount": 5, "encryptedFieldCount": 20, "fields": { "phoneNumber": 5, ... } },
      ...
    },
    "totalRows": 50,
    "totalEncryptedFields": 200,
    "currentSource": "database"
  }
}
```

---

## Post-Rotation Checklist

- [ ] Rotation endpoint returned `success: true`
- [ ] `rowsReEncrypted` matches expected count from dry-run
- [ ] Update `FIELD_ENCRYPTION_KEY` in `/home/ubuntu/garuda/.env` to new key
- [ ] `pm2 restart api` — confirm online, no crash loop
- [ ] Verify decryption works: `curl https://qlobot.web.id/api/profile -H "Authorization: Bearer $STORE_TOKEN"` returns plaintext phone number
- [ ] Run full regression: `test:chat`, `test:golden`, `test:structured`, `test:payment`, `test:shipping`
