import { prisma } from '../src/infrastructure/prisma.js';
import { AIProviderResolverService } from '../src/services/ai-provider-resolver.service.js';

async function main() {
  console.log('=== CURRENT AI_PROVIDER_CONFIGS ROWS ===');
  const rows = await prisma.aIProviderConfig.findMany({
    orderBy: [{ role: 'asc' }, { priority: 'asc' }],
    select: { id: true, name: true, role: true, priority: true, isActive: true, format: true, baseUrl: true }
  });
  for (const r of rows) {
    console.log(`${r.id} | ${r.name} | role=${r.role} | priority=${r.priority} | active=${r.isActive} | format=${r.format}`);
  }
  console.log(`\nTotal rows: ${rows.length}`);

  // Count per role
  const roleCount: Record<string, number> = {};
  for (const r of rows) {
    roleCount[r.role] = (roleCount[r.role] || 0) + 1;
  }
  console.log('\nRows per role:', JSON.stringify(roleCount, null, 2));

  // Check schema constraints
  console.log('\n=== SCHEMA CONSTRAINTS ===');
  const schema = await prisma.$queryRaw`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'ai_provider_configs'`;
  console.log(JSON.stringify(schema, null, 2));

  console.log('\n=== BEFORE TEST: getProvidersForRole("chat_primary") ===');
  const resolver = new AIProviderResolverService();
  const beforeProviders = await resolver.getProvidersForRole('chat_primary');
  console.log(`Count: ${beforeProviders.length}`);
  for (const p of beforeProviders) {
    console.log(`  - ${p.getName()} (${p.getModel()})`);
  }

  // Test INSERT dummy second row
  console.log('\n=== TEST: INSERT dummy second chat_primary row ===');
  const dummy = await prisma.aIProviderConfig.create({
    data: {
      name: 'TEST-DUPLICATE-PRIMARY',
      format: 'openai_compatible',
      baseUrl: 'https://api.test-dummy.invalid',
      apiKey: 'dummy-key-for-test-only',
      model: 'test-model',
      role: 'chat_primary',
      priority: 999,
      isActive: true,
    }
  });
  console.log(`Created dummy row: ${dummy.id}`);

  // Invalidate cache
  resolver.invalidateCache();

  console.log('\n=== AFTER TEST: getProvidersForRole("chat_primary") ===');
  const afterProviders = await resolver.getProvidersForRole('chat_primary');
  console.log(`Count: ${afterProviders.length}`);
  for (const p of afterProviders) {
    console.log(`  - ${p.getName()} (${p.getModel()})`);
  }

  // Cleanup
  console.log('\n=== CLEANUP: delete dummy row ===');
  const deleted = await prisma.aIProviderConfig.delete({
    where: { id: dummy.id }
  });
  console.log(`Deleted: ${deleted.name}`);

  resolver.invalidateCache();

  console.log('\n=== AFTER CLEANUP: getProvidersForRole("chat_primary") ===');
  const finalProviders = await resolver.getProvidersForRole('chat_primary');
  console.log(`Count: ${finalProviders.length}`);
  for (const p of finalProviders) {
    console.log(`  - ${p.getName()} (${p.getModel()})`);
  }

  const finalCount = await prisma.aIProviderConfig.count();
  console.log(`\nFinal total rows: ${finalCount} (should match before: ${rows.length})`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
