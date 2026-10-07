const Job = require('../models/Job');
const { STATUS, assertTransition } = require('../core/stateMachine');
const { backoffMs } = require('../core/backoff');

async function createJob({ type, payload = {}, runAt, maxAttempts }) {
  return Job.create({
    type,
    payload,
    ...(runAt && { runAt: new Date(runAt) }),
    ...(maxAttempts && { maxAttempts }),
  });
}

const getJob = (id) => Job.findById(id);

async function listJobs({ status, type, limit = 50, skip = 0 } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;

  const [items, total] = await Promise.all([
    Job.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Job.countDocuments(filter),
  ]);
  return { items, total };
}

// Atomically claim the next runnable job for a worker.
async function claimNext(workerId, leaseMs) {
  const now = new Date();
  return Job.findOneAndUpdate(
    { status: { $in: [STATUS.PENDING, STATUS.RETRYING] }, runAt: { $lte: now } },
    {
      $set: {
        status: STATUS.RUNNING,
        lockedBy: workerId,
        startedAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
      },
      $inc: { attempts: 1 },
    },
    { sort: { runAt: 1 }, returnDocument: 'after' }
  );
}

// Mark a job SUCCESS, but only if this worker still owns it.
// Returns null if the lease was lost (the result is then dropped).
async function completeJob(job, result) {
  assertTransition(STATUS.RUNNING, STATUS.SUCCESS);
  return Job.findOneAndUpdate(
    { _id: job._id, status: STATUS.RUNNING, lockedBy: job.lockedBy },
    {
      $set: {
        status: STATUS.SUCCESS,
        result,
        finishedAt: new Date(),
        lockedBy: null,
        leaseExpiresAt: null,
      },
    },
    { returnDocument: 'after' }
  );
}

// A failed attempt: retry if attempts remain, otherwise FAILED.
// (Step 8 replaces the fixed delay below with exponential backoff.)
// (Step 8 replaces the fixed delay below with exponential backoff.)
 // const RETRY_DELAY_MS = 1000;

async function failJob(job, error) {
  const message = error && error.message ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;
  const next = exhausted ? STATUS.FAILED : STATUS.RETRYING;
  assertTransition(STATUS.RUNNING, next);

  const update = {
    status: next,
    lastError: message,
    lockedBy: null,
    leaseExpiresAt: null,
    ...(exhausted
      ? { finishedAt: new Date() }
      : { runAt: new Date(Date.now() + backoffMs(job.attempts)) }),
  };

  return Job.findOneAndUpdate(
    { _id: job._id, status: STATUS.RUNNING, lockedBy: job.lockedBy },
    { $set: update },
    { returnDocument: 'after' }
  );
}

module.exports = { createJob, getJob, listJobs, claimNext, completeJob, failJob };