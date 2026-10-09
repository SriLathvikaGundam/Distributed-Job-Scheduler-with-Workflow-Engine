const config = require('../config');
const { connect, disconnect } = require('../db');
const Scheduler = require('./scheduler');

const stamp = () => new Date().toISOString().slice(11, 19); // HH:MM:SS (UTC)
const log = {
  info: (m) => console.log(`${stamp()} ${m}`),
  warn: (m) => console.warn(`${stamp()} ${m}`),
  error: (m) => console.error(`${stamp()} ${m}`),
};

(async () => {
  await connect();
  const scheduler = new Scheduler({ ...config.scheduler, log });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) process.exit(1); // second signal: force exit
    shuttingDown = true;
    log.info(`${signal} received: stopping scheduler...`);
    await scheduler.stop();
    await disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await scheduler.start();
})();