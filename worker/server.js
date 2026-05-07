require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

// Generate a shared secret for worker-orchestrator communication if not provided
if (!process.env.WORKER_AUTH_TOKEN) {
  process.env.WORKER_AUTH_TOKEN = crypto.randomBytes(32).toString('hex');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize the refactored orchestrator router
const previewRouter = require('./preview-system/orchestrator/index')();
app.use('/api/preview', previewRouter);

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

// Graceful shutdown
const shutdown = () => {
  console.log('[Orchestrator] Shutting down...');
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
