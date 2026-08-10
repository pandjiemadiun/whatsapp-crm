/**
 * TASK B4.5 — Throwaway DB readback untuk verifikasi isProductNotFoundInquiry /
 * tryProductNotFound threshold change.
 *
 * Insert FAQ/knowledge dummy, search, print raw confidence scores,
 * demonstrate before-fix (threshold 0.3) vs after-fix (threshold 0.5 + margin)
 * behavior, lalu DELETE semua dummy.
 *
 * Query test: "gimana cara order"
 * - FAQ low: question="syarat order", answer="hubungi admin ya" → conf ~0.35
 * - FAQ high: question="order cara", answer="silakan order" → conf ~0.75
 * - Knowledge low: title="syarat order", content="order bisa langsung" → conf ~0.375
 * - Knowledge high: title="cara order", content="gimana order bisa" → conf ~0.75
 *
 * Run: npx tsx --env-file=../../.env scripts/task-b45-test.ts
 */
import { prisma } from '../src/infrastructure/prisma.js';
import { faqService } from '../src/business/faq.service.js';
import { knowledgeService } from '../src/business/knowledge.service.js';

const STORE_ID = 'store-f7140b5c';
const TEST_QUERY = 'gimana cara order';

// Threshold lama vs baru (sesuai fallback.service.ts setelah B4.4 fix)
const THRESHOLD_OLD = 0.3;
const THRESHOLD_NEW = 0.5;
const MARGIN_NEW = 0.15;

function simulateTryProductNotFound(results: Array<{ confidence: number; [k: string]: any }>): {
  matched: boolean; reason: string
} {
  if (results.length === 0) return { matched: false, reason: 'no results' };
  const r0 = results[0];

  // BEFORE fix: hanya threshold 0.3
  const matchedOld = r0.confidence > THRESHOLD_OLD;
  // AFTER fix: threshold 0.5 + margin (jika ≥2 hasil)
  const marginOk = results.length === 1 || r0.confidence - results[1].confidence >= MARGIN_NEW;
  const matchedNew = r0.confidence > THRESHOLD_NEW && marginOk;

  if (!matchedOld) return {
    matched: false, reason: `conf ${r0.confidence.toFixed(3)} <= OLD ${THRESHOLD_OLD} (no match either way)`
  };
  if (!matchedNew) return {
    matched: false, reason: `OLD: ${r0.confidence.toFixed(3)} > ${THRESHOLD_OLD} → match | NEW: ${r0.confidence.toFixed(3)} ≤ ${THRESHOLD_NEW} or margin < ${MARGIN_NEW} → no match (FIX BEKERJA)`
  };
  return {
    matched: true, reason: `conf ${r0.confidence.toFixed(3)} > ${THRESHOLD_NEW} → match (regresi aman)`
  };
}

