require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const WorkerPool = require('./preview-system/worker-pool/WorkerPool');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Generate a shared secret for worker-orchestrator communication
process.env.WORKER_AUTH_TOKEN = crypto.randomBytes(32).toString('hex');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const pool = new WorkerPool();

// Initialize the pool and start the eviction timer
pool.init()
  .then(() => pool.startEvictionTimer())
  .catch(err => console.error('[Pool Initialization Error]', err));

// Next.js asset routing fallback for API Gateway/CloudFront Proxy (Production)
// Security: Verifies the workerId in the Referer is currently assigned and active.
app.use('/_next', (req, res, next) => {
  const referer = req.get('referer');
  if (referer) {
    // Extract worker ID from the proxy path in the referer
    const match = referer.match(/\/api\/preview\/proxy\/(w-[a-z0-9-]+)/);
    if (match) {
      const workerId = match[1];
      const worker = pool.getWorker(workerId);
      
      // Only proxy if the worker is explicitly assigned to a session
      if (worker && worker.status === 'busy') {
        return createProxyMiddleware({ 
          target: `http://localhost:${worker.port}`, 
          changeOrigin: true,
          logLevel: 'silent'
        })(req, res, next);
      }
    }
  }
  next();
});

// Pass the pool instance to the router
const previewRouter = require('./preview-system/orchestrator/index')(pool);
app.use('/api/preview', previewRouter);

// Simple healthcheck
app.get('/health', (req, res) => {
  res.json({ 
    status: 'active',
    pool: pool.getStats()
  });
});

const PORT = process.env.WORKER_PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`[Worker Orchestrator] Running on port ${PORT}`);
});

// Graceful shutdown
const shutdown = () => {
  console.log('[Orchestrator] Shutting down...');
  pool.shutdown();
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
