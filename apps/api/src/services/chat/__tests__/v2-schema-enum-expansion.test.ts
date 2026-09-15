/**
 * FIX-SCHEMA-EXPANSION-WITH-NORMALIZATION: Verification tests
 *
 * Replaces the broad-enum-expansion approach with a normalization approach:
 * The Zod enum stays small (canonical types only). A normalizeV2Output()
 * function maps LLM-emitted alias types → canonical types BEFORE Zod
 * validation.
 *
 * Tests verify:
 * - normalizeV2Output() maps all known LLM aliases to canonical types
 * - All 16 previously-failing parse_error outputs pass after normalization + Zod
 * - UPDATE_SHIPPING_ADDRESS is NOT normalized (reported as parse_error for product-level decision)
 * - The normalization also preserves correct data for translation layer use
 */
import { describe, it, expect } from '@jest/globals';
import {
  V2EngineOutputSchema,
  V2EntitySchema,
  V2ProposedActionSchema,
  normalizeV2Output,
} from '../v2-engine/schema.js';

// ─── 16 raw LLM outputs that PREVIOUSLY failed with parse_error ──────────────
// These are the EXACT raw outputs from v2-shadow-final-full-export.json
// that the LLM (LLM7.io) returned before schema expansion. They use
// alias type names that are NOT in the canonical Zod enum.

