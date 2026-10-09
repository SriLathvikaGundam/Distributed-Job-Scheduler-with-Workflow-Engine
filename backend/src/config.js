require('dotenv').config();

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
};