const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const WORKER_IMAGE = process.env.WORKER_IMAGE || 'preview-worker:local';
const AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN || 'local-dev-token';
const BOOT_TIMEOUT_MS = 90000;

// ─── Start a Docker container for one session ─────────────────────────────────
async function createLocalWorker(sessionId) {
  const containerName = `preview-${sessionId}`;

  // Pick a free port between 4000-4099
  const port = await findFreePort(4000, 4099);

  await execAsync([
    'docker run -d',
    `--name ${containerName}`,
    `-p ${port}:3000`,
    `-e AUTH_TOKEN=${AUTH_TOKEN}`,
    `-e NODE_OPTIONS="--max-old-space-size=450"`,
    `--memory=600m`,
    `--cpus=1`,
    WORKER_IMAGE
  ].join(' '));

  console.log(`[Local] Started container ${containerName} on port ${port}`);
  return { containerName, port };
}

// ─── Wait for the worker to be ready ──────────────────────────────────────────
async function waitForWorkerReady(port) {
  const start = Date.now();

  while (Date.now() - start < BOOT_TIMEOUT_MS) {
    try {
      const res = await fetch(`http://localhost:${port}/__health`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ready') return true;
      }
    } catch {
      // Container still booting
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  throw new Error(`Worker on port ${port} did not become ready in time`);
}

// ─── Stop and remove a container ─────────────────────────────────────────────
async function deleteLocalWorker(containerName) {
  try {
    await execAsync(`docker rm -f ${containerName}`);
    console.log(`[Local] Removed container ${containerName}`);
  } catch (err) {
    // Already gone
  }
}

// ─── Find a free port in a range ─────────────────────────────────────────────
async function findFreePort(start, end) {
  for (let port = start; port <= end; port++) {
    try {
      await execAsync(`docker ps --format "{{.Ports}}" | grep -q ":${port}->"`);
    } catch {
      // grep failed = port not in use
      return port;
    }
  }
  throw new Error('No free ports available in range 4000-4099');
}

// ─── Check if a container is actually running ───────────────────────────
async function isWorkerRunning(containerName) {
  try {
    const { stdout } = await execAsync(
      `docker inspect --format='{{.State.Running}}' ${containerName} 2>/dev/null`
    );
    return stdout.trim() === 'true';
  } catch (err) {
    return false;
  }
}

// ─── List all active container names ─────────────────────────────────────────
async function listActiveWorkerIds() {
  try {
    const { stdout } = await execAsync('docker ps --filter "name=preview-" --format "{{.Names}}"');
    return stdout.trim().split('\n').filter(Boolean);
  } catch (err) {
    console.error('[Local] Failed to list containers:', err.message);
    throw err;
  }
}

module.exports = {
  createLocalWorker,
  waitForWorkerReady,
  deleteLocalWorker,
  isWorkerRunning,
  listActiveWorkerIds
};
