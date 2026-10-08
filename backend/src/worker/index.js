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

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      log.warn('Second signal received: forcing exit');
      process.exit(1);
    }
    shuttingDown = true;
    log.info(`${signal} received: finishing ${worker.active.size} running job(s), claiming no new ones...`);
    await worker.stop();
    await disconnect();
    log.info('Shutdown complete');
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await worker.start();
})();