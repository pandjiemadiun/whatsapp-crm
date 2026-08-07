import { prisma } from '../src/infrastructure/prisma.js';

async function main() {
  const settings = await prisma.systemSetting.findMany({
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
    select: { key: true, category: true, isSecret: true, description: true, value: true }
  });
  console.log('All system_settings from DB:');
  console.log(JSON.stringify(settings, null, 2));
}

main().catch(e => console.error(e)).finally(() => process.exit(0));
