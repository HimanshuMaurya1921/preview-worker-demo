const { spawn } = require('child_process');
const worker = spawn('node', ['preview-system/preview-worker/worker.js', 'mytest', '5000'], { stdio: 'pipe' });
worker.stdout.on('data', (d) => process.stdout.write(d));
worker.stderr.on('data', (d) => process.stderr.write(d));
worker.on('exit', (c) => console.log('worker exited', c));
