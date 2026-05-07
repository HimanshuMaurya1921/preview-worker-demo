const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const crypto = require('crypto');

const IS_GKE = process.env.RUNTIME === 'gke';

// Load the right backend
const backend = IS_GKE
  ? require('./k8sClient')
  : require('./localWorker');

module.exports = function() {
  const router = express.Router();
  const sessions = new Map();  // projectId → { workerId, workerHost, workerPort }
  const AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN;

  // Reconcile sessions from k8s on startup if in GKE mode
  if (IS_GKE) {
    backend.reconcileSessions(sessions).catch(console.error);
  }

  router.post('/start', async (req, res) => {
    const { projectId, userId, files } = req.body;
    
    // sessionKey ensures one pod per user. Fallback to projectId for legacy support.
    const sessionKey = userId || projectId;
    
    if (!sessionKey) {
      return res.status(400).json({ error: 'Missing userId or projectId' });
    }
    
    if (!files) return res.status(400).json({ error: 'files required' });

    // ─── Warm Update Logic: Check if a healthy session exists for this user ───
    if (sessions.has(sessionKey)) {
      const existing = sessions.get(sessionKey);
      console.log(`[Orchestrator] Existing session found for ${sessionKey}. Verifying health...`);
      
      try {
        // 1. Double check: Is the container/pod actually running?
        const isRunning = await backend.isWorkerRunning(existing.workerId);
        if (!isRunning) throw new Error('Worker not running');

        // 2. Get initial compile version with strict timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const healthRes = await fetch(`http://${existing.workerHost}:${existing.workerPort}/__health`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const healthData = await healthRes.json();
        const initialVersion = healthData.compileVersion || 0;

        const injectRes = await fetch(`http://${existing.workerHost}:${existing.workerPort}/__inject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-worker-auth': AUTH_TOKEN },
          body: JSON.stringify({ files, wipe: true })
        });

        if (injectRes.ok) {
          // 2. Poll until compileVersion increments
          console.log(`[Orchestrator] Waiting for compilation (Version ${initialVersion} -> ${initialVersion + 1})...`);
          let ready = false;
          let attempts = 0;
          while (!ready && attempts < 20) { // 10s max timeout
            await new Promise(r => setTimeout(r, 500));
            attempts++;
            try {
              const pollRes = await fetch(`http://${existing.workerHost}:${existing.workerPort}/__health`);
              const pollData = await pollRes.json();
              if (pollData.compileVersion > initialVersion && !pollData.isCompiling) {
                ready = true;
              }
            } catch (e) {}
          }

          return res.json({ 
            workerId: existing.workerId, 
            previewUrl: `http://localhost:${process.env.WORKER_PORT || 3001}/api/preview/proxy/${existing.workerId}/`,
            warm: true 
          });
        }
      } catch (err) {
        console.warn(`[Orchestrator] Session health check failed for ${existing.workerId}: ${err.message}`);
        sessions.delete(sessionKey);
        try {
          if (IS_GKE) backend.deletePreviewPod(existing.workerId).catch(() => {});
          else backend.deleteLocalWorker(existing.workerId).catch(() => {});
        } catch (e) {}
        
        return res.json({ 
          status: 'expired', 
          message: 'Preview container was recycled due to inactivity. Re-booting...' 
        });
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

    let isActive = true;
    req.on('close', () => { isActive = false; });

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

      if (!isActive) {
        if (IS_GKE) backend.deletePreviewPod(workerId).catch(() => {});
        else backend.deleteLocalWorker(workerId).catch(() => {});
        return;
      }

      // Inject files into the running pod/container
      const injectRes = await fetch(`http://${workerHost}:${workerPort}/__inject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-worker-auth': AUTH_TOKEN
        },
        body: JSON.stringify({ files })
      });

      if (!injectRes.ok) throw new Error(`Inject failed: ${await injectRes.text()}`);

      sessions.set(sessionKey, { workerId, workerHost, workerPort, projectId, userId });
      
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

    const session = [...sessions.values()].find(s => s.workerId === workerId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Verify that the projectId matches the session (if provided)
    if (projectId && session.projectId !== projectId) {
      return res.status(403).json({ error: 'Session mismatch' });
    }

    try {
      const injectRes = await fetch(`http://${session.workerHost}:${session.workerPort}/__inject`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'x-worker-auth': AUTH_TOKEN 
        },
        body: JSON.stringify({ files })
      });

      if (!injectRes.ok) throw new Error('Inject failed');
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
    } catch (err) {}

    for (const [pid, s] of sessions) {
      if (s.workerId === workerId) {
        sessions.delete(pid);
        break;
      }
    }

    res.json({ ok: true });
  };

  router.delete('/:workerId', cleanupHandler);
  router.post('/:workerId/delete', cleanupHandler);

  router.get('/stats', (req, res) => {
    res.json({
      runtime: IS_GKE ? 'gke' : 'local',
      activeSessions: sessions.size,
      sessions: [...sessions.entries()].map(([pid, s]) => ({
        projectId: pid,
        workerId: s.workerId
      }))
    });
  });

  router.use('/proxy/:workerId', (req, res, next) => {
    const { workerId } = req.params;
    const session = [...sessions.values()].find(s => s.workerId === workerId);
    
    if (!session) {
      console.warn(`[Proxy] Session NOT FOUND for workerId: ${workerId}`);
      return res.status(404).send('Preview not found or expired');
    }

    console.log(`[Proxy] Routing ${workerId} -> ${session.workerHost}:${session.workerPort}`);

    // Set a cookie so root-level asset requests know which worker to talk to
    res.cookie('preview-worker-id', workerId, { path: '/', httpOnly: true, sameSite: 'lax' });

    createProxyMiddleware({
      target: `http://${session.workerHost}:${session.workerPort}`,
      changeOrigin: true,
      ws: true,
      logLevel: 'silent',
      onError: (err, req, res) => {
        console.error(`[Proxy Error] ${workerId}:`, err.message);
        if (!res.headersSent) {
          res.status(502).send(`Worker communication failed: ${err.message}`);
        }
      },
      onProxyRes: (proxyRes) => {
        // Disable caching for preview assets to ensure 100% fresh UI
        proxyRes.headers['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
        proxyRes.headers['pragma'] = 'no-cache';
        proxyRes.headers['expires'] = '0';
        proxyRes.headers['surrogate-control'] = 'no-store';
      },
    })(req, res, next);
  });

  return {
    router,
    getSessionByWorkerId: (workerId) => {
      return [...sessions.values()].find(s => s.workerId === workerId);
    }
  };
};
