// Pure logic: when a worker could NOT claim the job a queue message pointed at,
// work out why, and whether the message should be deleted or left to come back later.

const DISCARD = new Set(['MISSING', 'FINISHED', 'BLOCKED', 'EXHAUSTED']);

function whyNotClaimed(job, now = new Date()) {
  if (!job) return 'MISSING'; // the job was deleted

  switch (job.status) {
    case 'SUCCESS':
    case 'FAILED':
    case 'CANCELLED':
      return 'FINISHED'; // already done: this message is a leftover duplicate
    case 'BLOCKED':
      return 'BLOCKED'; // should not be queued yet
    case 'PENDING':
    case 'RETRYING':
      return 'NOT_DUE'; // its run time has not arrived yet
    case 'RUNNING':
      // Lease expired and no attempts left: nobody may run it again (the reaper will fail it).
      if (job.leaseExpiresAt && job.leaseExpiresAt < now && job.attempts >= job.maxAttempts) return 'EXHAUSTED';
      return 'LEASED'; // another worker owns it right now
    default:
      return 'FINISHED';
  }
}

// Delete the message for these reasons. For LEASED and NOT_DUE we keep it: if the other
// worker died, this message coming back is exactly what recovers the job.
const shouldDiscard = (reason) => DISCARD.has(reason);

module.exports = { whyNotClaimed, shouldDiscard };