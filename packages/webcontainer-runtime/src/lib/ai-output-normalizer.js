/**
 * AI Output Normalizer: Sanitizes, validates, and optimizes AI-generated file updates.
 */

const ALLOWED_DIRECTORIES = ['app', 'components', 'lib', 'hooks', 'styles'];
const FORBIDDEN_FILES = ['package.json', 'next.config.js', 'tsconfig.json', 'tailwind.config.js', 'postcss.config.js', '.env'];

export class AiOutputNormalizer {
  constructor(webContainer) {
    this.wc = webContainer;
    this.fileCache = new Map(); // path -> hash/content
  }

  /**
   * Validates and writes a set of files to the WebContainer.
   * @param {Object} files Map of relative paths to content.
   */
  async patch(files) {
    const patches = [];

    for (const [filePath, content] of Object.entries(files)) {
      // 1. Guardrails: Check if path is allowed
      if (!this.isPathAllowed(filePath)) {
        console.warn(`[Guardrail] Blocked attempt to write to restricted path: ${filePath}`);
        continue;
      }

      // 2. Normalization: Sanitize content (e.g., imports)
      const normalizedContent = this.normalizeContent(content);

      // 3. Differential Update: Check if content actually changed
      if (this.fileCache.get(filePath) === normalizedContent) {
        // Skip writing if identical
        continue;
      }

      patches.push({ filePath, content: normalizedContent });
    }

    // Execute patches in parallel
    await Promise.all(patches.map(async ({ filePath, content }) => {
      // Ensure directory exists
      const dir = filePath.split('/').slice(0, -1).join('/');
      if (dir) {
        await this.wc.fs.mkdir(dir, { recursive: true });
      }
      
      await this.wc.fs.writeFile(filePath, content);
      this.fileCache.set(filePath, content);
      console.log(`[Normalizer] Patched ${filePath}`);
    }));
  }

  isPathAllowed(filePath) {
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1];

    // Check forbidden filenames
    if (FORBIDDEN_FILES.includes(fileName)) return false;

    // Check allowed top-level directories
    const topDir = parts[0];
    if (ALLOWED_DIRECTORIES.includes(topDir)) return true;

    // Reject anything else
    return false;
  }

  normalizeContent(content) {
    if (typeof content !== 'string') return content;
    // 1. Normalize imports (basic regex example)
    // Replace ../../../components/X with @/components/X
    let normalized = content.replace(/import\s+.*\s+from\s+['"]\.\.\/\.\.\/\.\.\/components\/(.*)['"]/g, "import $1 from '@/components/$1'");
    
    // Add more normalization rules as needed...
    
    return normalized;
  }

  clearCache() {
    this.fileCache.clear();
  }
}
