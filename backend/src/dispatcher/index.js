const config = require('../config');
const { connect, disconnect } = require('../db');
const Dispatcher = require('./dispatcher');
const SqsQueue = require('../queue/sqsQueue');

const stamp = () => new Date().toISOString().slice(11, 19); // HH:MM:SS (UTC)
const log = {
  info: (m) => console.log(`${stamp()} ${m}`),
  warn: (m) => console.warn(`${stamp()} ${m}`),
  error: (m) => console.error(`${stamp()} ${m}`),
};

(async () => {
  if (config.queue.mode !== 'sqs') {
    console.error('The dispatcher is only needed when QUEUE_MODE=sqs. Nothing to do.');
    process.exit(1);
  }

  await connect();
  const queue = new SqsQueue({ queueUrl: config.queue.url, region: config.queue.region });
  const dispatcher = new Dispatcher({ queue, log, ...config.dispatcher });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) process.exit(1); // second signal: force exit
    shuttingDown = true;
    log.info(`${signal} received: stopping dispatcher...`);
    await dispatcher.stop();
    await disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await dispatcher.start();
})();