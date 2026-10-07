const os = require('os');
const config = require('../config');
const { connect, disconnect } = require('../db');
const Worker = require('./worker');
const handlers = require('./handlers');

(async () => {
  await connect();

  const worker = new Worker({
    workerId: `${os.hostname()}-${process.pid}`,
    handlers,
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