const Job = require('../../src/models/Job');
const service = require('../../src/services/jobService');
const { makeWorker, runUntil } = require('../helpers/integration');
const { waitFor, sleep } = require('../helpers/waitFor');

const statusOf = async (id) => (await Job.findById(id)).status;

test('a job runs to SUCCESS and its result is stored', async () => {
  const { job } = await service.createJob({ type: 'echo', payload: { a: 1 } });
  const worker = makeWorker({ echo: async (payload) => ({ got: payload }) });

  await runUntil(worker, async () => (await statusOf(job._id)) === 'SUCCESS', 'the job to succeed');

  const saved = await Job.findById(job._id);
  expect(saved.result).toEqual({ got: { a: 1 } });
  expect(saved.attempts).toBe(1);
  expect(saved.lockedBy).toBeNull();
  expect(saved.finishedAt).toBeInstanceOf(Date);
});

test('a failing job is retried, then ends FAILED with its last error', async () => {
  const { job } = await service.createJob({ type: 'bad', maxAttempts: 2 });
  let calls = 0;
  const worker = makeWorker({ bad: async () => { calls++; throw new Error('nope'); } });

  await runUntil(worker, async () => (await statusOf(job._id)) === 'FAILED', 'the job to fail');

  const saved = await Job.findById(job._id);
  expect(calls).toBe(2);
  expect(saved.attempts).toBe(2);
  expect(saved.lastError).toBe('nope');
});

test('a job with no registered handler fails with a clear error', async () => {
  const { job } = await service.createJob({ type: 'mystery', maxAttempts: 1 });
  const worker = makeWorker({});

  await runUntil(worker, async () => (await statusOf(job._id)) === 'FAILED', 'the job to fail');
  expect((await Job.findById(job._id)).lastError).toMatch(/No handler registered/);
});

test('a worker never runs more jobs at once than its concurrency', async () => {
  await Job.insertMany(Array.from({ length: 6 }, () => ({ type: 'slow' })));
  let running = 0;
  let maxRunning = 0;
  const worker = makeWorker(
    {
      slow: async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await sleep(100);
        running--;
        return {};
      },
    },
    { concurrency: 2 }
  );

  await runUntil(worker, async () => (await Job.countDocuments({ status: 'SUCCESS' })) === 6, 'all jobs to finish');
  expect(maxRunning).toBe(2);
});

test('two workers share the queue: every job runs exactly once', async () => {
  await Job.insertMany(Array.from({ length: 20 }, (_, i) => ({ type: 'count', payload: { i } })));
  const runs = new Map();
  const handlers = {
    count: async ({ i }) => {
      runs.set(i, (runs.get(i) || 0) + 1);
      await sleep(10);
      return {};
    },
  };
  const w1 = makeWorker(handlers);
  const w2 = makeWorker(handlers);

  w1.start();
  w2.start();
  try {
    await waitFor(async () => (await Job.countDocuments({ status: 'SUCCESS' })) === 20, { message: '20 jobs to finish' });
  } finally {
    await Promise.all([w1.stop(), w2.stop()]);
  }

  expect(runs.size).toBe(20);
  expect([...runs.values()].every((n) => n === 1)).toBe(true);
});

test('a worker takes over a job whose previous worker died', async () => {
  const dead = await Job.create({
    type: 'echo',
    status: 'RUNNING',
    lockedBy: 'dead-worker',
    attempts: 1,
    leaseExpiresAt: new Date(Date.now() - 1000),
  });
  const worker = makeWorker({ echo: async () => ({ recovered: true }) });

  await runUntil(worker, async () => (await statusOf(dead._id)) === 'SUCCESS', 'the job to be recovered');

  const saved = await Job.findById(dead._id);
  expect(saved.attempts).toBe(2);
  expect(saved.result).toEqual({ recovered: true });
});

test('housekeeping fails a crashed job that has no attempts left', async () => {
  const lost = await Job.create({
    type: 'echo',
    status: 'RUNNING',
    lockedBy: 'dead-worker',
    attempts: 3,
    maxAttempts: 3,
    leaseExpiresAt: new Date(Date.now() - 1000),
  });
  const worker = makeWorker({ echo: async () => ({}) });

  await runUntil(worker, async () => (await statusOf(lost._id)) === 'FAILED', 'housekeeping to fail the job');
  expect((await Job.findById(lost._id)).lastError).toMatch(/Worker lost/);
});

test('graceful shutdown lets a running job finish', async () => {
  const { job } = await service.createJob({ type: 'slow' });
  const worker = makeWorker({ slow: async () => { await sleep(300); return { done: true }; } });

  worker.start();
  await waitFor(async () => (await statusOf(job._id)) === 'RUNNING', { message: 'the job to start' });
  await worker.stop(); // must wait for the job

  expect(await statusOf(job._id)).toBe('SUCCESS');
});