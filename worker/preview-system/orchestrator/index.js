const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const crypto = require('crypto');
const sessionManager = require('./sessionManager');

const IS_GKE = process.env.RUNTIME === 'gke';

// Load the right backend
const backend = IS_GKE
  ? require('./k8sClient')
  : require('./localWorker');

module.exports = function() {
  const router = express.Router();
  const AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN;

  // Reconcile sessions on startup
  (async () => {
    try {
      let activeWorkerIds = [];
      if (backend.listActiveWorkerIds) {
        activeWorkerIds = await backend.listActiveWorkerIds();
      }
      await sessionManager.reconcile(activeWorkerIds);
    } catch (err) {
      console.error('[Orchestrator] Reconciliation failed:', err.message);
    }
  })();

  router.post('/start', async (req, res) => {
    const { projectId, userId, files } = req.body;
    const sessionKey = userId || projectId;
    
    if (!sessionKey) return res.status(400).json({ error: 'Missing userId or projectId' });
    if (!files) return res.status(400).json({ error: 'files required' });

    // ─── Warm Update Logic ───
    const existing = await sessionManager.getSessionByProject(sessionKey);
    if (existing) {
      console.log(`[Orchestrator] Existing session found for ${sessionKey}. Verifying health...`);
      try {
        const isRunning = await backend.isWorkerRunning(existing.workerId);
        if (!isRunning) throw new Error('Worker not running');

        const injectStart = Date.now();
        const injectRes = await fetch(`http://${existing.workerHost}:${existing.workerPort}/__inject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-worker-auth': AUTH_TOKEN },
          body: JSON.stringify({ files, wipe: true })
        });

        if (injectRes.ok) {
          console.log(`[Orchestrator] Warm update for ${existing.workerId} took ${Date.now() - injectStart}ms`);
          return res.json({ 
            workerId: existing.workerId, 
            previewUrl: `http://localhost:${process.env.WORKER_PORT || 3001}/api/preview/proxy/${existing.workerId}/`,
            warm: true 
          });
        }
      } catch (err) {
        console.warn(`[Orchestrator] Session health check failed for ${existing.workerId}: ${err.message}`);
        await sessionManager.deleteSession(existing.workerId);
        // Fall through to cold start
      }
    }

    // ─── Cold Start Path ───
    if (IS_GKE) {
      const { active, max } = await backend.getClusterCapacity();
      if (active >= max) {
        return res.status(503).json({
          error: `Preview cluster is full (${active}/${max}). Try again shortly.`,
          retryAfterMs: 15000
        });
      }
    }

    try {
      const sessionId = crypto.randomBytes(8).toString('hex');
      let workerHost, workerPort, workerId;

      if (IS_GKE) {
        workerId = await backend.createPreviewPod(sessionId, projectId);
        workerHost = await backend.waitForPodReady(workerId);
        workerPort = 3000;
      } else {
        const result = await backend.createLocalWorker(sessionId);
        workerId = result.containerName;
        workerPort = result.port;
        workerHost = 'localhost';
        await backend.waitForWorkerReady(workerPort);
      }

      // Inject files
      const injectRes = await fetch(`http://${workerHost}:${workerPort}/__inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-worker-auth': AUTH_TOKEN },
        body: JSON.stringify({ files })
      });

      if (!injectRes.ok) throw new Error(`Inject failed: ${await injectRes.text()}`);

      await sessionManager.setSession(sessionKey, { 
        workerId, 
        workerHost, 
        workerPort, 
        projectId: sessionKey, 
        userId 
      });
      
      res.json({ 
        workerId, 
        previewUrl: `http://localhost:${process.env.WORKER_PORT || 3001}/api/preview/proxy/${workerId}/`,
        warm: false
      });

    } catch (err) {
      console.error('[Start] Error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  router.patch('/:workerId', async (req, res) => {
    const { workerId } = req.params;
    const { files, projectId } = req.body;

    const session = await sessionManager.getSessionByWorker(workerId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (projectId && session.projectId !== projectId) {
      return res.status(403).json({ error: 'Session mismatch' });
    }

    try {
      const injectStart = Date.now();
      const injectRes = await fetch(`http://${session.workerHost}:${session.workerPort}/__inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-worker-auth': AUTH_TOKEN },
        body: JSON.stringify({ files })
      });

      if (!injectRes.ok) throw new Error('Inject failed');
      console.log(`[Orchestrator] Code patch for ${workerId} took ${Date.now() - injectStart}ms`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const cleanupHandler = async (req, res) => {
    const { workerId } = req.params;
    try {
      if (IS_GKE) await backend.deletePreviewPod(workerId);
      else await backend.deleteLocalWorker(workerId);
      await sessionManager.deleteSession(workerId);
    } catch (err) {}
    res.json({ ok: true });
  };

  router.delete('/:workerId', cleanupHandler);
  router.post('/:workerId/delete', cleanupHandler);

  router.get('/stats', async (req, res) => {
    const sessions = await sessionManager.listSessions();
    res.json({
      runtime: IS_GKE ? 'gke' : 'local',
      activeSessions: sessions.length,
      sessions: sessions.map(s => ({
        projectId: s.projectId,
        workerId: s.workerId
      }))
    });
  });

  // ─── Singleton Proxy for iframe Previews ───
  const previewProxy = createProxyMiddleware({
    target: 'http://placeholder',
    router: async (req) => {
      const { workerId } = req.params;
      const session = await sessionManager.getSessionByWorker(workerId);
      return session ? `http://${session.workerHost}:${session.workerPort}` : undefined;
    },
    changeOrigin: true,
    ws: false, // Handled globally in server.js
    logLevel: 'silent',
    onError: (err, req, res) => {
      if (err.code !== 'ECONNRESET') {
        console.error(`[PreviewProxy Error]`, err.message);
      }
      if (res && !res.headersSent && res.status) {
        res.status(502).send(`Worker communication failed: ${err.message}`);
      }
    },
    onProxyRes: (proxyRes) => {
      proxyRes.headers['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
      proxyRes.headers['pragma'] = 'no-cache';
      proxyRes.headers['expires'] = '0';
      proxyRes.headers['surrogate-control'] = 'no-store';
    },
  });

  router.use('/proxy/:workerId', async (req, res, next) => {
    const { workerId } = req.params;
    const session = await sessionManager.getSessionByWorker(workerId);
    
    if (!session) {
      console.warn(`[Proxy] Session NOT FOUND for workerId: ${workerId}`);
      return res.status(404).send('Preview not found or expired');
    }

    res.cookie('preview-worker-id', workerId, { path: '/', httpOnly: true, sameSite: 'lax' });
    previewProxy(req, res, next);
  });

  return {
    router,
    getSessionByWorkerId: async (workerId) => {
      return await sessionManager.getSessionByWorker(workerId);
    }
  };
};
