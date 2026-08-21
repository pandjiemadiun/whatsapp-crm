/**
 * G2-B.5 — Public PWA Contact Contract (PWA init endpoint).
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/pwa-init-contact.test.ts
 *
 * Forensic basis:
 *  DOCS/AUDIT/G2-B-core-hardening-architecture-review.md §C3 (line 225-235)
 *  DOCS/PHASE-REPORTS/laporan-G2-B-core-hardening.md (G2-B.5, line 137-151)
 *
 * Contract (recovered from docs, NOT trusted from phase-report claim):
 *  GET /api/pwa/:storeSlug/init returns:
 *    { success: true, data: {
 *      store: { ...public fields, NO phoneNumber, NO id },   // backward-compatible
 *      contact: { channel: 'whatsapp', whatsappUrl: 'https://wa.me/<num>', displayName } | null,
 *      vapidPublicKey: string | null,                        // backward-compatible
 *    } }
 *
 *  - `phoneNumber` is queried INTERNALLY only to build `contact.whatsappUrl`.
 *  - Raw E.164 `phoneNumber` and internal `id` are NEVER exposed.
 *  - No secret/internal fields (webhookSecret, fonnteToken, fonnteNumber,
 *    fonnteToken, email, config, responseTemplate) leak.
 *  - `contact` is an ADDITIVE field — `store` and `vapidPublicKey` remain.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import { prisma } from '../infrastructure/prisma.js';
import pwaRouter from '../routes/pwa.js';

const PREFIX = 'pwa-contact-test';
let server: http.Server;
let baseUrl: string;

// Forbidden fields that must NEVER appear in the public init response.
const FORBIDDEN_FIELDS = [
  'phoneNumber',
  'id',
  'email',
  'whatsappPhoneId',
  'fonnteToken',
  'fonnteNumber',
  'webhookSecret',
  'config',
  'responseTemplate',
];

function jsonDeepKeys(obj: any): Set<string> {
  const keys = new Set<string>();
  function walk(o: any) {
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      for (const item of o) walk(item);
    } else {
      for (const k of Object.keys(o)) {
        keys.add(k);
        walk(o[k]);
      }
    }
  }
  walk(obj);
  return keys;
}

before(async () => {
  // Store WITH a phoneNumber — contact should be built.
  await prisma.store.upsert({
    where: { id: `${PREFIX}-store` },
    update: { phoneNumber: '6282147128277', name: 'Contact Test Store', slug: PREFIX, isActive: true },
    create: {
      id: `${PREFIX}-store`,
      name: 'Contact Test Store',
      slug: PREFIX,
      phoneNumber: '6282147128277',
      isActive: true,
      address: 'Jl. Contact Test No. 1',
      originProvinceId: 'prov-contact-1',
      originProvinceName: 'Jawa Barat',
      originCityId: 'city-contact-1',
      originCityName: 'Bandung',
      originSubdistrictId: 'sub-contact-1',
      originSubdistrictName: 'Coblong',
    },
  });

  // NOTE: phoneNumber is now mandatory (NOT NULL) at registration, so the
  // "store without phoneNumber" scenario no longer exists by design.

  // Also test a number with a leading + (wa.me expects E.164 without +).
  await prisma.store.upsert({
    where: { id: `${PREFIX}-store-plus` },
    update: { phoneNumber: '+6281234567890', name: 'Plus Prefix Store', slug: `${PREFIX}-plus`, isActive: true },
    create: {
      id: `${PREFIX}-store-plus`,
      name: 'Plus Prefix Store',
      slug: `${PREFIX}-plus`,
      phoneNumber: '+6281234567890',
      isActive: true,
      address: 'Jl. Contact Test No. 2',
      originProvinceId: 'prov-contact-2',
      originProvinceName: 'DKI Jakarta',
      originCityId: 'city-contact-2',
      originCityName: 'Jakarta Selatan',
      originSubdistrictId: 'sub-contact-2',
      originSubdistrictName: 'Tebet',
    },
  });

  const app = express();
  app.use('/api/pwa', pwaRouter);
  server = app.listen(0);
  const addr = server.address();
  if (typeof addr === 'object' && addr) {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  } else {
    throw new Error('Failed to get test server port');
  }
});

after(async () => {
  await prisma.store
    .deleteMany({ where: { id: { startsWith: PREFIX } } })
    .catch(() => {});
  server.close();
});

describe('G2-B.5 — PWA init contact contract', () => {
  test('init returns contact object with server-built whatsappUrl', async () => {
    const res = await fetch(`${baseUrl}/api/pwa/${PREFIX}/init`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.success, true);
    assert.ok(body.data.store, 'store must remain (backward-compatible)');
    assert.ok('vapidPublicKey' in body.data, 'vapidPublicKey must remain (backward-compatible)');
    assert.ok('contact' in body.data, 'contact is the documented addition');

    assert.ok(body.data.contact, 'contact object must exist when store has phoneNumber');
    assert.equal(body.data.contact.channel, 'whatsapp');
    assert.equal(
      body.data.contact.whatsappUrl,
      'https://wa.me/6282147128277',
      'whatsappUrl is server-built from the raw number (no + prefix)',
    );
    assert.equal(body.data.contact.displayName, 'Contact Test Store');
  });

  test('whatsappUrl strips leading + from E.164 number', async () => {
    const res = await fetch(`${baseUrl}/api/pwa/${PREFIX}-plus/init`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.contact);
    assert.equal(body.data.contact.whatsappUrl, 'https://wa.me/6281234567890');
    assert.equal(body.data.contact.displayName, 'Plus Prefix Store');
  });

  test('no PII / secrets leak — phoneNumber and internal fields excluded', async () => {
    const res = await fetch(`${baseUrl}/api/pwa/${PREFIX}/init`);
    const text = await res.text();
    const body = JSON.parse(text);

    // Recursively check that no forbidden field appears ANYWHERE in the response.
    const allKeys = jsonDeepKeys(body);
    for (const field of FORBIDDEN_FIELDS) {
      assert.ok(!allKeys.has(field), `field "${field}" must NOT appear anywhere in the init response`);
    }

    // Explicit check: store object must not carry phoneNumber
    assert.equal(
      (body.data.store as any).phoneNumber,
      undefined,
      'store.phoneNumber must be undefined (stripped by destructuring)',
    );
  });

  test('response is backward-compatible except for the documented contact addition', async () => {
    const res = await fetch(`${baseUrl}/api/pwa/${PREFIX}/init`);
    const body = await res.json();

    // Backward-compatible fields must survive.
    assert.equal(body.success, true);
    assert.ok(body.data.store, 'store field preserved');
    assert.equal(typeof body.data.store, 'object');
    assert.equal(body.data.store.name, 'Contact Test Store');
    assert.equal(body.data.store.slug, PREFIX);
    assert.equal(body.data.store.isActive, true);

    // vapidPublicKey preserved (may be null if env unset).
    assert.ok('vapidPublicKey' in body.data, 'vapidPublicKey preserved');

    // The ONLY new field is `contact`.
    const dataKeys = Object.keys(body.data).sort();
    assert.deepEqual(dataKeys, ['contact', 'store', 'vapidPublicKey']);
  });

  test('404 for unknown store slug', async () => {
    const res = await fetch(`${baseUrl}/api/pwa/${PREFIX}-nonexistent/init`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, undefined);
    assert.ok(body.error, 'error message returned');
  });

  test('store fields match PWA_STORE_PUBLIC_SELECT exactly', async () => {
    const res = await fetch(`${baseUrl}/api/pwa/${PREFIX}/init`);
    const body = await res.json();
    const storeKeys = Object.keys(body.data.store).sort();

    // Exactly the public select fields, nothing more, nothing less.
    assert.deepEqual(storeKeys, [
      'acceptsCod',
      'acceptsQris',
      'acceptsTransfer',
      'address',
      'businessCategory',
      'description',
      'isActive',
      'name',
      'operatingHours',
      'profilePhotoUrl',
      'qrisImageUrl',
      'shippingFlatInCity',
      'shippingFlatOutCity',
      'shippingMode',
      'slug',
      'timezone',
    ]);
  });
});
