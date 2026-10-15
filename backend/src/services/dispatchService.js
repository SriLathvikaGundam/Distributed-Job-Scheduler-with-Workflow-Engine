const Job = require('../models/Job');
const { STATUS } = require('../core/stateMachine');

// Jobs that should have a message on the queue but, as far as we know, do not:
//   1. waiting jobs whose time has come that were never queued, or were queued so long ago
//      that the message may have been lost
//   2. RUNNING jobs whose lease expired long ago (the worker died, and so did its message)
function needsDispatchFilter(now, staleBefore) {
  const notRecentlyQueued = { $or: [{ queuedAt: null }, { queuedAt: { $lte: staleBefore } }] };
  return {
    $or: [
      { status: { $in: [STATUS.PENDING, STATUS.RETRYING] }, runAt: { $lte: now }, ...notRecentlyQueued },
      {
        status: STATUS.RUNNING,
        leaseExpiresAt: { $lt: staleBefore },
        $expr: { $lt: ['$attempts', '$maxAttempts'] },
        ...notRecentlyQueued,
      },
    ],
  };
}

// Atomically mark ONE job as "queued" and return it, so two dispatchers never pick the same job.
async function claimForDispatch(now, redispatchAfterMs) {
  const staleBefore = new Date(now.getTime() - redispatchAfterMs);
  return Job.findOneAndUpdate(needsDispatchFilter(now, staleBefore), { $set: { queuedAt: now } }, {
    sort: { runAt: 1 },
    returnDocument: 'after',
  });
}

// The message could not be sent: undo the mark so the next pass tries again straight away.
async function releaseDispatch(ids) {
  if (ids.length === 0) return;
  await Job.updateMany({ _id: { $in: ids } }, { $set: { queuedAt: null } });
}

module.exports = { claimForDispatch, releaseDispatch, needsDispatchFilter };