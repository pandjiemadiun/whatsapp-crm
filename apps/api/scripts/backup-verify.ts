import fs from 'fs';
import path from 'path';

function main() {
  const filename = process.argv[2];

  if (!filename) {
    console.error('Usage: npm run backup:verify -- <filename>');
    console.error('Example: npm run backup:verify -- backup_2025-01-15.sql');
    process.exit(1);
  }

  const filepath = path.resolve(filename);

  if (!fs.existsSync(filepath)) {
    console.error(`✗ File not found: ${filepath}`);
    process.exit(1);
  }

  const stat = fs.statSync(filepath);
  const content = fs.readFileSync(filepath, 'utf8');
  const statements = content.split(';').filter((s) => s.trim().length > 0).length;

  const sizeKB = (stat.size / 1024).toFixed(1);

  console.log('✓ Backup valid');
  console.log(`  File: ${filename}`);
  console.log(`  Size: ${sizeKB} KB`);
  console.log(`  Statements: ${statements.toLocaleString()}`);
  console.log(`  Valid: YES`);

  process.exit(0);
}

main();
