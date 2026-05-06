const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(pool) {
  const router = express.Router();
  const sessions = new Map();

  router.post('/start', async (req, res) => {
    const { projectId, files } = req.body;
    if (!files) return res.status(400).json({ error: 'Files are required' });

    try {
      if (projectId && sessions.has(projectId)) {
        const oldWorkerId = sessions.get(projectId);
        const oldWorker = pool.getWorker(oldWorkerId);
        if (oldWorker) {
          console.log(`[Session] Recycling old worker ${oldWorkerId} for project ${projectId}`);
          await pool.releaseWorker(oldWorkerId);
        }
        sessions.delete(projectId);
      }

      const worker = await pool.acquireWorker();
      
      const response = await fetch(`http://localhost:${worker.port}/__inject`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-worker-auth': process.env.WORKER_AUTH_TOKEN
        },
        body: JSON.stringify({ files })
      });
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to inject files into worker: ${response.status} ${text}`);
      }

      if (projectId) {
        sessions.set(projectId, worker.id);
      }

      res.json({
        workerId: worker.id,
        previewUrl: `http://localhost:${worker.port}`
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/:workerId', async (req, res) => {
    const { workerId } = req.params;
    const { files } = req.body;
    const worker = pool.getWorker(workerId);
    
    if (!worker || worker.status !== 'busy') {
      return res.status(404).json({ error: 'Worker not found or not busy' });
    }

    try {
      pool.touchWorker(workerId);
      const response = await fetch(`http://localhost:${worker.port}/__inject`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-worker-auth': process.env.WORKER_AUTH_TOKEN
        },
        body: JSON.stringify({ files })
      });

      if (!response.ok) throw new Error('Failed to inject files');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Support both DELETE and POST (for sendBeacon)
  const cleanupHandler = async (req, res) => {
    const { workerId } = req.params;
    await pool.releaseWorker(workerId);

    for (const [pid, wid] of sessions) {
      if (wid === workerId) {
        sessions.delete(pid);
        break;
      }
    }

    res.json({ ok: true });
  };

  router.delete('/:workerId', cleanupHandler);
  router.post('/:workerId/delete', cleanupHandler);

  router.get('/stats', (req, res) => {
    res.json(pool.getStats());
  });

  router.use('/proxy/:workerId', (req, res, next) => {
    const { workerId } = req.params;
    const worker = pool.getWorker(workerId);
    if (!worker || worker.status !== 'busy') {
      return res.status(404).send('Preview not found or expired');
    }

    pool.touchWorker(workerId);

    createProxyMiddleware({
      target: `http://localhost:${worker.port}`,
      changeOrigin: true,
      ws: true,
      logLevel: 'silent',
      pathRewrite: {
        [`^/api/preview/proxy/${workerId}`]: '',
      },
    })(req, res, next);
  });

  return router;
};
