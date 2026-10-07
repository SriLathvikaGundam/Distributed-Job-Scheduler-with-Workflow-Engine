const os = require('os');
const config = require('../config');
const { connect, disconnect } = require('../db');
const Worker = require('./worker');
const handlers = require('./handlers');

const stamp = () => new Date().toISOString().slice(11, 19); // HH:MM:SS (UTC)
const log = {
  info: (m) => console.log(`${stamp()} ${m}`),
  warn: (m) => console.warn(`${stamp()} ${m}`),
  error: (m) => console.error(`${stamp()} ${m}`),
};

(async () => {
  await connect();

  const worker = new Worker({
    workerId: `${os.hostname()}-${process.pid}`,
    handlers,
    log,
    ...config.worker,
  });

  // Simple shutdown for now. Step 10 makes this graceful.
  process.on('SIGINT', async () => {
    console.log('Stopping...');
    worker.stop();
    await disconnect();
    process.exit(0);
  });

  await worker.start();
})();