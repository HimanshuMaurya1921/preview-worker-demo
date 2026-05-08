const fs = require('fs');
const path = require('path');

// Configuration: Adjust these paths to match your project structure
const SOURCE_DIR = process.env.SOURCE_DIR || path.join(__dirname, '../../../template');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(__dirname, '../../../frontend/public/snapshot');
const CHUNK_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB chunks
const SNAPSHOT_VERSION = Date.now().toString().slice(-6); // Simple versioning

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function shouldPrune(file, fullPath) {
  if (fullPath.includes('node_modules')) {
    const lower = file.toLowerCase();
    if (lower.endsWith('.md')) return true;
    if (lower.endsWith('.ts')) return true;
    if (lower.endsWith('.map')) return true;
    if (lower === 'license' || lower === 'licence') return true;
    if (lower === 'changelog') return true;
    if (lower === 'readme') return true;
    if (lower === 'test' || lower === 'tests') return true;
    if (lower === 'example' || lower === 'examples') return true;
    if (lower === 'docs') return true;
    if (lower === '.bin' && !fullPath.endsWith('/node_modules/.bin')) return true;
  }
  return false;
}

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    if (shouldPrune(file, fullPath)) return;
    
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else {
      if (file.endsWith('.node')) return;
      if (file === '.DS_Store') return;
      results.push(fullPath);
    }
  });
  return results;
}

async function main() {
  console.log(`[Snapshot] Walking ${SOURCE_DIR}...`);
  const files = walk(SOURCE_DIR);
  console.log(`[Snapshot] Found ${files.length} valid files.`);

  const manifest = {
    version: SNAPSHOT_VERSION,
    chunks: [],
    files: {}
  };

  let currentChunkFiles = [];
  let currentChunkSize = 0;
  let chunkIndex = 0;

  files.sort();

  for (const file of files) {
    const relativePath = path.relative(SOURCE_DIR, file);
    const content = fs.readFileSync(file);
    const length = content.length;

    if (currentChunkSize + length > CHUNK_SIZE_LIMIT && currentChunkFiles.length > 0) {
      await writeChunk(currentChunkFiles, chunkIndex);
      manifest.chunks.push(`chunk-${chunkIndex}-${SNAPSHOT_VERSION}.wasm`);
      chunkIndex++;
      currentChunkFiles = [];
      currentChunkSize = 0;
    }

    manifest.files[relativePath] = {
      chunkIndex,
      offset: currentChunkSize,
      length
    };

    currentChunkFiles.push(content);
    currentChunkSize += length;
  }

  if (currentChunkFiles.length > 0) {
    await writeChunk(currentChunkFiles, chunkIndex);
    manifest.chunks.push(`chunk-${chunkIndex}-${SNAPSHOT_VERSION}.wasm`);
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[Snapshot] Done. Generated ${manifest.chunks.length} chunks (v${SNAPSHOT_VERSION}).`);
}

async function writeChunk(contents, index) {
  const buffer = Buffer.concat(contents);
  const fileName = `chunk-${index}-${SNAPSHOT_VERSION}.wasm`;
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), buffer);
  console.log(`[Snapshot] Wrote ${fileName} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch(console.error);
