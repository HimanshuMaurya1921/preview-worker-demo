const { spawn } = require('child_process');
const path = require('path');

class WorkerPool {
  constructor() {
    this.minWorkers = parseInt(process.env.POOL_MIN || '3', 10);
    this.maxWorkers = parseInt(process.env.POOL_MAX || '10', 10);
    this.portBase = parseInt(process.env.PORT_BASE || '4000', 10);
    this.ttlMs = parseInt(process.env.SESSION_TTL_MS || '300000', 10);

    this.workers = new Map();
    this.warmQueue = [];

    // Create a pool of 500 reusable ports to prevent exceeding the port limit
    this.availablePorts = [];
    for (let i = 0; i < 500; i++) {
      this.availablePorts.push(this.portBase + i);
    }
  }

  async init() {
    console.log(`[WorkerPool] Initializing with ${this.minWorkers} warm workers...`);
    for (let i = 0; i < this.minWorkers; i++) {
      await this.spawnWorker();
    }
    console.log(`[WorkerPool] Ready. ${this.warmQueue.length} workers warm.`);
  }

  getAvailablePort() {
    if (this.availablePorts.length === 0) {
      throw new Error("No available ports");
    }
    // Take from the front
    return this.availablePorts.shift();
  }

  releasePort(port) {
    // Put it back at the end so we cycle through ports
    if (!this.availablePorts.includes(port)) {
      this.availablePorts.push(port);
    }
  }

  async spawnWorker() {
    const workerId = `w-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const port = this.getAvailablePort();

    console.log(`[${workerId}] Preparing Next.js on port ${port}...`);

    const worker = {
      id: workerId,
      port,
      status: 'booting',
      process: null,
      lastActive: Date.now()
    };

    this.workers.set(workerId, worker);

    const workerScript = path.join(__dirname, '../preview-worker/worker.js');
    const child = spawn('node', [workerScript, workerId, port], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    worker.process = child;

    return new Promise((resolve) => {
      child.stdout.on('data', (data) => {
        const out = data.toString();
        if (process.env.DEBUG_WORKERS) {
          console.log(`[${workerId} stdout]`, out);
        }
        if (out.includes('READY_SIGNAL')) {
          worker.status = 'warm';
          this.warmQueue.push(workerId);
          console.log(`[${workerId}] Next.js ready on port ${port}`);
          resolve(workerId);
        }
      });

      child.stderr.on('data', (data) => {
        if (process.env.DEBUG_WORKERS) {
          console.error(`[${workerId} stderr]`, data.toString());
        }
      });

      child.on('exit', (code) => {
        console.log(`[${workerId}] Exited with code ${code}`);
        this.workers.delete(workerId);
        this.releasePort(port);

        this.warmQueue = this.warmQueue.filter(id => id !== workerId);
        if (this.warmQueue.length < this.minWorkers) {
          // Add a 1 second delay before respawning to prevent tight infinite loops
          setTimeout(() => this.spawnWorker(), 1000);
        }
      });
    });
  }

  async acquireWorker() {
    if (this.warmQueue.length > 0) {
      const workerId = this.warmQueue.shift();
      const worker = this.workers.get(workerId);
      worker.status = 'busy';
      worker.lastActive = Date.now();

      this.spawnWorker(); // Replenish
      return worker;
    }

    if (this.workers.size < this.maxWorkers) {
      const workerId = await this.spawnWorker();
      this.warmQueue = this.warmQueue.filter(id => id !== workerId);
      const worker = this.workers.get(workerId);
      worker.status = 'busy';
      worker.lastActive = Date.now();
      return worker;
    }

    throw new Error('Worker pool at capacity');
  }

  async releaseWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    console.log(`[${workerId}] Releasing worker...`);

    worker.process.kill();
    this.workers.delete(workerId);
    this.releasePort(worker.port);
    this.warmQueue = this.warmQueue.filter(id => id !== workerId);

    if (this.warmQueue.length < this.minWorkers) {
      setTimeout(() => this.spawnWorker(), 1000);
    }
  }

  getWorker(workerId) {
    return this.workers.get(workerId);
  }

  getStats() {
    let warm = 0, busy = 0;
    for (const [_, w] of this.workers) {
      if (w.status === 'warm') warm++;
      if (w.status === 'busy') busy++;
    }
    return { total: this.workers.size, warm, busy };
  }

  touchWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (worker) worker.lastActive = Date.now();
  }

  shutdown() {
    console.log('[WorkerPool] Shutting down all workers...');
    for (const [id, worker] of this.workers) {
      try {
        worker.process.kill('SIGKILL');
      } catch (e) {
        // Ignore errors during shutdown
      }
    }
  }
}

const pool = new WorkerPool();
setInterval(() => {
  const now = Date.now();
  for (const [id, w] of pool.workers) {
    if (w.status === 'busy' && now - w.lastActive > pool.ttlMs) {
      console.log(`[${id}] Session TTL expired, releasing.`);
      pool.releaseWorker(id);
    }
  }
}, 30000);

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
  pool.shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  pool.shutdown();
  process.exit(0);
});

module.exports = pool;
