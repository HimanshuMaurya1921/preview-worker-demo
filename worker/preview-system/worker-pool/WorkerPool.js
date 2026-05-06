const { spawn, exec } = require('child_process');
const path = require('path');
const util = require('util');
const execAsync = util.promisify(exec);

// Explicit Worker States
const STATES = {
  BOOTING: 'booting',
  WARM: 'warm',
  BUSY: 'busy',
  DRAINING: 'draining',
  DEAD: 'dead'
};

class WorkerPool {
  constructor() {
    this.minWorkers = parseInt(process.env.POOL_MIN || '3', 10);
    this.maxWorkers = parseInt(process.env.POOL_MAX || '10', 10);
    this.portBase = parseInt(process.env.PORT_BASE || '4000', 10);
    this.ttlMs = parseInt(process.env.SESSION_TTL_MS || '300000', 10);

    // Queue & Resource Configs
    this.queueMax = parseInt(process.env.QUEUE_MAX || '20', 10);
    this.queueTimeoutMs = parseInt(process.env.QUEUE_TIMEOUT_MS || '300000', 10);
    this.bootTimeoutMs = parseInt(process.env.BOOT_TIMEOUT_MS || '45000', 10);
    this.memLimitMb = parseInt(process.env.WORKER_MEM_LIMIT_MB || '600', 10);

    this.workers = new Map();
    this.warmQueue = [];
    this.requestQueue = []; // { resolve, reject, timestamp, projectId, timeoutId }
    
    this.availablePorts = [];
    this.usedPorts = new Set();
    this.evictionTimer = null;
    this.watchdogTimer = null;

    // Mutex for atomic pool operations
    this._poolLock = Promise.resolve();

    // Stats for observability
    this.stats = {
      backpressureEvents: 0,
      totalWaitTime: 0,
      completedRequests: 0,
      oomKills: 0
    };

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
    
    // Start maintenance timers
    this.startEvictionTimer();
    this.startWatchdog();
  }