async function main() {
  console.log(`========================================`);
  console.log(`TASK B4.5 — DB readback: tryFAQ/tryKnowledge confidence`);
  console.log(`Store: ${STORE_ID} | Query: "${TEST_QUERY}"`);
  console.log(`========================================\n`);

  // ── Phase 1: FAQ low confidence (harus match sebelum, tidak match sesudah) ──
  console.log(`--- Phase 1a: FAQ LOW confidence (target ~0.35) ---`);
  const faqLow = await prisma.fAQ.create({
    data: {
      storeId: STORE_ID,
      question: 'syarat order',
      answer: 'hubungi admin ya',
      keywords: [],
      category: 'test-b45',
      priority: 1,
      isActive: true,
    },
  });
  console.log(`Inserted FAQ low: id=${faqLow.id}, question="${faqLow.question}"`);

  let faqResults = await faqService.search(STORE_ID, TEST_QUERY);
  console.log(`FAQ search results (${faqResults.length}):`);
  faqResults.forEach((r, i) => {
    console.log(`  [${i}] conf=${r.confidence.toFixed(4)}  question="${r.question}"`);
  });
  let sim = simulateTryProductNotFound(faqResults);
  console.log(`Simulate: ${sim.matched ? 'MATCH' : 'NO MATCH'} — ${sim.reason}\n`);

  // ── Phase 2: FAQ high confidence (harus match sebelum dan sesudah / regresi) ──
  console.log(`--- Phase 1b: FAQ HIGH confidence (target ~0.75) ---`);
  const faqHigh = await prisma.fAQ.create({
    data: {
      storeId: STORE_ID,
      question: 'order cara',
      answer: 'silakan order',
      keywords: [],
      category: 'test-b45',
      priority: 1,
      isActive: true,
    },
  });
  console.log(`Inserted FAQ high: id=${faqHigh.id}, question="${faqHigh.question}"`);

  faqResults = await faqService.search(STORE_ID, TEST_QUERY);
  console.log(`FAQ search results (${faqResults.length}):`);
  faqResults.forEach((r, i) => {
    console.log(`  [${i}] conf=${r.confidence.toFixed(4)}  question="${r.question}"`);
  });
  sim = simulateTryProductNotFound(faqResults);
  console.log(`Simulate: ${sim.matched ? 'MATCH' : 'NO MATCH'} — ${sim.reason}\n`);

  // ── Phase 3: FAQ both (margin check) ---
  console.log(`--- Phase 1c: FAQ BOTH (margin check) ---`);
  console.log(`Results [0].conf - [1].conf = ${faqResults[0].confidence.toFixed(4)} - ${faqResults[1].confidence.toFixed(4)} = ${(faqResults[0].confidence - faqResults[1].confidence).toFixed(4)} (>= ${MARGIN_NEW}? ${faqResults[0].confidence - faqResults[1].confidence >= MARGIN_NEW ? 'YES' : 'NO'})\n`);

  // ── Phase 4: Knowledge low confidence ---
  console.log(`--- Phase 2a: Knowledge LOW confidence (target ~0.375) ---`);
  const kbLow = await prisma.knowledge.create({
    data: {
      storeId: STORE_ID,
      title: 'syarat order',
      content: 'order bisa langsung',
      tags: [],
      category: 'test-b45',
      relevanceScore: 0,
      isActive: true,
    },
  });
  console.log(`Inserted Knowledge low: id=${kbLow.id}, title="${kbLow.title}"`);

  let kbResults = await knowledgeService.search(STORE_ID, TEST_QUERY);
  console.log(`Knowledge search results (${kbResults.length}):`);
  kbResults.forEach((r, i) => {
    console.log(`  [${i}] conf=${r.confidence.toFixed(4)}  title="${r.title}"`);
  });
  sim = simulateTryProductNotFound(kbResults);
  console.log(`Simulate: ${sim.matched ? 'MATCH' : 'NO MATCH'} — ${sim.reason}\n`);

  // ── Phase 5: Knowledge high confidence ---
  console.log(`--- Phase 2b: Knowledge HIGH confidence (target ~0.75) ---`);
  const kbHigh = await prisma.knowledge.create({
    data: {
      storeId: STORE_ID,
      title: 'cara order',
      content: 'gimana order bisa',
      tags: [],
      category: 'test-b45',
      relevanceScore: 0,
      isActive: true,
    },
  });
  console.log(`Inserted Knowledge high: id=${kbHigh.id}, title="${kbHigh.title}"`);

  kbResults = await knowledgeService.search(STORE_ID, TEST_QUERY);
  console.log(`Knowledge search results (${kbResults.length}):`);
  kbResults.forEach((r, i) => {
    console.log(`  [${i}] conf=${r.confidence.toFixed(4)}  title="${r.title}"`);
  });
  sim = simulateTryProductNotFound(kbResults);
  console.log(`Simulate: ${sim.matched ? 'MATCH' : 'NO MATCH'} — ${sim.reason}\n`);

  // ── Phase 6: Knowledge both (margin check) ---
  console.log(`--- Phase 2c: Knowledge BOTH (margin check) ---`);
  if (kbResults.length >= 2) {
    console.log(`Results [0].conf - [1].conf = ${kbResults[0].confidence.toFixed(4)} - ${kbResults[1].confidence.toFixed(4)} = ${(kbResults[0].confidence - kbResults[1].confidence).toFixed(4)} (>= ${MARGIN_NEW}? ${kbResults[0].confidence - kbResults[1].confidence >= MARGIN_NEW ? 'YES' : 'NO'})\n`);
  }

  // ── Cleanup: delete all dummy data ---
  console.log(`--- Cleanup ---`);
  await prisma.fAQ.deleteMany({ where: { category: 'test-b45' } });
  await prisma.knowledge.deleteMany({ where: { category: 'test-b45' } });
  console.log(`Deleted all dummy FAQ and Knowledge (category: test-b45)`);

  // ── Verify cleanup ---
  const remainingFaq = await prisma.fAQ.count({ where: { category: 'test-b45' } });
  const remainingKb = await prisma.knowledge.count({ where: { category: 'test-b45' } });
  const faqMatchCount = await prisma.fAQ.findMany({
    where: { storeId: STORE_ID, isActive: true },
    select: { matchCount: true },
  }).then(res => res.reduce((sum, f) => sum + f.matchCount, 0));
  console.log(`Remaining dummy FAQ: ${remainingFaq} (harus 0)`);
  console.log(`Remaining dummy Knowledge: ${remainingKb} (harus 0)`);
  console.log(`Total FAQ matchCount for store: ${faqMatchCount}`);

  if (remainingFaq === 0 && remainingKb === 0) {
    console.log(`\n✅ CLEANUP OK — semua dummy data berhasil dihapus`);
  } else {
    console.log(`\n❌ CLEANUP GAGAL — masih ada dummy data!`);
  }
}

main()
  .catch((err) => {
    console.error('Script error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
