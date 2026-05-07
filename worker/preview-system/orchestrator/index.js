const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
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
    const { projectId, files } = req.body;
    if (!files || !projectId) return res.status(400).json({ error: 'projectId and files required' });

    // Clean up any existing session for this project
    if (sessions.has(projectId)) {
      const old = sessions.get(projectId);
      try {
        if (IS_GKE) await backend.deletePreviewPod(old.workerId);
        else await backend.deleteLocalWorker(old.workerId);
      } catch (err) {}
      sessions.delete(projectId);
    }

    // On GKE: check cluster capacity before creating pod
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

      sessions.set(projectId, { workerId, workerHost, workerPort });
      
      res.json({ 
        workerId, 
        previewUrl: `http://localhost:${process.env.WORKER_PORT || 3001}/api/preview/proxy/${workerId}/` 
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

    if (projectId && sessions.get(projectId)?.workerId !== workerId) {
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
      return res.status(404).send('Preview not found or expired');
    }

    // Set a cookie so root-level asset requests know which worker to talk to
    res.cookie('preview-worker-id', workerId, { path: '/', httpOnly: true, sameSite: 'lax' });

    createProxyMiddleware({
      target: `http://${session.workerHost}:${session.workerPort}`,
      changeOrigin: true,
      ws: true,
      logLevel: 'silent',
      pathRewrite: {
        [`^/api/preview/proxy/${workerId}`]: '',
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
