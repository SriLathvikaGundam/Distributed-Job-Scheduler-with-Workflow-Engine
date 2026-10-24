const os = require('os');
const config = require('../config');
const { connect, disconnect } = require('../db');
const service = require('../services/jobService');
const Worker = require('./worker');
const handlers = require('./handlers');
const SqsQueue = require('../queue/sqsQueue');
const { SqsSource } = require('./sources');

const log = require('../logger');

// Where this worker gets its jobs from. Returns undefined for "mongo" mode: the worker's default.
function buildSource(workerId) {
  if (config.queue.mode !== 'sqs') return undefined;

  const queue = new SqsQueue({ queueUrl: config.queue.url, region: config.queue.region });
  return new SqsSource({
    queue,
    service,
    workerId,
    log,
    leaseMs: config.worker.leaseMs,
    // Keep a received message hidden a little LONGER than the lease, so it only reappears
    // after the lease of a dead worker has expired and the job can be re-claimed.
    visibilitySeconds: Math.ceil(config.worker.leaseMs / 1000) + config.queue.visibilityMarginSeconds,
    waitSeconds: config.queue.waitSeconds,
  });
}

(async () => {
  await connect();

  const workerId = `${os.hostname()}-${process.pid}`;
  log.info(`queue mode: ${config.queue.mode}`);
  const worker = new Worker({ workerId, handlers, log, ...config.worker, source: buildSource(workerId) });

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