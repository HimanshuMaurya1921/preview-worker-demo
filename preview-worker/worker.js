const express = require('express');
const { spawn, exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const { createProxyMiddleware } = require('http-proxy-middleware');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = 3000;
const NEXT_PORT = 3001;
const WORKSPACE = process.env.WORKSPACE || path.join(os.tmpdir(), `ai-studio-worker`);
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'local-dev-token';
const VERSION = "1.0.2"; 

// ─── State ────────────────────────────────────────────────────────────────────
let nextReady = false;
let nextProc;

// ─── Next.js Process Management ───────────────────────────────────────────────
function startNextServer(workDir) {
  const nextBin = path.join(workDir, 'node_modules', '.bin', 'next');
  if (!fsSync.existsSync(nextBin)) {
    console.error(`[Worker] Next.js binary NOT FOUND at ${nextBin}`);
    return;
  }

  console.log(`[Worker] Starting Next.js dev server in ${workDir}...`);
  nextProc = spawn(nextBin, ['dev', '-p', NEXT_PORT.toString()], {
    cwd: workDir,
    env: { 
      ...process.env, 
      NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1'
    }
  });

  nextProc.stdout.on('data', (data) => {
    const out = data.toString();
    process.stdout.write(`[Next STDOUT] ${out}`);
    if (out.includes('Ready') || out.includes('ready in')) {
      nextReady = true;
      console.log(`[Worker] NEXT_READY_SIGNAL`);
    }
  });

  nextProc.stderr.on('data', (data) => {
    process.stderr.write(`[Next STDERR] ${data.toString()}`);
  });

  nextProc.on('close', (code) => {
    console.log(`[Worker] Next.js process exited with code ${code}`);
    nextReady = false;
  });
}

async function stopNextServer() {
  if (nextProc) {
    console.log(`[Worker v${VERSION}] Stopping Next.js dev server and cleaning up processes...`);
    nextProc.kill('SIGKILL');
    nextProc = null;
    nextReady = false;
  }
  
  // Forcefully kill any zombie Next.js processes on the port
  try {
    await execAsync(`pkill -9 -f next || true`);
    // Small delay to allow OS to release the socket
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (e) {}
}

// Memory Logger Utility
const logMemory = (tag) => {
  const mem = process.memoryUsage();
  const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(2) + 'MB';
  console.log(`[Memory][${tag}] RSS: ${toMB(mem.rss)} | HeapUsed: ${toMB(mem.heapUsed)} | HeapTotal: ${toMB(mem.heapTotal)} | External: ${toMB(mem.external)}`);
};

async function prepareWorkspace(workDir) {
  // Periodic Memory Monitor (every 60s)
  setInterval(() => logMemory('PERIODIC'), 60000);

  const start = Date.now();
  console.log(`[Worker] Preparing workspace in ${workDir}...`);
  await fs.mkdir(workDir, { recursive: true });

  const templateDir = path.join(__dirname, 'template');
  
  // High-performance shell-based copy
  console.log(`[Worker] Copying template files...`);
  await execAsync(`cp -rn "${templateDir}/." "${workDir}/"`);
  console.log(`[Worker] Template copy took ${Date.now() - start}ms`);

  const centralModules = '/app/central_modules/node_modules';
  const targetModules = path.join(workDir, 'node_modules');
  
  // Clean up existing symlink/folder if it exists to avoid EEXIST
  try {
    await fs.rm(targetModules, { recursive: true, force: true });
  } catch (e) {}

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
  process.on('SIGINT', () => {
    console.log('[Worker] SIGINT received. Cleaning up...');
    if (nextProc) nextProc.kill('SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    console.log('[Worker] SIGTERM received. Cleaning up...');
    if (nextProc) nextProc.kill('SIGTERM');
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    console.error('[Worker Uncaught Exception]', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Worker Unhandled Rejection]', reason);
    process.exit(1);
  });

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
    res.json({ 
      status: nextReady ? 'ready' : 'booting',
      ready: nextReady,
      podName: process.env.POD_NAME || 'local-worker'
    });
  });

  app.post('/__inject', express.json({ limit: '50mb' }), authMiddleware, async (req, res) => {
    const { files, wipe } = req.body;
    if (!files) return res.status(400).json({ error: 'No files provided' });

    try {
      // 1. Optional Wipe (for clean project swaps)
      if (wipe) {
        console.log(`[Worker v${VERSION}] Project swap detected. Stopping server and wiping workspace...`);
        await stopNextServer();
        
        const entries = await fs.readdir(workDir);
        for (const entry of entries) {
          if (entry === 'node_modules') continue;
          await fs.rm(path.join(workDir, entry), { recursive: true, force: true });
        }
        if (global.gc) {
          logMemory('BEFORE_GC');
          global.gc();
          logMemory('AFTER_GC');
        }
      }

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

      // ─── Proper React Badge Injection ───
      const podName = process.env.POD_NAME || 'local-worker';
      
      // 1. Create the Badge Component
      const badgeContent = `'use client';
import { useEffect } from 'react';

export default function PreviewBadge() {
  useEffect(() => {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '12px',
      left: '12px',
      padding: '4px 10px',
      background: 'rgba(15, 23, 42, 0.9)',
      backdropFilter: 'blur(8px)',
      color: '#94a3b8',
      fontSize: '11px',
      fontFamily: 'monospace',
      borderRadius: '6px',
      border: '1px solid rgba(148, 163, 184, 0.2)',
      zIndex: '999999',
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
    });
    el.innerHTML = \`<span style="width: 6px; height: 6px; background: #22c55e; border-radius: 50%;"></span> ${podName}\`;
    document.body.appendChild(el);
    return () => el.remove();
  }, []);
  return null;
}
`;
      flatFiles['app/PreviewBadge.js'] = badgeContent;

      // 2. Inject into layout.js if it exists
      if (flatFiles['app/layout.js']) {
        const layout = flatFiles['app/layout.js'];
        if (!layout.includes('PreviewBadge')) {
          const imported = "import PreviewBadge from './PreviewBadge';\n" + layout;
          flatFiles['app/layout.js'] = imported.replace('{children}', '{children}<PreviewBadge />');
        }
      }

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

      console.log(`[Worker v${VERSION}] Injected ${Object.keys(flatFiles).length} files (${(totalSize / 1024).toFixed(2)}KB)`);
      logMemory('POST_INJECTION');

      // 4. If we wiped, we need to restart the server
      if (wipe) {
        startNextServer(workDir);
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
    console.log(`[Worker v${VERSION}] Listening on port ${PORT}`);
    startNextServer(WORKSPACE);
  });

  console.log(`[Worker v${VERSION}] Startup complete. Waiting for requests...`);
  // Keep-alive promise to ensure main never resolves
  return new Promise(() => {});
}

main().catch(err => {
  console.error('[Worker Fatal Error]', err);
  process.exit(1);
});
