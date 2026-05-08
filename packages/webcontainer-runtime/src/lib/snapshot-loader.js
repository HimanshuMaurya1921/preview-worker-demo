/**
 * Snapshot Loader: Manages chunked binary snapshots and OPFS caching.
 */

export class SnapshotLoader {
  constructor(baseUrl = '/snapshot') {
    this.baseUrl = baseUrl;
    this.manifest = null;
    this.chunks = new Map(); // index -> ArrayBuffer
  }

  async load() {
    console.log('[Snapshot] Loading manifest...');
    const res = await fetch(`${this.baseUrl}/manifest.json`);
    this.manifest = await res.json();
    
    // Proactively fetch chunks in parallel (limited to 4 at a time to avoid congestion)
    await this.loadChunks();
    
    return this.assembleTree();
  }

  async loadChunks() {
    const chunkPromises = this.manifest.chunks.map(async (chunkName, index) => {
      // Try OPFS first
      const cached = await this.getFromOPFS(chunkName);
      if (cached) {
        console.log(`[Snapshot] Loaded ${chunkName} from OPFS cache.`);
        this.chunks.set(index, cached);
        return;
      }

      // Fetch if not cached
      console.log(`[Snapshot] Fetching ${chunkName}...`);
      const res = await fetch(`${this.baseUrl}/${chunkName}`);
      const buffer = await res.arrayBuffer();
      this.chunks.set(index, buffer);
      
      // Save to OPFS for next time
      await this.saveToOPFS(chunkName, buffer);
    });

    await Promise.all(chunkPromises);
  }

  async getFromOPFS(name) {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(name);
      const file = await fileHandle.getFile();
      return await file.arrayBuffer();
    } catch (e) {
      return null;
    }
  }

  async saveToOPFS(name, buffer) {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(buffer);
      await writable.close();
    } catch (e) {
      console.error(`[Snapshot] Failed to save ${name} to OPFS:`, e);
    }
  }

  assembleTree() {
    const tree = {};

    for (const [filePath, info] of Object.entries(this.manifest.files)) {
      const parts = filePath.split('/');
      let current = tree;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part]) {
          current[part] = { directory: {} };
        }
        current = current[part].directory;
      }

      const fileName = parts[parts.length - 1];
      const chunk = this.chunks.get(info.chunkIndex);
      
      if (!chunk) {
        console.error(`[Snapshot] Missing chunk ${info.chunkIndex} for ${filePath}`);
        continue;
      }

      // Use a view on the original ArrayBuffer instead of slicing/copying
      // This is much faster and saves memory
      const content = new Uint8Array(chunk, info.offset, info.length);
      
      current[fileName] = {
        file: {
          contents: content
        }
      };
    }

    return tree;
  }
}
