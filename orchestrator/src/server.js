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
const orchestrator = require('./index')();
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
  proxyTimeout: 10000, // 10s wait for worker to respond
  timeout: 10000,      // 10s wait for connection
  onError: (err, req, res) => {
    // Catch transient connection issues during project swaps
    const isRetryable = err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET';
    
    if (isRetryable && !res.headersSent) {
      if (req.headers.accept?.includes('text/html')) {
        console.log(`[Proxy] Worker busy or restarting (${err.code}), sending sync helper...`);
        return res.status(200).send(`
          <div style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; color: #64748b; background: #f8fafc;">
            <div style="width: 24px; height: 24px; border: 2px solid #e2e8f0; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.6s linear infinite; margin-bottom: 12px;"></div>
            <p style="font-size: 14px; margin: 0;">Syncing changes...</p>
            <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
            <script>setTimeout(() => location.reload(), 1000)</script>
          </div>
        `);
      }
    }

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
