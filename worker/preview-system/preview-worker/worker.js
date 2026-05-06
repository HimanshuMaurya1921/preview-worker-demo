const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { createProxyMiddleware } = require('http-proxy-middleware');

const workerId = process.argv[2];
const port = parseInt(process.argv[3], 10);

if (!workerId || !port) {
  console.error('Usage: node worker.js <workerId> <port>');
  process.exit(1);
}

// Configurable port offset for Next.js internal server
const NEXT_PORT_OFFSET = parseInt(process.env.NEXT_PORT_OFFSET || '10000', 10);

// Validate port boundary before assignment
if (port + NEXT_PORT_OFFSET > 65535) {
  console.error(`[Worker ${workerId}] Port overflow: port ${port} + offset ${NEXT_PORT_OFFSET} exceeds 65535`);
  process.exit(1);
}

const nextPort = port + NEXT_PORT_OFFSET;

async function prepareWorkspace(workDir) {
  await fs.mkdir(workDir, { recursive: true });

  const templateDir = path.join(__dirname, 'template');
  await copyRecursive(templateDir, workDir);

  const snapshotPath = path.join(__dirname, 'node_modules-snapshot.tar.gz');
  try {
    await fs.access(snapshotPath);
    await execCommand(`tar -xzf ${snapshotPath} -C ${workDir}`);
  } catch (e) {
    console.error(`[Worker ${workerId}] Snapshot extraction failed:`, e.message);
    throw e;
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

function execCommand(command) {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    exec(command, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function main() {
  const workDir = path.join(os.tmpdir(), `ai-studio-${workerId}`);

  const fsSync = require('fs');
  const cleanup = () => {
    try {
      if (fsSync.existsSync(workDir)) {
        fsSync.rmSync(workDir, { recursive: true, force: true });
      }
    } catch (e) {}
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  await prepareWorkspace(workDir);
  const app = express();
  
  // Security middleware for internal injection
  const authMiddleware = (req, res, next) => {
    const token = req.headers['x-worker-auth'];
    if (!token || token !== process.env.AUTH_TOKEN) {
      console.warn(`[Worker ${workerId}] Unauthorized injection attempt blocked.`);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };

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
              // Instead of silent JSON.stringify, throw an error for malformed objects
              throw new Error(`Invalid file structure at "${currentPath}": Expected string content or directory object.`);
            }
          } else {
             throw new Error(`Invalid file type at "${currentPath}": Expected string or object.`);
          }
        }
      };
      
      flatten(files);

      // Enforce 20MB limit on injected code to protect RAM
      if (totalSize > 20 * 1024 * 1024) {
        return res.status(413).json({ error: 'Injected files too large (max 20MB)' });
      }

      for (const [filePath, content] of Object.entries(flatFiles)) {
        const fullPath = path.resolve(workDir, filePath);
        
        // Security check: ensure the file stays within the workspace
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
    target: `http://localhost:${nextPort}`,
    changeOrigin: true,
    ws: true,
    logLevel: 'silent'
  }));

  const server = app.listen(port, () => {
    const nextProc = spawn('npm', ['run', 'dev', '--', '-p', nextPort.toString()], {
      cwd: workDir,
      stdio: 'pipe'
    });

    nextProc.stdout.on('data', (data) => {
      const out = data.toString();
      if (out.includes('Ready') || out.includes('ready in')) {
        console.log('READY_SIGNAL');
      }
    });

    nextProc.stderr.on('data', (data) => console.error(`[Next.js Error] ${data.toString()}`));

    nextProc.on('exit', (code) => {
      process.exit(code !== null ? code : 1);
    });

    nextProc.on('error', (err) => {
      console.error(`[Next.js Spawn Error]`, err);
      process.exit(1);
    });
  });
}

main().catch(err => {
  console.error('[Worker Fatal Error]', err);
  process.exit(1);
});
