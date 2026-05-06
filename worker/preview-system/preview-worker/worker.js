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

const nextPort = port + 10000; // Next.js internal port

async function prepareWorkspace() {
  const workDir = path.join(os.tmpdir(), `ai-studio-${workerId}`);
  await fs.mkdir(workDir, { recursive: true });

  const templateDir = path.join(__dirname, 'template');
  await copyRecursive(templateDir, workDir);

  const snapshotPath = path.join(__dirname, 'node_modules-snapshot.tar.gz');
  try {
    await fs.access(snapshotPath);
    await execCommand(`tar -xzf ${snapshotPath} -C ${workDir}`);
  } catch (e) {
    // Snapshot might not exist locally yet
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
  const workDir = await prepareWorkspace();
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.post('/__inject', async (req, res) => {
    const { files } = req.body;
    if (!files) return res.status(400).json({ error: 'No files provided' });

    try {
      const flatFiles = {};
      const flatten = (obj, prefix = '') => {
        for (const [key, value] of Object.entries(obj)) {
          const currentPath = prefix ? path.join(prefix, key) : key;
          if (value && typeof value === 'object') {
            if (value.file && value.file.contents !== undefined) {
              flatFiles[currentPath] = value.file.contents;
            } else if (value.directory) {
              flatten(value.directory, currentPath);
            } else if (value.contents !== undefined) {
              flatFiles[currentPath] = value.contents;
            } else {
              flatFiles[currentPath] = JSON.stringify(value);
            }
          } else if (typeof value === 'string') {
            flatFiles[currentPath] = value;
          }
        }
      };
      
      flatten(files);

      for (const [filePath, content] of Object.entries(flatFiles)) {
        const fullPath = path.join(workDir, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content);
      }

      res.json({ ok: true });
    } catch (e) {
      console.error('Injection error:', e);
      res.status(500).json({ error: e.message });
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

  const fsSync = require('fs');
  const cleanup = () => {
    try { fsSync.rmSync(workDir, { recursive: true, force: true }); } catch (e) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

main().catch(console.error);
