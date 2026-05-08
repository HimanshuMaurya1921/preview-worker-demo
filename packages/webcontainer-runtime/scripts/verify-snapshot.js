const fs = require('fs');
const path = require('path');

// Configuration: Adjust these paths to match your project structure
const SOURCE_DIR = process.env.SOURCE_DIR || path.join(__dirname, '../../../template');
const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR || path.join(__dirname, '../../../frontend/public/snapshot');

async function verify() {
  console.log('[Verify] Loading manifest...');
  const manifest = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, 'manifest.json'), 'utf8'));
  
  const chunks = new Map();
  console.log('[Verify] Reading chunks...');
  for (const chunkName of manifest.chunks) {
    chunks.set(chunkName, fs.readFileSync(path.join(SNAPSHOT_DIR, chunkName)));
  }

  const criticalFiles = [
    'package.json',
    'node_modules/next/package.json',
    'node_modules/react/index.js'
  ];

  let errorCount = 0;

  for (const file of criticalFiles) {
    console.log(`[Verify] Checking ${file}...`);
    const info = manifest.files[file];
    if (!info) {
      console.error(`[Error] ${file} not found in manifest!`);
      errorCount++;
      continue;
    }

    const chunk = chunks.get(manifest.chunks[info.chunkIndex]);
    const extracted = chunk.slice(info.offset, info.offset + info.length);
    const original = fs.readFileSync(path.join(SOURCE_DIR, file));

    if (Buffer.compare(extracted, original) !== 0) {
      console.error(`[Error] Content mismatch for ${file}!`);
      console.log(`  Extracted length: ${extracted.length}, Original length: ${original.length}`);
      errorCount++;
    } else {
      console.log(`[OK] ${file} is identical.`);
    }
  }

  if (errorCount === 0) {
    console.log('[Success] All critical files verified!');
  } else {
    console.error(`[Failure] ${errorCount} errors found.`);
    process.exit(1);
  }
}

verify().catch(console.error);
