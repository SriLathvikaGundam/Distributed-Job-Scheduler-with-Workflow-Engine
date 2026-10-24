const Job = require('../../src/models/Job');
const service = require('../../src/services/jobService');

const seed = (count) =>
  Job.insertMany(Array.from({ length: count }, (_, i) => ({ type: 'echo', payload: { i } })));
const ago = (ms) => new Date(Date.now() - ms);
const fromNow = (ms) => new Date(Date.now() + ms);

describe('atomic claiming (the Step 6 race, as an automated test)', () => {
  test('six concurrent claimers: every one of 100 jobs is claimed exactly once', async () => {
    await seed(100);

    const claimed = [];
    async function claimer(name) {
      for (;;) {
        const job = await service.claimNext(name, 30000);
        if (!job) return;
        claimed.push(String(job._id));
      }
    }
    await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(claimer));

    expect(claimed).toHaveLength(100);
    expect(new Set(claimed).size).toBe(100); // no job claimed twice
    expect(await Job.countDocuments({ status: 'RUNNING', attempts: 1 })).toBe(100);
  });

  test('ten workers claim the SAME job at once: exactly one wins', async () => {
    const job = await Job.create({ type: 'echo' });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => service.claimById(job._id, `worker-${i}`, 30000))
    );

    const winners = results.filter((r) => r.job);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => !r.job).every((r) => r.reason === 'LEASED')).toBe(true);

    const saved = await Job.findById(job._id);
    expect(saved.attempts).toBe(1);
    expect(saved.lockedBy).toBe(winners[0].job.lockedBy);
  });

  test('claiming clears the queued mark and sets a lease', async () => {
    await Job.create({ type: 'echo', queuedAt: new Date() });
    const job = await service.claimNext('w1', 30000);

    expect(job.status).toBe('RUNNING');
    expect(job.queuedAt).toBeNull();
    expect(job.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test('a job scheduled for the future is not claimed yet', async () => {
    await Job.create({ type: 'echo', runAt: fromNow(60000) });
    expect(await service.claimNext('w1', 30000)).toBeNull();
  });

  test('a BLOCKED workflow step is never claimed', async () => {
    await Job.create({ type: 'echo', status: 'BLOCKED' });
    expect(await service.claimNext('w1', 30000)).toBeNull();
  });
});

describe('leases (crash recovery)', () => {
  test('a job whose lease expired is claimed again; a live lease is left alone', async () => {
    const dead = await Job.create({ type: 'echo', status: 'RUNNING', lockedBy: 'dead', attempts: 1, leaseExpiresAt: ago(1000) });
    const alive = await Job.create({ type: 'echo', status: 'RUNNING', lockedBy: 'alive', attempts: 1, leaseExpiresAt: fromNow(60000) });

    const reclaimed = await service.claimNext('w1', 30000);
    expect(String(reclaimed._id)).toBe(String(dead._id));
    expect(reclaimed.attempts).toBe(2);
    expect(reclaimed.lockedBy).toBe('w1');

    expect(await service.claimNext('w2', 30000)).toBeNull(); // nothing else is claimable
    expect((await Job.findById(alive._id)).lockedBy).toBe('alive');
  });

  test('a crashed job with no attempts left is NOT claimed again', async () => {
    await Job.create({ type: 'echo', status: 'RUNNING', lockedBy: 'dead', attempts: 3, maxAttempts: 3, leaseExpiresAt: ago(1000) });
    expect(await service.claimNext('w1', 30000)).toBeNull();
  });

  test('a worker that lost its lease cannot overwrite the new owner', async () => {
    await Job.create({ type: 'echo' });
    const slow = await service.claimNext('slow-worker', 30000);

    // Time passes: the lease expires and another worker takes the job over.
    await Job.updateOne({ _id: slow._id }, { $set: { leaseExpiresAt: ago(1000) } });
    const fast = await service.claimNext('fast-worker', 30000);
    expect(fast.lockedBy).toBe('fast-worker');

    // The slow worker finally finishes. Both of its writes must be refused.
    expect(await service.completeJob(slow, { late: true })).toBeNull();
    expect(await service.failJob(slow, new Error('late'))).toBeNull();

    const saved = await Job.findById(slow._id);
    expect(saved.status).toBe('RUNNING');
    expect(saved.lockedBy).toBe('fast-worker');
    expect(saved.result).toBeUndefined();

    expect(await service.completeJob(fast, { ok: true })).not.toBeNull(); // the real owner can finish
  });
});