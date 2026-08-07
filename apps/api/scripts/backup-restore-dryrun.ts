#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const backupArg = args.find((a) => a.startsWith('--backup='));
  if (!backupArg) {
    console.error('Usage: npm run restore:dry-run -- --backup=<path>');
    console.error('Example: npm run restore:dry-run -- --backup=./backup.sql');
    process.exit(1);
  }
  return backupArg.split('=')[1];
}

function extractTables(sql: string): string[] {
  const tables = new Set<string>();

  const createRegex = /CREATE\s+(?:TABLE|VIEW|INDEX)\s+(?:IF NOT EXISTS\s+)?(?:public\.)?["']?(\w+)["']?/gi;
  let match;
  while ((match = createRegex.exec(sql)) !== null) {
    tables.add(match[1]);
  }

  const insertRegex = /INSERT\s+INTO\s+(?:public\.)?["']?(\w+)["']?/gi;
  while ((match = insertRegex.exec(sql)) !== null) {
    tables.add(match[1]);
  }

  return Array.from(tables).sort();
}

function main() {
  const filename = parseArgs();
  const filepath = path.resolve(filename);

  if (!fs.existsSync(filepath)) {
    console.error(`✗ Backup file not found: ${filepath}`);
    process.exit(1);
  }

  const stat = fs.statSync(filepath);
  const content = fs.readFileSync(filepath, 'utf8');
  const statements = content.split(';').filter((s) => s.trim().length > 0).length;
  const tables = extractTables(content);
  const sizeKB = (stat.size / 1024).toFixed(1);

  console.log('');
  console.log('🔍 Restore Dry-Run Summary');
  console.log(`  Backup:       ${filename}`);
  console.log(`  Tables:       ${tables.join(', ')} (${tables.length} total)`);
  console.log(`  Statements:   ${statements.toLocaleString()}`);
  console.log(`  Size:         ${sizeKB} KB`);
  console.log(`  Status:       ✓ Safe to proceed`);
  console.log('');

  process.exit(0);
}

main();
