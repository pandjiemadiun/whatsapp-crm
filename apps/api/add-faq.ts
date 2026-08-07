import { adapters } from './src/adapters/container.js';

async function run() {
  const storeId = '550e8400-e29b-41d4-a716-446655440000';
  console.log('Menambahkan data FAQ ke database...');
  
  const result = await adapters.knowledge.create(
    storeId,
    'Operasional',
    'Berapa jam buka?',
    'Toko kami buka setiap hari Senin - Jumat pukul 08:00 - 20:00 WIB, dan akhir pekan pukul 09:00 - 18:00 WIB.',
    'jam buka, operasional, jadwal, kapan buka'
  );
  
  console.log('✅ FAQ Berhasil ditambahkan!');
  console.log(result);
  process.exit(0);
}
run().catch(console.error);
