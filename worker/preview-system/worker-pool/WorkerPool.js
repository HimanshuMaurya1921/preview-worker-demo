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
    this.availablePorts = [];
    this.usedPorts = new Set();
    this.evictionTimer = null;

    // Mutex for acquireWorker to prevent race conditions
    this._acquireLock = Promise.resolve();

    // Create a pool of reusable ports
    for (let i = 0; i < 500; i++) {
      this.availablePorts.push(this.portBase + i);
    }
  }

  async init() {
    console.log(`[WorkerPool] Initializing with ${this.minWorkers} warm workers...`);
    for (let i = 0; i < this.minWorkers; i++) {
      try {
        await this.spawnWorker();
      } catch (err) {
        console.error(`[WorkerPool] Initial spawn failed:`, err.message);
      }
    }
    console.log(`[WorkerPool] Ready. ${this.warmQueue.length} workers warm.`);
  }

  startEvictionTimer() {
    if (this.evictionTimer) return;
    this.evictionTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, w] of this.workers) {
        if (w.status === 'busy' && now - w.lastActive > this.ttlMs) {
          console.log(`[${id}] Session TTL expired, releasing.`);
          this.releaseWorker(id).catch(() => {});
        }
      }
    }, 30000);
  }

  getAvailablePort() {
    if (this.availablePorts.length === 0) {
      throw new Error("No available ports");
    }
    const port = this.availablePorts.shift();
    this.usedPorts.add(port);
    return port;
  }

  releasePort(port) {
    this.usedPorts.delete(port);
    if (!this.availablePorts.includes(port)) {
      this.availablePorts.push(port);
    }
  }

  async spawnWorker() {
    if (this.workers.size >= this.maxWorkers) {
       throw new Error('Worker pool at maximum capacity');
    }

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
    const child = spawn('node', [workerScript, workerId, port.toString()], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, AUTH_TOKEN: process.env.WORKER_AUTH_TOKEN }
    });

    worker.process = child;

    const bootTimeout = 30000; // 30 seconds

    return Promise.race([
      new Promise((resolve, reject) => {
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
          this.checkReplenish();
          reject(new Error(`Worker ${workerId} exited with code ${code} during boot`));
        });

        child.on('error', (err) => {
          console.error(`[${workerId}] Spawn error:`, err);
          reject(err);
        });
      }),
      new Promise((_, reject) => {
        setTimeout(() => {
          if (worker.status === 'booting') {
            console.error(`[${workerId}] Boot timeout after ${bootTimeout}ms. Killing.`);
            child.kill('SIGKILL');
            reject(new Error(`Worker ${workerId} boot timeout`));
          }
        }, bootTimeout);
      })
    ]).catch(err => {
      // Clean up if we rejected (timeout or error)
      this.workers.delete(workerId);
      this.releasePort(port);
      this.warmQueue = this.warmQueue.filter(id => id !== workerId);
      throw err;
    });
  }

  checkReplenish() {
    let warmAndBooting = 0;
    for (const [_, w] of this.workers) {
      if (w.status === 'warm' || w.status === 'booting') warmAndBooting++;
    }

    if (warmAndBooting < this.minWorkers && this.workers.size < this.maxWorkers) {
      setTimeout(() => {
        let currentWarmAndBooting = 0;
        for (const [_, w] of this.workers) {
          if (w.status === 'warm' || w.status === 'booting') currentWarmAndBooting++;
        }
        if (currentWarmAndBooting < this.minWorkers && this.workers.size < this.maxWorkers) {
          this.spawnWorker().catch(err => console.error('[WorkerPool] Replenish failed:', err.message));
        }
      }, 1500);
    }
  }

  async acquireWorker() {
    // Simple mutex to prevent concurrent acquireWorker races
    let resolveLock;
    const lockPromise = new Promise(r => resolveLock = r);
    const previousLock = this._acquireLock;
    this._acquireLock = lockPromise;

    try {
      await previousLock;

      if (this.warmQueue.length > 0) {
        const workerId = this.warmQueue.shift();
        const worker = this.workers.get(workerId);
        worker.status = 'busy';
        worker.lastActive = Date.now();

        this.checkReplenish();
        return worker;
      }

      if (this.workers.size < this.maxWorkers) {
        const workerId = await this.spawnWorker();
        // The worker was added to warmQueue by spawnWorker, but since we are acquiring it,
        // we must remove it from warmQueue immediately.
        this.warmQueue = this.warmQueue.filter(id => id !== workerId);
        const worker = this.workers.get(workerId);
        worker.status = 'busy';
        worker.lastActive = Date.now();
        return worker;
      }

      throw new Error('Worker pool at capacity');
    } finally {
      resolveLock();
    }
  }

  async releaseWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    console.log(`[${workerId}] Releasing worker...`);

    return new Promise((resolve) => {
      const cleanup = () => {
        this.workers.delete(workerId);
        this.releasePort(worker.port);
        this.warmQueue = this.warmQueue.filter(id => id !== workerId);
        resolve();
      };

      if (worker.process.killed || worker.process.exitCode !== null) {
        cleanup();
      } else {
        worker.process.once('exit', cleanup);
        worker.process.kill();
      }
    });
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
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    for (const [id, worker] of this.workers) {
      try {
        worker.process.kill('SIGKILL');
      } catch (e) {
        // Ignore errors during shutdown
      }
    }
  }
}

module.exports = WorkerPool;
