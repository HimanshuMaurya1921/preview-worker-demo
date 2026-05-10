const Redis = require('ioredis');

class SessionManager {
  constructor() {
    // K8s feature: it injects REDIS_PORT as a TCP URL if a service named 'redis' exists.
    // We must parse it or ignore it if it's not a number.
    const rawPort = process.env.REDIS_PORT;
    const port = (rawPort && !rawPort.includes('://')) ? parseInt(rawPort, 10) : 6379;

    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: isNaN(port) ? 6379 : port,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null, // Never give up on Redis
      connectTimeout: 10000,      // 10s timeout
      retryStrategy: (times) => {
        const delay = Math.min(times * 100, 3000);
        return delay;
      }
    });

    this.redis.on('error', (err) => {
      console.error('[Redis Error]', err.message);
    });

    this.redis.on('connect', () => {
      console.log('[Redis] Connected');
    });

    this.ttl = parseInt(process.env.SESSION_TTL_SECONDS || '3600', 10); // 1 hour default
  }

  /**
   * Set session data for both project and worker lookup
   */
  async setSession(projectId, sessionData) {
    const { workerId } = sessionData;
    const dataStr = JSON.stringify(sessionData);

    await this.redis.multi()
      .set(`session:project:${projectId}`, workerId, 'EX', this.ttl)
      .set(`session:worker:${workerId}`, dataStr, 'EX', this.ttl)
      .exec();
    
    console.log(`[Session] Saved session for project ${projectId} (worker: ${workerId})`);
  }

  /**
   * Get session data by project ID
   */
  async getSessionByProject(projectId) {
    const workerId = await this.redis.get(`session:project:${projectId}`);
    if (!workerId) return null;
    return this.getSessionByWorker(workerId);
  }

  /**
   * Get session data by worker ID
   */
  async getSessionByWorker(workerId) {
    const data = await this.redis.get(`session:worker:${workerId}`);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Delete session
   */
  async deleteSession(workerId) {
    const session = await this.getSessionByWorker(workerId);
    if (!session) return;

    await this.redis.multi()
      .del(`session:project:${session.projectId}`)
      .del(`session:worker:${workerId}`)
      .exec();
    
    console.log(`[Session] Deleted session for project ${session.projectId} (worker: ${workerId})`);
  }

  /**
   * List all active sessions (expensive, use with care)
   */
  async listSessions() {
    const keys = await this.redis.keys('session:worker:*');
    if (keys.length === 0) return [];
    
    const pipe = this.redis.pipeline();
    keys.forEach(key => pipe.get(key));
    const results = await pipe.exec();
    
    return results.map(([err, val]) => JSON.parse(val)).filter(Boolean);
  }

  /**
   * Reconcile Redis with what's actually running (GKE or Local)
   * This clears stale Redis keys that don't have corresponding pods/containers
   */
  async reconcile(activeWorkerIds) {
    const keys = await this.redis.keys('session:worker:*');
    const activeSet = new Set(activeWorkerIds);

    for (const key of keys) {
      const workerId = key.replace('session:worker:', '');
      if (!activeSet.has(workerId)) {
        console.log(`[Session] Cleaning up stale Redis session: ${workerId}`);
        await this.deleteSession(workerId);
      }
    }
  }
}

module.exports = new SessionManager();
