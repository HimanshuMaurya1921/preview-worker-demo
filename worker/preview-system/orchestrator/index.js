const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const pool = require('../worker-pool/WorkerPool');

const router = express.Router();

pool.init().catch(console.error);

router.post('/start', async (req, res) => {
  const { projectId, files } = req.body;
  if (!files) return res.status(400).json({ error: 'Files are required' });

  try {
    const worker = await pool.acquireWorker();
    
    // Node.js fetch is available in v18+
    const response = await fetch(`http://localhost:${worker.port}/__inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files })
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to inject files into worker: ${response.status} ${text}`);
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files })
    });

    if (!response.ok) throw new Error('Failed to inject files');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:workerId', async (req, res) => {
  const { workerId } = req.params;
  await pool.releaseWorker(workerId);
  res.json({ ok: true });
});

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
    pathRewrite: {
      [`^/api/preview/proxy/${workerId}`]: '',
    },
  })(req, res, next);
});

module.exports = router;
