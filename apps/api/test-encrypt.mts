import { prisma } from './dist/infrastructure/prisma.js';

async function main() {
  const store = await prisma.store.findFirst({ orderBy: { id: 'desc' } });
  
  const bankAcc = await prisma.bankAccount.create({
    data: {
      storeId: store!.id,
      bankName: 'TEST-VERIFY-BANK',
      accountNumber: 'TEST-ENCRYPT-ACCOUNT-98765',
      accountName: 'TEST-ENCRYPT-NAME-VERIFY',
    }
  });
  
  console.log('Created ID:', bankAcc.id);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
