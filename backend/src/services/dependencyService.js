const Job = require('../models/Job');
const { STATUS, assertTransition } = require('../core/stateMachine');

/**
 * Decide what should happen to ONE blocked job, based on the current state of its dependencies:
 *   - any dependency FAILED or CANCELLED -> cancel this job (and cascade downstream)
 *   - every dependency SUCCESS           -> release it (BLOCKED -> PENDING)
 *   - otherwise                          -> keep waiting
 *
 * It only looks at current state and every write is conditional on "still BLOCKED",
 * so it is safe to call repeatedly, and safe if several workers call it at once.
 */
async function evaluateBlocked(job) {
  const deps = await Job.find({ _id: { $in: job.dependsOn } }, 'stepName status');

  const broken = deps.find((d) => d.status === STATUS.FAILED || d.status === STATUS.CANCELLED);
  if (broken) {
    assertTransition(STATUS.BLOCKED, STATUS.CANCELLED);
    const cancelled = await Job.findOneAndUpdate(
      { _id: job._id, status: STATUS.BLOCKED },
      {
        $set: {
          status: STATUS.CANCELLED,
          finishedAt: new Date(),
          lastError: `Upstream step "${broken.stepName}" ${broken.status.toLowerCase()}`,
        },
      },
      { returnDocument: 'after' }
    );
    if (!cancelled) return 'unchanged'; // someone else already moved it
    await advanceDependents(cancelled._id); // its own dependents are now doomed too
    return 'cancelled';
  }

  // Every dependency must exist AND have succeeded.
  const allDone = deps.length === job.dependsOn.length && deps.every((d) => d.status === STATUS.SUCCESS);
  if (allDone) {
    assertTransition(STATUS.BLOCKED, STATUS.PENDING);
    const released = await Job.findOneAndUpdate(
      { _id: job._id, status: STATUS.BLOCKED },
      { $set: { status: STATUS.PENDING, runAt: new Date() } },
      { returnDocument: 'after' }
    );
    return released ? 'released' : 'unchanged';
  }

  return 'waiting';
}

// A job just reached a final state: re-check every BLOCKED job that was waiting on it.
async function advanceDependents(jobId) {
  const blocked = await Job.find({ status: STATUS.BLOCKED, dependsOn: jobId });
  const results = [];
  for (const job of blocked) results.push(await evaluateBlocked(job));
  return results;
}

// Safety net: re-check EVERY blocked job. This repairs the gap where a worker marked a job
// finished but crashed before it could advance the jobs waiting on it.
// Returns how many jobs it released or cancelled.
async function reconcileBlocked(pageSize = 100) {
  let changed = 0;
  let lastId = null;
  for (;;) {
    const page = await Job.find({ status: STATUS.BLOCKED, ...(lastId && { _id: { $gt: lastId } }) })
      .sort({ _id: 1 })
      .limit(pageSize);
    if (page.length === 0) break;
    for (const job of page) {
      const result = await evaluateBlocked(job);
      if (result === 'released' || result === 'cancelled') changed++;
    }
    lastId = page[page.length - 1]._id;
  }
  return changed;
}

module.exports = { evaluateBlocked, advanceDependents, reconcileBlocked };