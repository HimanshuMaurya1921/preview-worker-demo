require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

// Generate a shared secret for worker-orchestrator communication if not provided
if (!process.env.WORKER_AUTH_TOKEN) {
  process.env.WORKER_AUTH_TOKEN = crypto.randomBytes(32).toString('hex');
}

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));

const { createProxyMiddleware } = require('http-proxy-middleware');

// Initialize the refactored orchestrator router
const orchestrator = require('./preview-system/orchestrator/index')();
app.use('/api/preview', orchestrator.router);

// ─── Singleton Proxy for Global Assets & WebSockets ───
const mainProxy = createProxyMiddleware({
  target: 'http://placeholder', // Dynamic target via router
  router: async (req) => {
    const workerId = req.cookies['preview-worker-id'] || req.headers['x-preview-worker-id'];
    if (!workerId) return undefined;
    const session = await orchestrator.getSessionByWorkerId(workerId);
    return session ? `http://${session.workerHost}:${session.workerPort}` : undefined;
  },
  changeOrigin: true,
  ws: true,
  logLevel: 'silent',
  onError: (err, req, res) => {
    // Only log if it's not a standard cancellation
    if (err.code !== 'ECONNRESET') {
      console.error('[MainProxy Error]', err.message);
    }
    if (res && !res.headersSent && res.status) {
      res.status(502).send('Worker communication failed');
    }
  }
});

// Global Asset Proxy (Sticky Session)
app.use(async (req, res, next) => {
  const workerId = req.cookies['preview-worker-id'];
  if (!workerId) return next();

  // Route assets, API calls, and HTML requests to the worker
  // IMPORTANT: Exclude /api/preview to allow orchestrator routes to work
  const isAsset = (req.url.startsWith('/_next/') || 
                   req.url.startsWith('/static/') || 
                   (req.url.startsWith('/api/') && !req.url.startsWith('/api/preview'))) ||
                   req.headers.accept?.includes('text/html');

  if (isAsset) {
    return mainProxy(req, res, next);
  }
  
  next();
});

// Simple healthcheck
app.get('/health', (req, res) => {
  res.json({ 
    status: 'active',
    runtime: process.env.RUNTIME || 'local'
  });
});

const PORT = process.env.WORKER_PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`[Worker Orchestrator] Running on port ${PORT} (${process.env.RUNTIME || 'local'} mode)`);
});

// Handle WebSocket upgrades for HMR using the singleton proxy
server.on('upgrade', (req, socket, head) => {
  mainProxy.upgrade(req, socket, head);
});

// Graceful shutdown
const shutdown = () => {
  console.log('[Orchestrator] Shutting down...');
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
