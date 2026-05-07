const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { createProxyMiddleware } = require('http-proxy-middleware');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = 3000;
const NEXT_PORT = 3001;
const WORKSPACE = process.env.WORKSPACE || path.join(os.tmpdir(), `ai-studio-worker`);
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'local-dev-token';

// ─── State ────────────────────────────────────────────────────────────────────
let nextReady = false;

async function prepareWorkspace(workDir) {
  await fs.mkdir(workDir, { recursive: true });

  const templateDir = path.join(__dirname, 'template');
  await copyRecursive(templateDir, workDir);

  const centralModules = '/app/central_modules/node_modules';
  const targetModules = path.join(workDir, 'node_modules');

  console.log(`[Worker] Checking for modules at: ${centralModules}`);
  try {
    await fs.access(centralModules);
    console.log(`[Worker] Found central modules.`);
    await fs.symlink(centralModules, targetModules);
  } catch (e) {
    const templateModules = path.join(templateDir, 'node_modules');
    const rootModules = '/app/node_modules';
    
    console.log(`[Worker] Central modules not found. Checking template: ${templateModules}`);
    try {
      await fs.access(templateModules);
      console.log(`[Worker] Found template modules.`);
      await fs.symlink(templateModules, targetModules);
    } catch (err) {
      console.log(`[Worker] Template modules not found. Checking root: ${rootModules}`);
      try {
        await fs.access(rootModules);
        console.log(`[Worker] Found root modules.`);
        await fs.symlink(rootModules, targetModules);
      } catch (err2) {
        console.error(`[Worker] CRITICAL: No node_modules found anywhere!`);
        throw new Error('Missing node_modules');
      }
    }
  }
  
  return workDir;
}

async function copyRecursive(src, dest) {
  try {
    const stats = await fs.stat(src);
    if (stats.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      const entries = await fs.readdir(src);
      for (const entry of entries) {
        if (entry === 'node_modules') continue;
        await copyRecursive(path.join(src, entry), path.join(dest, entry));
      }
    } else {
      await fs.copyFile(src, dest);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

async function main() {
  const workDir = WORKSPACE;

  const fsSync = require('fs');
  const cleanup = () => {
    // Only cleanup if not in GKE (where volume is ephemeral)
    if (!process.env.RUNTIME) {
      try {
        if (fsSync.existsSync(workDir)) {
          fsSync.rmSync(workDir, { recursive: true, force: true });
        }
      } catch (e) {}
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  await prepareWorkspace(workDir);
  const app = express();
  
  // Security middleware for internal injection
  const authMiddleware = (req, res, next) => {
    const token = req.headers['x-worker-auth'];
    if (!token || token !== AUTH_TOKEN) {
      console.warn(`[Worker] Unauthorized injection attempt blocked.`);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };

  // ─── Health endpoint ──────────────────────────────────────────────────────────
  app.get('/__health', (req, res) => {
    if (nextReady) {
      res.json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'booting' });
    }
  });

  app.post('/__inject', express.json({ limit: '50mb' }), authMiddleware, async (req, res) => {
    const { files } = req.body;
    if (!files) return res.status(400).json({ error: 'No files provided' });

    try {
      const flatFiles = {};
      let totalSize = 0;

      const flatten = (obj, prefix = '') => {
        for (const [key, value] of Object.entries(obj)) {
          const currentPath = prefix ? path.join(prefix, key) : key;
          
          if (typeof value === 'string') {
            totalSize += Buffer.byteLength(value, 'utf8');
            flatFiles[currentPath] = value;
          } else if (value && typeof value === 'object') {
            if (value.file && typeof value.file.contents === 'string') {
              const content = value.file.contents;
              totalSize += Buffer.byteLength(content, 'utf8');
              flatFiles[currentPath] = content;
            } else if (value.directory) {
              flatten(value.directory, currentPath);
            } else if (typeof value.contents === 'string') {
              const content = value.contents;
              totalSize += Buffer.byteLength(content, 'utf8');
              flatFiles[currentPath] = content;
            } else {
              throw new Error(`Invalid file structure at "${currentPath}"`);
            }
          }
        }
      };
      
      flatten(files);

      if (totalSize > 20 * 1024 * 1024) {
        return res.status(413).json({ error: 'Injected files too large (max 20MB)' });
      }

      for (const [filePath, content] of Object.entries(flatFiles)) {
        const fullPath = path.resolve(workDir, filePath);
        
        if (!fullPath.startsWith(path.resolve(workDir) + path.sep)) {
          throw new Error(`Path traversal attempt blocked: "${filePath}"`);
        }

        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content);
      }

      res.json({ ok: true });
    } catch (e) {
      console.error('Injection error:', e);
      res.status(400).json({ error: e.message });
    }
  });

  app.use('/', createProxyMiddleware({
    target: `http://localhost:${NEXT_PORT}`,
    changeOrigin: true,
    ws: true,
    logLevel: 'silent'
  }));

  const server = app.listen(PORT, () => {
    console.log(`[Worker] Listening on port ${PORT}`);
    console.log(`[Worker] Starting Next.js dev server in ${workDir}...`);
    
    const nextBin = path.join(workDir, 'node_modules', '.bin', 'next');
    const nextProc = spawn(nextBin, ['dev', '-p', NEXT_PORT.toString()], {
      cwd: workDir,
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'development' }
    });

    nextProc.stdout.on('data', (data) => {
      const out = data.toString();
      process.stdout.write(`[Next STDOUT] ${out}`);
      if (out.includes('Ready') || out.includes('ready in')) {
        nextReady = true;
        console.log('[Worker] NEXT_READY_SIGNAL');
      }
    });

    nextProc.stderr.on('data', (data) => {
      process.stderr.write(`[Next STDERR] ${data.toString()}`);
    });

    nextProc.on('exit', (code, signal) => {
      console.log(`[Worker] Next.js process exited with code ${code} and signal ${signal}`);
      process.exit(code !== null ? code : 1);
    });

    nextProc.on('error', (err) => {
      console.error(`[Worker] Failed to start Next.js process:`, err);
      process.exit(1);
    });
  });
}

main().catch(err => {
  console.error('[Worker Fatal Error]', err);
  process.exit(1);
});
