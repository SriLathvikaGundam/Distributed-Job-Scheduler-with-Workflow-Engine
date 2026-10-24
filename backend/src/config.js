require('dotenv').config({ quiet: true });
const { parseQueueConfig } = require('./core/queueConfig');

const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
};

module.exports = {
  port: int(process.env.PORT, 3000),
  mongoUri: process.env.MONGO_URI,
  worker: {
    concurrency: int(process.env.WORKER_CONCURRENCY, 3),
    pollMs: int(process.env.POLL_INTERVAL_MS, 1000),
    leaseMs: int(process.env.LEASE_MS, 30000),
    jobTimeoutMs: int(process.env.JOB_TIMEOUT_MS, 20000),
  },
  scheduler: {
    tickMs: int(process.env.SCHEDULER_TICK_MS, 1000),
  },
  // "mongo": workers claim jobs straight from MongoDB (default).  "sqs": jobs are delivered via AWS SQS.
  queue: parseQueueConfig(process.env),
  dispatcher: {
    tickMs: int(process.env.DISPATCH_TICK_MS, 1000),
    // A job that was queued but is still waiting after this long gets queued again (the message may be lost).
    redispatchAfterMs: int(process.env.REDISPATCH_AFTER_MS, 300000),
  },
};