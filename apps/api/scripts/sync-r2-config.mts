import { config } from 'dotenv';
config({ path: '/home/ubuntu/garuda/.env', override: true });

import { configService } from '../src/business/config.service.js';
import { adapters, reloadAdaptersConfig, initAdapters } from '../src/adapters/container.js';

// Read current .env values
const envVars = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'];

async function main() {
  // Initialize adapters (loads config)
  await initAdapters();

  console.log('=== Backing up current DB values ===');
  const backup: Record<string, string | null> = {};
  for (const key of envVars) {
    backup[key] = await configService.getConfig(key);
    console.log(`  ${key}: ${backup[key] ? '[SET]' : '[NULL/EMPTY]'}`);
  }

  console.log('\n=== Reading .env values ===');
  const envValues: Record<string, string> = {};
  for (const key of envVars) {
    envValues[key] = process.env[key] || '';
    console.log(`  ${key}: ${envValues[key] ? '[SET]' : '[EMPTY]'}`);
  }

  console.log('\n=== Updating DB to match .env ===');
  for (const key of envVars) {
    const envVal = envValues[key];
    if (!envVal) {
      console.log(`  ${key}: SKIP (empty in .env)`);
      continue;
    }
    // setConfig handles base64 encoding for isSecret=true
    await configService.setConfig(key, envVal, {
      category: 'storage',
      isSecret: true,
      description: `Synced from .env on ${new Date().toISOString()}`,
    });
    console.log(`  ${key}: UPDATED`);
  }

  console.log('\n=== Verifying new values ===');
  for (const key of envVars) {
    const newVal = await configService.getConfig(key);
    const envVal = envValues[key];
    const matches = newVal === envVal;
    console.log(`  ${key}: ${matches ? 'MATCHES .env' : 'MISMATCH'}`);
  }

  console.log('\n=== Reloading adapters ===');
  await reloadAdaptersConfig();
  console.log('  Adapters reloaded');

  console.log('\nDone.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
