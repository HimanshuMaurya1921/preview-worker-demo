require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

try {
  const previewRouter = require('./preview-system/orchestrator/index');
  const pool = require('./preview-system/worker-pool/WorkerPool');
  const { createProxyMiddleware } = require('http-proxy-middleware');

  // Next.js asset routing fallback for Cloudflare Proxy (Production)
  // When hitting the proxy path, Next.js still requests /_next/static at the root domain.
  // We intercept it, check the Referer header for the worker ID, and manually proxy it to the correct port!
  app.use('/_next', (req, res, next) => {
    const referer = req.get('referer');
    if (referer) {
      const match = referer.match(/\/api\/preview\/proxy\/(w-[a-z0-9-]+)/);
      if (match) {
        const workerId = match[1];
        const worker = pool.getWorker(workerId);
        if (worker) {
          return createProxyMiddleware({ 
            target: `http://localhost:${worker.port}`, 
            changeOrigin: true 
          })(req, res, next);
        }
      }
    }
    next();
  });

  app.use('/api/preview', previewRouter);
} catch (err) {
  console.log('Preview system router not yet available, skipping mount.', err);
}

// Simple healthcheck for the EC2 runner
app.get('/health', (req, res) => {
  res.json({ status: 'Runner is active' });
});

const PORT = process.env.RUNNER_PORT || 3001;
app.listen(PORT, () => {
  console.log(`[Runner Orchestrator] Running on port ${PORT}`);
});
