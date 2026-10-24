const Worker = require('../../src/worker/worker');
const { SqsSource } = require('../../src/worker/sources');
const service = require('../../src/services/jobService');
const { waitFor } = require('./waitFor');

const silent = { info() {}, warn() {}, error() {} };
let counter = 0;

// A real Worker with short timings. The lease is generous so a slow database cannot expire it mid-job.
function makeWorker(handlers, extra = {}) {
  return new Worker({
    workerId: `test-worker-${++counter}`,
    handlers,
    concurrency: 3,
    pollMs: 20,
    leaseMs: 3000,
    jobTimeoutMs: 2000,
    log: silent,
    ...extra,
  });
}

// A real Worker fed by a (fake) SQS queue.
function makeSqsWorker(queue, handlers, { leaseMs = 1500, jobTimeoutMs = 1000, ...extra } = {}) {
  const workerId = `sqs-worker-${++counter}`;
  const source = new SqsSource({
    queue,
    service,
    workerId,
    leaseMs,
    visibilitySeconds: leaseMs / 1000 + 0.5, // a little longer than the lease, as in production
    waitSeconds: 0.05,
    log: silent,
  });
  return makeWorker(handlers, { workerId, leaseMs, jobTimeoutMs, source, ...extra });
}

// Start a worker, wait for a condition, and always shut the worker down cleanly.
async function runUntil(worker, condition, message) {
  worker.start();
  try {
    await waitFor(condition, { message });
  } finally {
    await worker.stop();
  }
}

module.exports = { silent, makeWorker, makeSqsWorker, runUntil };