const previouslyFailingRawOutputs = [
  // #1: berapa harga Ban Dalam Motor? (action GET_PRODUCT_INFO → SHOW_RELATED_PRODUCTS)
  { intent: 'product_inquiry', confidence: 0.9, entities: [{ type: 'product', value: 'Ban Dalam Motor', confidence: 0.95 }], proposed_actions: [{ action_type: 'GET_PRODUCT_INFO', payload: { product: 'Ban Dalam Motor' }, confidence: 0.9, requires_validation: false }], reply_text: 'Harga Ban Dalam Motor bisa dilihat di deskripsi produk ya Kak!', needs_clarification: false, summary_update: 'Customer bertanya tentang harga Ban Dalam Motor.' },
  // #2: Panji Wijaya (entity 'name' → customer_name)
  { intent: 'product_inquiry', confidence: 0.9, entities: [{ type: 'name', value: 'Panji Wijaya', confidence: 0.95 }], proposed_actions: [{ action_type: 'NONE', payload: {}, confidence: 0.9, requires_validation: false }], reply_text: 'Siapa nama Anda?', needs_clarification: true, summary_update: 'Customer memberikan nama.' },
  // #3: Panji dagangan (entity 'shipping_name' → customer_name)
  { intent: 'product_inquiry', confidence: 0.9, entities: [{ type: 'shipping_name', value: 'Panji', confidence: 0.9 }, { type: 'customer_address', value: 'dagangan', confidence: 0.85 }], proposed_actions: [{ action_type: 'NONE', payload: {}, confidence: 0.95, requires_validation: false }], reply_text: 'Siapa nama Anda?', needs_clarification: true, summary_update: 'Customer memberikan nama.' },
  // #4: Jakarta (entity 'location' → customer_address)
  { intent: 'shipping_inquiry', confidence: 0.9, entities: [{ type: 'location', value: 'Jakarta', confidence: 0.95 }], proposed_actions: [{ action_type: 'NONE', payload: {}, confidence: 0.9, requires_validation: false }], reply_text: 'Ongkir ke Jakarta silakan cek di layanan pengiriman kami.', needs_clarification: false, summary_update: 'Customer bertanya ongkir ke Jakarta.' },
  // #5: Jl. Merdeka No 10, Jakarta (entity 'address' → customer_address)
  { intent: 'shipping_inquiry', confidence: 0.9, entities: [{ type: 'address', value: 'Jl. Merdeka No 10, Jakarta', confidence: 0.95 }], proposed_actions: [{ action_type: 'OPEN_CART', payload: {}, confidence: 0.85, requires_validation: false }], reply_text: 'Oke, kami akan kirim ke alamat tersebut.', needs_clarification: false, summary_update: 'Customer memberikan alamat.' },
  // #6: Rina anggun jaya (entity 'name' → customer_name)
  { intent: 'product_inquiry', confidence: 0.9, entities: [{ type: 'name', value: 'Rina anggun jaya', confidence: 0.95 }], proposed_actions: [{ action_type: 'NONE', payload: {}, confidence: 0.9, requires_validation: false }], reply_text: 'Siapa nama Anda?', needs_clarification: true, summary_update: 'Customer memberikan nama.' },
  // #7: Anggara, Jl. Anggrek No 5 (entity 'name' → customer_name, 'address' → customer_address)
  { intent: 'shipping_inquiry', confidence: 0.9, entities: [{ type: 'name', value: 'Anggara', confidence: 0.95 }, { type: 'address', value: 'Jl. Anggrek No 5', confidence: 0.9 }, { type: 'customer_address', value: 'Jl. Anggrek No 5', confidence: 0.9 }], proposed_actions: [{ action_type: 'OPEN_CART', payload: {}, confidence: 0.85, requires_validation: false }], reply_text: 'Oke, kami akan kirim ke alamat tersebut.', needs_clarification: false, summary_update: 'Customer memberikan nama dan alamat.' },
  // #8: Pak gatot, jl gading (entity 'address' → customer_address)
  { intent: 'product_inquiry', confidence: 0.8, entities: [{ type: 'address', value: 'Jl. Gading', confidence: 0.9 }, { type: 'customer_address', value: 'Jl. Gading', confidence: 0.9 }], proposed_actions: [{ action_type: 'NONE', payload: {}, confidence: 0.95, requires_validation: false }], reply_text: 'Siapa nama Anda?', needs_clarification: true, summary_update: 'Customer memberi alamat.' },
  // #9: berapa ongkir ke Jakarta? (entity 'location' → customer_address)
  { intent: 'shipping_inquiry', confidence: 0.9, entities: [{ type: 'location', value: 'Jakarta', confidence: 0.95 }], proposed_actions: [{ action_type: 'NONE', payload: {}, confidence: 0.9, requires_validation: false }], reply_text: 'Ongkir ke Jakarta silakan cek di layanan pengiriman kami.', needs_clarification: false, summary_update: 'Customer bertanya ongkir ke Jakarta.' },
  // #10: ada layanan kirim ke Bandung? (entity 'location' → customer_address)
  { intent: 'shipping_inquiry', confidence: 0.9, entities: [{ type: 'location', value: 'Bandung', confidence: 0.95 }], proposed_actions: [{ action_type: 'NONE', payload: {}, confidence: 0.9, requires_validation: false }], reply_text: 'Ya, kami kirim ke Bandung.', needs_clarification: false, summary_update: 'Customer bertanya layanan kirim ke Bandung.' },
  // #11: ini mengecewakan, saya mau komplain (action ESCALATE_TO_HUMAN → CONTACT_ADMIN)
  { intent: 'escalation', confidence: 0.9, entities: [{ type: 'product', value: 'ban', confidence: 0.8 }], proposed_actions: [{ action_type: 'ESCALATE_TO_HUMAN', payload: { reason: 'customer complaint' }, confidence: 0.9, requires_validation: false }], reply_text: 'Saya mengerti kekecewakannya. Saya akan hubungkan dengan customer service.', needs_clarification: false, summary_update: 'Customer ingin komplain.' },
  // #12: saya ingin bicara dengan customer service (action ESCALATE_TO_HUMAN → CONTACT_ADMIN)
  { intent: 'escalation', confidence: 0.9, entities: [], proposed_actions: [{ action_type: 'ESCALATE_TO_HUMAN', payload: { reason: 'customer request' }, confidence: 0.9, requires_validation: false }], reply_text: 'Baik, saya akan hubungkan dengan customer service.', needs_clarification: false, summary_update: 'Customer ingin bicara dengan CS.' },
  // #13: eh ongkir ke Bandung berapa ya? (entity 'destination' → customer_address)
  { intent: 'shipping_inquiry', confidence: 0.9, entities: [{ type: 'destination', value: 'Bandung', confidence: 0.95 }], proposed_actions: [{ action_type: 'NONE', payload: {}, confidence: 0.9, requires_validation: false }], reply_text: 'Ongkir ke Bandung silakan cek di layanan pengiriman kami.', needs_clarification: false, summary_update: 'Customer bertanya ongkir ke Bandung.' },
  // #14: Budi Santoso (entity 'name' → customer_name)
  { intent: 'product_inquiry', confidence: 0.9, entities: [{ type: 'name', value: 'Budi Santoso', confidence: 0.95 }], proposed_actions: [{ action_type: 'NONE', payload: {}, confidence: 0.9, requires_validation: false }], reply_text: 'Siapa nama Anda?', needs_clarification: true, summary_update: 'Customer memberikan nama.' },
  // #15: brp harga oli (action GET_PRODUCT_INFO → SHOW_RELATED_PRODUCTS)
  { intent: 'product_inquiry', confidence: 0.9, entities: [{ type: 'product', value: 'oli mesin', confidence: 0.95 }], proposed_actions: [{ action_type: 'GET_PRODUCT_INFO', payload: { product: 'oli mesin' }, confidence: 0.9, requires_validation: false }], reply_text: 'Harga oli mesin bisa dilihat di deskripsi produk ya Kak!', needs_clarification: false, summary_update: 'Customer bertanya harga oli mesin.' },
  // #16: Panji Wijaya (entity 'name' → customer_name)
  { intent: 'product_inquiry', confidence: 0.9, entities: [{ type: 'name', value: 'Panji Wijaya', confidence: 0.95 }], proposed_actions: [{ action_type: 'NONE', payload: {}, confidence: 0.9, requires_validation: false }], reply_text: 'Siapa nama Anda?', needs_clarification: true, summary_update: 'Customer memberikan nama.' },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('FIX-SCHEMA-EXPANSION-WITH-NORMALIZATION', () => {
  describe('V2EntitySchema (canonical enum — unchanged)', () => {
    it('does NOT accept alias types directly (name, address, location, etc.)', () => {
      const aliases = ['name', 'address', 'location', 'destination', 'shipping_name', 'complaint'];
      for (const alias of aliases) {
        const result = V2EntitySchema.safeParse({ type: alias, value: 'test', confidence: 0.9 });
        expect(result.success).toBe(false);
      }
    });

    it('still accepts canonical types (customer_name, customer_address, customer_phone)', () => {
      const canonical = ['customer_name', 'customer_address', 'customer_phone'];
      for (const type of canonical) {
        const result = V2EntitySchema.safeParse({ type, value: 'test', confidence: 0.9 });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('V2ProposedActionSchema (canonical enum — unchanged)', () => {
    it('does NOT accept alias action types directly (GET_PRODUCT_INFO, ESCALATE_TO_HUMAN, etc.)', () => {
      const aliases = ['GET_PRODUCT_INFO', 'ESCALATE_TO_HUMAN', 'SHOW_PRODUCTS', 'SHOW_PRODUCT_DETAILS', 'PRODUCT_INFO'];
      for (const alias of aliases) {
        const result = V2ProposedActionSchema.safeParse({
          action_type: alias as any,
          payload: {},
          confidence: 0.9,
          requires_validation: false,
        });
        expect(result.success).toBe(false);
      }
    });
  });

  describe('normalizeV2Output()', () => {
    it('maps entity type "name" → "customer_name"', () => {
      const input = { intent: 'smalltalk', entities: [{ type: 'name', value: 'Panji', confidence: 0.95 }], proposed_actions: [], reply_text: 'Halo!', needs_clarification: false, uncertainty_signals: [] };
      const normalized = normalizeV2Output(input) as any;
      expect(normalized.entities[0].type).toBe('customer_name');
    });

    it('maps entity type "shipping_name" → "customer_name"', () => {
      const input = { intent: 'smalltalk', entities: [{ type: 'shipping_name', value: 'Panji', confidence: 0.95 }], proposed_actions: [], reply_text: 'Halo!', needs_clarification: false, uncertainty_signals: [] };
      const normalized = normalizeV2Output(input) as any;
      expect(normalized.entities[0].type).toBe('customer_name');
    });

    it('maps entity types address/location/destination → customer_address', () => {
      const input = { intent: 'shipping_inquiry', entities: [
        { type: 'address', value: 'Jl. X', confidence: 0.9 },
        { type: 'location', value: 'Jakarta', confidence: 0.9 },
        { type: 'destination', value: 'Bandung', confidence: 0.9 },
      ], proposed_actions: [], reply_text: 'Oke', needs_clarification: false, uncertainty_signals: [] };
      const normalized = normalizeV2Output(input) as any;
      expect(normalized.entities[0].type).toBe('customer_address');
      expect(normalized.entities[1].type).toBe('customer_address');
      expect(normalized.entities[2].type).toBe('customer_address');
    });

    it('maps entity type "complaint" → "other"', () => {
      const input = { intent: 'escalation', entities: [{ type: 'complaint', value: 'mengecewakan', confidence: 0.9 }], proposed_actions: [], reply_text: 'Maaf', needs_clarification: false, uncertainty_signals: [] };
      const normalized = normalizeV2Output(input) as any;
      expect(normalized.entities[0].type).toBe('other');
    });

    it('maps action types GET_PRODUCT_INFO/PRODUCT_INFO/SHOW_PRODUCTS/SHOW_PRODUCT_DETAILS → SHOW_RELATED_PRODUCTS', () => {
      const aliases = ['GET_PRODUCT_INFO', 'PRODUCT_INFO', 'SHOW_PRODUCTS', 'SHOW_PRODUCT_DETAILS'];
      for (const alias of aliases) {
        const input = { intent: 'product_inquiry', entities: [], proposed_actions: [{ action_type: alias, payload: {}, confidence: 0.9, requires_validation: false }], reply_text: 'Harga ada di toko', needs_clarification: false, uncertainty_signals: [] };
        const normalized = normalizeV2Output(input) as any;
        expect(normalized.proposed_actions[0].action_type).toBe('SHOW_RELATED_PRODUCTS');
      }
    });

    it('maps action type ESCALATE_TO_HUMAN → CONTACT_ADMIN', () => {
      const input = { intent: 'escalation', entities: [{ type: 'product', value: 'ban', confidence: 0.8 }], proposed_actions: [{ action_type: 'ESCALATE_TO_HUMAN', payload: { reason: 'complaint' }, confidence: 0.9, requires_validation: false }], reply_text: 'Kami akan bantu', needs_clarification: false, uncertainty_signals: [] };
      const normalized = normalizeV2Output(input) as any;
      expect(normalized.proposed_actions[0].action_type).toBe('CONTACT_ADMIN');
    });

    it('maps action type aliases SHOW_PAYMENT / PAYMENT_METHODS / SHOW_PAYMENT_INFO → SHOW_PAYMENT_METHODS', () => {
      const aliases = ['SHOW_PAYMENT', 'PAYMENT_METHODS', 'SHOW_PAYMENT_INFO'];
      for (const alias of aliases) {
        const input = {
          intent: 'payment_inquiry',
          entities: [],
          proposed_actions: [{ action_type: alias, payload: {}, confidence: 0.85, requires_validation: false }],
          reply_text: 'Berikut metode pembayaran.',
          needs_clarification: false,
          uncertainty_signals: [],
        };
        const normalized = normalizeV2Output(input) as any;
        expect(normalized.proposed_actions[0].action_type).toBe('SHOW_PAYMENT_METHODS');
        // And the normalized output must pass Zod validation
        const result = V2ProposedActionSchema.safeParse(normalized.proposed_actions[0]);
        expect(result.success).toBe(true);
      }
    });

    it('preserves canonical SHOW_PAYMENT_METHODS action unchanged (not an alias)', () => {
      const input = {
        intent: 'payment_inquiry',
        entities: [],
        proposed_actions: [{ action_type: 'SHOW_PAYMENT_METHODS', payload: {}, confidence: 0.9, requires_validation: false }],
        reply_text: 'Berikut metode pembayaran.',
        needs_clarification: false,
        uncertainty_signals: [],
      };
      const normalized = normalizeV2Output(input) as any;
      expect(normalized.proposed_actions[0].action_type).toBe('SHOW_PAYMENT_METHODS');
    });

    it('preserves canonical entity types unchanged', () => {
      const input = { intent: 'product_inquiry', entities: [{ type: 'product', value: 'Ban', confidence: 0.9 }, { type: 'customer_name', value: 'Panji', confidence: 0.95 }], proposed_actions: [{ action_type: 'ADD_TO_CART', payload: { product: 'Ban', qty: 1 }, confidence: 0.95, requires_validation: true }], reply_text: 'Ban ditambahkan', needs_clarification: false, uncertainty_signals: [] };
      const normalized = normalizeV2Output(input) as any;
      expect(normalized.entities[0].type).toBe('product');
      expect(normalized.entities[1].type).toBe('customer_name');
      expect(normalized.proposed_actions[0].action_type).toBe('ADD_TO_CART');
    });

    it('returns non-object input unchanged', () => {
      expect(normalizeV2Output(null)).toBe(null);
      expect(normalizeV2Output('string')).toBe('string');
      expect(normalizeV2Output(undefined)).toBeUndefined();
    });

    it('UPDATE_SHIPPING_ADDRESS is now a CANONICAL action_type (passes Zod, not normalized)', () => {
      const input = { intent: 'shipping_inquiry', entities: [], proposed_actions: [{ action_type: 'UPDATE_SHIPPING_ADDRESS', payload: { address: 'Jl. X' }, confidence: 0.8, requires_validation: true }], reply_text: 'Oke', needs_clarification: false, uncertainty_signals: [] };
      const normalized = normalizeV2Output(input) as any;
      // normalizeV2Output should pass it through unchanged (it's canonical, not an alias)
      expect(normalized.proposed_actions[0].action_type).toBe('UPDATE_SHIPPING_ADDRESS');
      // Verify it passes Zod validation (now a canonical action_type)
      const result = V2ProposedActionSchema.safeParse(normalized.proposed_actions[0]);
      expect(result.success).toBe(true);
    });
  });

  describe('16 previously-failing parse_error outputs', () => {
    it('all 16 raw outputs pass normalization THEN V2EngineOutputSchema validation', () => {
      const failures: number[] = [];
      previouslyFailingRawOutputs.forEach((raw, idx) => {
        // Step 1: normalize alias types → canonical
        const normalized = normalizeV2Output({ ...raw, uncertainty_signals: [] }) as any;
        // Step 2: validate against schema
        const result = V2EngineOutputSchema.safeParse({
          schema_version: 'v1' as const,
          ...normalized,
        });
        if (!result.success) {
          failures.push(idx + 1);
          console.error(`Output ${idx + 1} failed after normalization:`, result.error.issues);
        }
      });
      expect(failures).toEqual([]);
    });

    it('normalized entity types reach correct canonical values (translation-layer proof)', () => {
      const results: Record<string, string> = {};
      previouslyFailingRawOutputs.forEach((raw, idx) => {
        const normalized = normalizeV2Output({ ...raw, uncertainty_signals: [] }) as any;
        const result = V2EngineOutputSchema.safeParse({
          schema_version: 'v1' as const,
          ...normalized,
        });
        if (result.success) {
          results[`msg-${idx + 1}`] = JSON.stringify({
            entities: result.data.entities.map((e: any) => e.type),
            actions: result.data.proposed_actions.map((a: any) => a.action_type),
          });
        }
      });
      // Verify specific mappings for key cases:
      // Case #1: GET_PRODUCT_INFO → SHOW_RELATED_PRODUCTS
      const case1 = JSON.parse(results['msg-1']);
      expect(case1.actions).toContain('SHOW_RELATED_PRODUCTS');
      // Case #2: name → customer_name
      const case2 = JSON.parse(results['msg-2']);
      expect(case2.entities).toContain('customer_name');
      // Case #4: location → customer_address
      const case4 = JSON.parse(results['msg-4']);
      expect(case4.entities).toContain('customer_address');
      // Case #11: ESCALATE_TO_HUMAN → CONTACT_ADMIN
      const case11 = JSON.parse(results['msg-11']);
      expect(case11.actions).toContain('CONTACT_ADMIN');
    });
  });
});
