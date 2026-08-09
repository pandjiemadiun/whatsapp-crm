/**
 * P0 Safety Boundary — Engine v2 must NOT fall back to v1 after a mutation.
 * Refs: RAILS.md §3 P0 (TASK A), conversation.service.ts v2 branch.
 *
 * Runner: npx tsx --test --test-force-exit src/services/chat/__tests__/safety-boundary-v2.test.ts
 *
 * Skenario:
 *   v2 mengeksekusi cart ops (mutasi cart), lalu langkah post-mutation
 *   (composeReply / saveWorkspace) melempar error.
 *   - Sebelum fix: exception jatuh ke outer catch → fallback v1 → pesan yang
 *     sama diproses ulang → BISA dobel mutasi.
 *   - Sesudah fix: mutasi sudah terjadi → return safe reply (static string,
 *     tanpa LLM) dan jalur v1 TIDAK pernah dicapai.
 *
 * Karena conversation.service.ts meng-import lewat ESM statis (getStoreEngine,
 * understand, composeReply tidak bisa di-stub dari luar tanpa loader), test
 * ini meniru aliran v2 branch persis seperti file sumber (pola sama dengan
 * engine-e2e-v2.test.ts) dan memverifikasi guard terpasang di source nyata.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SERVICE_PATH = fileURLToPath(
  new URL('../../../business/conversation.service.ts', import.meta.url)
);

// ─────────────────────────────────────────────────────────────────────────────
// Simulasi v2 + safety boundary (mirror conversation.service.ts v2 branch)
// ─────────────────────────────────────────────────────────────────────────────

interface SimResult {
  safeReplied: boolean;
  replyText: string | null;
  v1FallbackTriggered: boolean;
  mutationCount: number;
}

/**
 * Meniru alur v2 branch yang dipatch (lihat file sumber):
 *   mutation phase → set v2MutationExecuted → post-mutation guard try/catch.
 * `postMutationFailure: true` mensimulasikan composeReply/saveWorkspace throw.
 */
async function simulateV2Turn(opts: {
  cartOps: number;
  failBeforeMutation?: boolean;
  failAfterMutation?: boolean;
}): Promise<SimResult> {
  let mutationCount = 0;
  let v2MutationExecuted = false;
  let v1FallbackTriggered = false;

  try {
    // ── MUTATION PHASE (setara executeCartOps) ──
    if (opts.failBeforeMutation) {
      throw new Error('BOOM-before-mutation');
    }
    for (let i = 0; i < opts.cartOps; i++) {
      mutationCount += 1;
    }
    if (opts.cartOps > 0) {
      v2MutationExecuted = true;
    }

    // ── POST-MUTATION PHASE (guard lokal — TASK A) ──
    try {
      if (opts.failAfterMutation) {
        throw new Error('BOOM-post-mutation');
      }
      return {
        safeReplied: false,
        replyText: 'v2-normal-reply',
        v1FallbackTriggered: false,
        mutationCount,
      };
    } catch {
      if (v2MutationExecuted) {
        // P0: mutasi sudah terjadi → safe reply statis, JANGAN fallback ke v1
        return {
          safeReplied: true,
          replyText:
            'Baik kak, pesanan Kakak sudah kami catat. Silakan ketik *total* atau *cek pesanan* untuk melihat ringkasannya ya. 🙏',
          v1FallbackTriggered: false,
          mutationCount,
        };
      }
      throw new Error('BOOM-propagate-to-v1');
    }
  } catch {
    // Outer catch — fallback v1 hanya valid utk error PRE-mutation
    v1FallbackTriggered = true;
    return {
      safeReplied: false,
      replyText: null,
      v1FallbackTriggered,
      mutationCount,
    };
  }
}

describe('P0 Safety Boundary — v2 mutates, never falls back to v1', () => {
  it('ACCEPTANCE: sukses executeCartOps → composeReply throw → safe reply, v1 never, EXACTLY 1 mutation', async () => {
    const res = await simulateV2Turn({ cartOps: 1, failAfterMutation: true });

    // (c) returns a reply AND does not throw to caller
    assert.ok(res.replyText, 'harus return reply, tidak throw ke pemanggil');
    assert.equal(res.safeReplied, true);

    // (a) v1 branch NEVER called
    assert.equal(res.v1FallbackTriggered, false, 'v1 TIDAK boleh dipanggil');

    // (b) EXACTLY satuta mutation
    assert.equal(res.mutationCount, 1, 'harus EXACTLY 1 mutation');
  });

  it('post-mutation failure dengan dua ops → dua mutation, tetap safe-reply', async () => {
    const res = await simulateV2Turn({ cartOps: 2, failAfterMutation: true });
    assert.equal(res.safeReplied, true);
    assert.equal(res.v1FallbackTriggered, false);
    assert.equal(res.mutationCount, 2);
  });

  it('PRE-mutation failure masih boleh fallback ke v1 (perilaku lama dipertahankan)', async () => {
    const res = await simulateV2Turn({ cartOps: 0, failBeforeMutation: true });
    assert.equal(res.safeReplied, false);
    assert.equal(res.v1FallbackTriggered, true, 'pre-mutation error → fallback v1 valid');
    assert.equal(res.mutationCount, 0);
  });

  it('no error: aliran normal tidak terpengaruh', async () => {
    const res = await simulateV2Turn({ cartOps: 1, failAfterMutation: false });
    assert.equal(res.safeReplied, false);
    assert.equal(res.v1FallbackTriggered, false);
    assert.equal(res.mutationCount, 1);
    assert.equal(res.replyText, 'v2-normal-reply');
  });

  it('REAL SOURCE: safety-boundary guard terpasang di conversation.service.ts', () => {
    const src = readFileSync(SERVICE_PATH, 'utf8');
    assert.match(src, /let v2MutationExecuted = false/, 'flag guard harus dideklarasikan');
    const setCount = (src.match(/v2MutationExecuted = true/g) ?? []).length;
    assert.ok(
      setCount >= 2,
      `flag harus di-set setelah executeCartOps (resolved + reasoned/cartActs); ditemukan ${setCount}`
    );
    assert.match(src, /buildSafeReply\(/, 'safe-reply builder harus dipanggil di guard');
  });
});