  startEvictionTimer() {
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    this.evictionTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, w] of this.workers) {
        if (w.status === STATES.BUSY && now - w.lastActive > this.ttlMs) {
          console.log(`[${id}] Session TTL expired, releasing.`);
          this.releaseWorker(id).catch(() => {});
        }
      }
    }, 30000);
  }

  /**
   * Memory Watchdog: Periodically checks RSS of workers and kills runaway processes
   */
  startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(async () => {
      for (const [id, worker] of this.workers) {
        if (worker.status === STATES.BUSY || worker.status === STATES.BOOTING) {
          try {
            const memUsageMb = await this._getWorkerMemory(worker.process.pid);
            if (memUsageMb > this.memLimitMb) {
              console.warn(`[${id}] OOM Watchdog: Runaway memory detected (${memUsageMb}MB > ${this.memLimitMb}MB). Killing.`);
              this.stats.oomKills++;
              this.killWorker(id).catch(() => {});
            }
          } catch (e) {
            // Process might have exited already
          }
        }
      }
    }, 15000); // Check every 15 seconds
  }

  async _getWorkerMemory(pid) {
    try {
      // Sum Resident Set Size (RSS) for the process and all its children
      // ps -o rss= -p <pid> --ppid <pid> returns RSS in KB
      const { stdout } = await execAsync(`ps -o rss= -p ${pid} --ppid ${pid}`);
      const lines = stdout.trim().split('\n');
      const totalKb = lines.reduce((sum, line) => sum + parseInt(line.trim() || '0', 10), 0);
      return Math.round(totalKb / 1024);
    } catch (e) {
      return 0;
    }
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

  async _processQueue() {
    if (this.requestQueue.length === 0) return;
    if (this.warmQueue.length === 0) return;

    const workerId = this.warmQueue.shift();
    const worker = this.workers.get(workerId);
    
    if (!worker || worker.status !== STATES.WARM) {
      return this._processQueue();
    }

    const request = this.requestQueue.shift();
    clearTimeout(request.timeoutId);

    const waitTime = Date.now() - request.timestamp;
    this.stats.totalWaitTime += waitTime;
    this.stats.completedRequests++;

    console.log(`[WorkerPool] Handoff worker ${workerId} to queued request for project ${request.projectId} (waited ${waitTime}ms)`);
    
    worker.status = STATES.BUSY;
    worker.lastActive = Date.now();
    
    request.resolve(worker);
    this.checkReplenish();
  }

  async spawnWorker() {
    if (this.workers.size >= this.maxWorkers) {
       throw new Error('Worker pool at maximum capacity');
    }

    const workerId = `w-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const port = this.getAvailablePort();

    console.log(`[${workerId}] Spawning worker on port ${port}...`);

    const worker = {
      id: workerId,
      port,
      status: STATES.BOOTING,
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

    return Promise.race([
      new Promise((resolve, reject) => {
        child.stdout.on('data', (data) => {
          const out = data.toString();
          if (out.includes('READY_SIGNAL')) {
            worker.status = STATES.WARM;
            this.warmQueue.push(workerId);
            console.log(`[${workerId}] Ready on port ${port}`);
            this._processQueue();
            resolve(workerId);
          }
        });

        child.on('exit', (code) => {
          if (worker.status !== STATES.DEAD) {
            console.log(`[${workerId}] Exited unexpectedly with code ${code}`);
            this.workers.delete(workerId);
            this.releasePort(port);
            this.warmQueue = this.warmQueue.filter(id => id !== workerId);
            worker.status = STATES.DEAD;
            this.checkReplenish();
            reject(new Error(`Worker ${workerId} exited with code ${code} during boot`));
          }
        });

        child.on('error', (err) => {
          console.error(`[${workerId}] Spawn error:`, err);
          reject(err);
        });
      }),
      new Promise((_, reject) => {
        setTimeout(() => {
          if (worker.status === STATES.BOOTING) {
            console.error(`[${workerId}] Boot timeout after ${this.bootTimeoutMs}ms. Killing.`);
            child.kill('SIGKILL');
            reject(new Error(`Worker ${workerId} boot timeout`));
          }
        }, this.bootTimeoutMs);
      })
    ]).catch(err => {
      this.workers.delete(workerId);
      this.releasePort(port);
      this.warmQueue = this.warmQueue.filter(id => id !== workerId);
      worker.status = STATES.DEAD;
      throw err;
    });
  }

  checkReplenish() {
    let warmAndBooting = 0;
    for (const [_, w] of this.workers) {
      if (w.status === STATES.WARM || w.status === STATES.BOOTING) warmAndBooting++;
    }

    if (warmAndBooting < this.minWorkers && this.workers.size < this.maxWorkers) {
      setTimeout(() => {
        let currentWarmAndBooting = 0;
        for (const [_, w] of this.workers) {
          if (w.status === STATES.WARM || w.status === STATES.BOOTING) currentWarmAndBooting++;
        }
        if (currentWarmAndBooting < this.minWorkers && this.workers.size < this.maxWorkers) {
          this.spawnWorker().catch(err => console.error('[WorkerPool] Replenish failed:', err.message));
        }
      }, 1500);
    }
  }

  async acquireWorker(projectId) {
    let resolveLock;
    const lockPromise = new Promise(r => resolveLock = r);
    const previousLock = this._poolLock;
    this._poolLock = lockPromise;

    try {
      await previousLock;

      if (this.warmQueue.length > 0) {
        const workerId = this.warmQueue.shift();
        const worker = this.workers.get(workerId);
        worker.status = STATES.BUSY;
        worker.lastActive = Date.now();
        this.checkReplenish();
        return worker;
      }

      if (this.workers.size < this.maxWorkers) {
        console.log(`[WorkerPool] No warm workers. Spawning for project ${projectId}...`);
        this.spawnWorker().catch(err => console.error('[WorkerPool] Auto-spawn failed:', err.message));
      }

      if (this.requestQueue.length < this.queueMax) {
        console.log(`[WorkerPool] Queuing request for project ${projectId}. Queue length: ${this.requestQueue.length + 1}`);
        
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            const index = this.requestQueue.findIndex(r => r.timeoutId === timeoutId);
            if (index !== -1) {
              this.requestQueue.splice(index, 1);
              reject(new Error('Worker request timed out in queue'));
            }
          }, this.queueTimeoutMs);

          this.requestQueue.push({
            resolve,
            reject,
            timestamp: Date.now(),
            projectId,
            timeoutId
          });
        });
      }

      this.stats.backpressureEvents++;
      throw new Error('Worker pool at maximum capacity (Queue full)');
    } finally {
      resolveLock();
    }
  }

  async cancelRequest(projectId) {
    let resolveLock;
    const lockPromise = new Promise(r => resolveLock = r);
    const previousLock = this._poolLock;
    this._poolLock = lockPromise;

    try {
      await previousLock;
      const index = this.requestQueue.findIndex(r => r.projectId === projectId);
      if (index !== -1) {
        console.log(`[WorkerPool] Cancelling queued request for project ${projectId}`);
        const request = this.requestQueue.splice(index, 1)[0];
        clearTimeout(request.timeoutId);
        request.reject(new Error('Request cancelled by client'));
      }
    } finally {
      resolveLock();
    }
  }

  async releaseWorker(workerId) {
    let resolveLock;
    const lockPromise = new Promise(r => resolveLock = r);
    const previousLock = this._poolLock;
    this._poolLock = lockPromise;

    try {
      await previousLock;
      const worker = this.workers.get(workerId);
      if (!worker) return;

      if (this.requestQueue.length > 0) {
        const request = this.requestQueue.shift();
        clearTimeout(request.timeoutId);
        
        const waitTime = Date.now() - request.timestamp;
        this.stats.totalWaitTime += waitTime;
        this.stats.completedRequests++;

        console.log(`[WorkerPool] Direct handoff of ${workerId} to queued project ${request.projectId} (waited ${waitTime}ms)`);
        worker.lastActive = Date.now();
        request.resolve(worker);
        return;
      }

      console.log(`[${workerId}] Releasing worker to warm pool...`);
      worker.status = STATES.WARM;
      this.warmQueue.push(workerId);
      this.checkReplenish();
    } finally {
      resolveLock();
    }
  }

  async killWorker(workerId) {
    let resolveLock;
    const lockPromise = new Promise(r => resolveLock = r);
    const previousLock = this._poolLock;
    this._poolLock = lockPromise;

    try {
      await previousLock;
      const worker = this.workers.get(workerId);
      if (!worker) return;

      worker.status = STATES.DRAINING;
      console.log(`[${workerId}] Killing worker...`);

      return new Promise((resolve) => {
        const cleanup = () => {
          this.workers.delete(workerId);
          this.releasePort(worker.port);
          this.warmQueue = this.warmQueue.filter(id => id !== workerId);
          worker.status = STATES.DEAD;
          resolve();
        };

        if (worker.process.killed || worker.process.exitCode !== null) {
          cleanup();
        } else {
          worker.process.once('exit', cleanup);
          worker.process.kill('SIGKILL'); // Force kill
        }
      });
    } finally {
      resolveLock();
    }
  }

  getWorker(workerId) {
    return this.workers.get(workerId);
  }

  getStats() {
    let warm = 0, busy = 0, booting = 0;
    for (const [_, w] of this.workers) {
      if (w.status === STATES.WARM) warm++;
      if (w.status === STATES.BUSY) busy++;
      if (w.status === STATES.BOOTING) booting++;
    }
    
    const avgWait = this.stats.completedRequests > 0 
      ? Math.round(this.stats.totalWaitTime / this.stats.completedRequests) 
      : 0;

    return { 
      total: this.workers.size, 
      warm, 
      busy, 
      booting,
      queueLength: this.requestQueue.length,
      avgWaitTimeMs: avgWait,
      backpressureEvents: this.stats.backpressureEvents,
      oomKills: this.stats.oomKills
    };
  }

  touchWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (worker) worker.lastActive = Date.now();
  }

  shutdown() {
    console.log('[WorkerPool] Shutting down...');
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    for (const [id, worker] of this.workers) {
      try {
        worker.process.kill('SIGKILL');
      } catch (e) {}
    }
  }
}

module.exports = WorkerPool;
