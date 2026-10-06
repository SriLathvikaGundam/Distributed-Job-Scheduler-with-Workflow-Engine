const Job = require('../models/Job');
const { STATUS } = require('../core/stateMachine');

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
// Returns the claimed job, or null if nothing is ready.
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

module.exports = { createJob, getJob, listJobs, claimNext };