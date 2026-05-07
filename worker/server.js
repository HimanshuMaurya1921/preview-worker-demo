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

// Initialize the refactored orchestrator router
const orchestrator = require('./preview-system/orchestrator/index')();
app.use('/api/preview', orchestrator.router);

// Global Asset Proxy (Sticky Session)
// If a request hits the root (like /_next/static) but we have a session cookie,
// forward it to the active worker.
app.use((req, res, next) => {
  const workerId = req.cookies['preview-worker-id'];
  if (!workerId) return next();

  const session = orchestrator.getSessionByWorkerId(workerId);
  if (!session) return next();

  // Route assets, API calls, and HTML requests to the worker
  const isAsset = req.url.startsWith('/_next/') || 
                  req.url.startsWith('/static/') || 
                  req.url.startsWith('/api/') || 
                  req.headers.accept?.includes('text/html');

  if (isAsset) {
    const { createProxyMiddleware } = require('http-proxy-middleware');
    return createProxyMiddleware({
      target: `http://${session.workerHost}:${session.workerPort}`,
      changeOrigin: true,
      ws: true,
      logLevel: 'silent',
      onError: (err, req, res) => {
        console.error('[Proxy Error]', err.message);
        res.status(502).send('Worker communication failed');
      }
    })(req, res, next);
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

// Handle WebSocket upgrades for HMR
server.on('upgrade', (req, socket, head) => {
  // Manual cookie parsing for WebSocket upgrade requests
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('='))
  );
  
  const workerId = cookies['preview-worker-id'];
  const session = workerId ? orchestrator.getSessionByWorkerId(workerId) : null;

  if (session) {
    const { createProxyMiddleware } = require('http-proxy-middleware');
    const proxy = createProxyMiddleware({
      target: `http://${session.workerHost}:${session.workerPort}`,
      ws: true,
      changeOrigin: true,
      logLevel: 'silent'
    });
    proxy.upgrade(req, socket, head);
  } else {
    socket.destroy();
  }
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
