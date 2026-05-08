import { WebContainer } from '@webcontainer/api';
import { SnapshotLoader } from './snapshot-loader';

class WebContainerClient {
  constructor() {
    this.instance = null;
    this.loader = new SnapshotLoader();
    this.status = 'IDLE'; // IDLE, BOOTING, READY, RUNNING
    this.bootPromise = null;
    this.serverUrl = null;
    this.metrics = {
      bootTime: 0,
      restoreTime: 0,
      nextStartTime: 0
    };
  }

  async init() {
    if (this.bootPromise) return this.bootPromise;

    this.bootPromise = (async () => {
      const start = performance.now();
      this.status = 'BOOTING';
      console.log('[WebContainer] Proactive boot started...');

      // 1. Boot the container
      this.instance = await WebContainer.boot();
      this.metrics.bootTime = performance.now() - start;
      console.log(`[WebContainer] Booted in ${this.metrics.bootTime.toFixed(2)}ms`);

      // 2. Pre-load the snapshot
      const tree = await this.loader.load();
      await this.instance.mount(tree);
      this.metrics.restoreTime = performance.now() - start - this.metrics.bootTime;
      console.log(`[WebContainer] Snapshot restored in ${this.metrics.restoreTime.toFixed(2)}ms`);

      this.status = 'READY';
      return this.instance;
    })();

    return this.bootPromise;
  }

  async writeFile(path, content) {
    if (!this.instance) throw new Error('WebContainer not initialized');
    await this.instance.fs.writeFile(path, content);
  }

  async startDevServer(onReady) {
    if (this.status === 'RUNNING' || this.status === 'STARTING_SERVER') {
      if (onReady && this.serverUrl) onReady(this.serverUrl);
      return;
    }

    const start = performance.now();
    this.status = 'STARTING_SERVER';
    console.log('[WebContainer] Starting Next.js dev server...');
    
    try {
      this.instance.on('server-ready', (port, url) => {
        this.metrics.nextStartTime = performance.now() - start;
        console.log(`[WebContainer] Next.js ready on port ${port} in ${this.metrics.nextStartTime.toFixed(2)}ms`);
        this.serverUrl = url;
        this.status = 'RUNNING';
        if (onReady) onReady(url);
      });

      // Use jsh for more reliable process spawning in WebContainers
      console.log('[WebContainer] Spawning via jsh: node ./node_modules/next/dist/bin/next dev');
      const process = await this.instance.spawn('jsh', ['-c', 'node ./node_modules/next/dist/bin/next dev']);

      if (!process) {
        throw new Error('Failed to spawn Next.js process: process is undefined');
      }

      // Handle streams using Web API (ReadableStream)
      const readStream = (stream, logFn) => {
        if (!stream) return;
        const reader = stream.getReader();
        const read = async () => {
          try {
            const { done, value } = await reader.read();
            if (done) return;
            logFn(value);
            read();
          } catch (e) {
            console.warn('[WebContainer] Stream read error:', e);
          }
        };
        read();
      };

      readStream(process.stdout || process.output, (data) => console.log(`[Next] ${data}`));
      readStream(process.stderr, (data) => console.error(`[Next Error] ${data}`));

      process.exit.then((code) => {
        console.warn(`[Next] Process exited with code ${code}`);
        this.status = 'READY';
        this.serverUrl = null;
      });

    } catch (err) {
      this.status = 'READY';
      console.error('[WebContainer] Dev Server Error:', err);
      throw err;
    }
  }

  async reset() {
    console.log('[WebContainer] Resetting environment...');
    const tree = await this.loader.assembleTree();
    await this.instance.mount(tree);
    this.status = 'READY';
    this.serverUrl = null;
  }

  getMetrics() {
    return this.metrics;
  }
}

export const webContainerClient = new WebContainerClient();
