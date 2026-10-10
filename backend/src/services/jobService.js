const Job = require('../models/Job');
const { STATUS, assertTransition } = require('../core/stateMachine');
const { backoffMs } = require('../core/backoff');
const { advanceDependents, reconcileBlocked } = require('./dependencyService');

// Returns { job, created }. With an idempotency key, submitting the same key again
// returns the original job (created: false) instead of making a duplicate.
async function createJob({ type, payload = {}, runAt, maxAttempts, idempotencyKey }) {
  if (idempotencyKey) {
    const existing = await Job.findOne({ idempotencyKey });
    if (existing) return { job: existing, created: false };
  }

  try {
    const job = await Job.create({
      type,
      payload,
      ...(runAt && { runAt: new Date(runAt) }),
      ...(maxAttempts && { maxAttempts }),
      // Only set the key when there is one: a stored null would collide in the unique index.
      ...(idempotencyKey && { idempotencyKey }),
    });
    return { job, created: true };
  } catch (err) {
    // Two requests with the same key raced: the unique index let only one insert win.
    if (err.code === 11000 && idempotencyKey) {
      const existing = await Job.findOne({ idempotencyKey });
      if (existing) return { job: existing, created: false };
    }
    throw err;
  }
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
// A job is runnable if either:
//   1. it is PENDING/RETRYING and its runAt time has arrived, or
//   2. it is RUNNING but its lease expired (the worker died) and attempts remain.
// BLOCKED jobs match neither branch, so workers never touch them.
async function claimNext(workerId, leaseMs) {
  const now = new Date();
  return Job.findOneAndUpdate(
    {
      $or: [
        { status: { $in: [STATUS.PENDING, STATUS.RETRYING] }, runAt: { $lte: now } },
        {
          status: STATUS.RUNNING,
          leaseExpiresAt: { $lt: now },
          $expr: { $lt: ['$attempts', '$maxAttempts'] },
        },
      ],
    },
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

// Tell the workflow steps waiting on this job that it reached a final state.
// If this fails, the job itself is already recorded; reconcileBlocked() repairs it later.
async function notifyDependents(jobId) {
  try {
    await advanceDependents(jobId);
  } catch (err) {
    console.error(`advanceDependents failed for job ${jobId} (reconciler will repair): ${err.message}`);
  }
}

// Mark a job SUCCESS, but only if this worker still owns it.
async function completeJob(job, result) {
  assertTransition(STATUS.RUNNING, STATUS.SUCCESS);
  const done = await Job.findOneAndUpdate(
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
  if (done && job.workflowId) await notifyDependents(job._id);
  return done;
}

// A failed attempt: retry with backoff if attempts remain, otherwise FAILED.
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

  const updated = await Job.findOneAndUpdate(
    { _id: job._id, status: STATUS.RUNNING, lockedBy: job.lockedBy },
    { $set: update },
    { returnDocument: 'after' }
  );
  // Only a FINAL failure affects the steps downstream. A retry is not a failure yet.
  if (updated && exhausted && job.workflowId) await notifyDependents(job._id);
  return updated;
}

// A job whose worker died on its LAST attempt can never be re-claimed.
// Mark it FAILED so it does not sit in RUNNING forever. Returns how many were fixed.
async function reapExhausted() {
  const now = new Date();
  const res = await Job.updateMany(
    {
      status: STATUS.RUNNING,
      leaseExpiresAt: { $lt: now },
      $expr: { $gte: ['$attempts', '$maxAttempts'] },
    },
    {
      $set: {
        status: STATUS.FAILED,
        lastError: 'Worker lost: lease expired on the final attempt',
        finishedAt: now,
        lockedBy: null,
        leaseExpiresAt: null,
      },
    }
  );
  return res.modifiedCount;
}

// Cancel a job that has not started. Atomic: if a worker claims it first, this matches nothing.
async function cancelJob(id) {
  assertTransition(STATUS.PENDING, STATUS.CANCELLED);
  assertTransition(STATUS.RETRYING, STATUS.CANCELLED);
  return Job.findOneAndUpdate(
    { _id: id, status: { $in: [STATUS.PENDING, STATUS.RETRYING] } },
    { $set: { status: STATUS.CANCELLED, finishedAt: new Date() } },
    { returnDocument: 'after' }
  );
}

// Send a FAILED job back to the queue with a fresh set of attempts.
async function retryFailedJob(id) {
  assertTransition(STATUS.FAILED, STATUS.PENDING);
  return Job.findOneAndUpdate(
    { _id: id, status: STATUS.FAILED },
    {
      $set: { status: STATUS.PENDING, attempts: 0, runAt: new Date(), lastError: null },
      $unset: { finishedAt: '', startedAt: '', result: '' },
    },
    { returnDocument: 'after' }
  );
}

module.exports = {
  createJob,
  getJob,
  listJobs,
  claimNext,
  completeJob,
  failJob,
  reapExhausted,
  cancelJob,
  retryFailedJob,
  reconcileBlocked,
};