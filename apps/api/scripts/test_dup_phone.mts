import { PrismaClient } from '@prisma/client';
import { getEncryptionKey, hashField, decryptField } from '../src/utils/encryption.js';
async function main() {
  const prisma = new PrismaClient();
  const key = await getEncryptionKey();
  
  // Find store-1's phone
  const store1 = await prisma.store.findUnique({ where: { id: 'store-1' }, select: { phoneNumber: true } });
  const plain = decryptField(store1!.phoneNumber, key);
  console.log('store-1 phone:', plain);
  
  // Compute hash for that phone
  const hash = hashField(plain, key);
  console.log('hash:', hash);
  
  // Check if any store already has this hash
  const existing = await prisma.store.findFirst({ where: { phoneNumberHash: hash } });
  console.log('Store with same hash:', existing?.id);
  
  // Now simulate what happens when we try to insert a duplicate
  // The phoneNumberHash column has a UNIQUE constraint
  try {
    await prisma.store.create({
      data: {
        id: 'test-dup-temp',
        name: 'Temp',
        email: 'temp_test_dup@example.com',
        phoneNumber: plain,
        phoneNumberHash: hash,
        address: 'x',
        originProvinceId: '1',
        originProvinceName: 'x',
        originCityId: '1',
        originCityName: 'x',
        originSubdistrictId: '1',
        originSubdistrictName: 'x',
      },
    });
    console.log('ERROR: Should have failed!');
  } catch (e: any) {
    console.log('Insert failed as expected:', e.code, '-', e.message?.slice(0, 100));
  }
  
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
