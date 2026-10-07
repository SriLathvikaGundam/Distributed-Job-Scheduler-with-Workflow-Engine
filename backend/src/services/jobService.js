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
// A job is runnable if either:
//   1. it is PENDING/RETRYING and its runAt time has arrived, or
//   2. it is RUNNING but its lease expired (the worker died) and attempts remain.
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

// Mark a job SUCCESS, but only if this worker still owns it.
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

  return Job.findOneAndUpdate(
    { _id: job._id, status: STATUS.RUNNING, lockedBy: job.lockedBy },
    { $set: update },
    { returnDocument: 'after' }
  );
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

module.exports = { createJob, getJob, listJobs, claimNext, completeJob, failJob, reapExhausted };