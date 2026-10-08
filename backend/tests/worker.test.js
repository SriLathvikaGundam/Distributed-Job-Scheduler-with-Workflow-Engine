jest.mock('../src/services/jobService');
const service = require('../src/services/jobService');
const Worker = require('../src/worker/worker');

const silent = { info() {}, warn() {}, error() {} };
const job = { _id: 'j1', type: 'echo', payload: { a: 1 }, attempts: 1, maxAttempts: 3, lockedBy: 'w1' };

function makeWorker(handlers, extra = {}) {
  return new Worker({ workerId: 'w1', handlers, log: silent, ...extra });
}

// Poll until a condition is true (or fail after ~2 seconds).
async function waitFor(condition, timeoutMs = 2000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  jest.resetAllMocks();
  service.completeJob.mockResolvedValue({});
  service.failJob.mockResolvedValue({ status: 'RETRYING' });
  service.reapExhausted.mockResolvedValue(0);
});

test('runOnce returns false when no job is ready', async () => {
  service.claimNext.mockResolvedValue(null);
  await expect(makeWorker({}).runOnce()).resolves.toBe(false);
  expect(service.completeJob).not.toHaveBeenCalled();
});

test('a successful handler completes the job with its result', async () => {
  service.claimNext.mockResolvedValue(job);
  const handler = jest.fn().mockResolvedValue({ done: true });

  await expect(makeWorker({ echo: handler }).runOnce()).resolves.toBe(true);
  expect(handler).toHaveBeenCalledWith({ a: 1 }, expect.objectContaining({ jobId: 'j1' }));
  expect(service.completeJob).toHaveBeenCalledWith(job, { done: true });
  expect(service.failJob).not.toHaveBeenCalled();
});

test('a throwing handler fails the job', async () => {
  service.claimNext.mockResolvedValue(job);
  const err = new Error('boom');

  await makeWorker({ echo: jest.fn().mockRejectedValue(err) }).runOnce();
  expect(service.failJob).toHaveBeenCalledWith(job, err);
  expect(service.completeJob).not.toHaveBeenCalled();
});

test('an unknown job type fails the job', async () => {
  service.claimNext.mockResolvedValue({ ...job, type: 'nope' });

  await makeWorker({}).runOnce();
  const err = service.failJob.mock.calls[0][1];
  expect(err.message).toMatch(/No handler registered/);
});

test('a handler that hangs is failed by the timeout', async () => {
  service.claimNext.mockResolvedValue(job);
  const hang = () => new Promise(() => {});

  await makeWorker({ echo: hang }, { jobTimeoutMs: 30 }).runOnce();
  const err = service.failJob.mock.calls[0][1];
  expect(err.message).toMatch(/timed out/);
});

test('refuses a job timeout that is not shorter than the lease', () => {
  expect(() => makeWorker({}, { leaseMs: 1000, jobTimeoutMs: 1000 })).toThrow(/must be less than leaseMs/);
});

test('refuses a concurrency below 1', () => {
  expect(() => makeWorker({}, { concurrency: 0 })).toThrow(/concurrency/);
});

test('maybeReap runs at most once per lease period', async () => {
  const worker = makeWorker({});
  await worker.maybeReap();
  await worker.maybeReap();
  expect(service.reapExhausted).toHaveBeenCalledTimes(1);
});

test('never runs more than `concurrency` jobs at once, but uses all the slots', async () => {
  let running = 0;
  let maxRunning = 0;
  const handler = async () => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => setTimeout(r, 20));
    running--;
    return {};
  };

  let given = 0;
  service.claimNext.mockImplementation(async () => (given < 6 ? { ...job, _id: `j${given++}` } : null));

  const worker = makeWorker({ echo: handler }, { concurrency: 2, pollMs: 5 });
  worker.start();
  await waitFor(() => service.completeJob.mock.calls.length === 6);
  await worker.stop();

  expect(maxRunning).toBe(2);
  expect(service.completeJob).toHaveBeenCalledTimes(6);
});

test('stop() waits for running jobs to finish before resolving', async () => {
  let finished = false;
  const handler = async () => {
    await new Promise((r) => setTimeout(r, 50));
    finished = true;
    return {};
  };

  let given = false;
  service.claimNext.mockImplementation(async () => {
    if (given) return null;
    given = true;
    return job;
  });

  const worker = makeWorker({ echo: handler }, { pollMs: 5 });
  worker.start();
  await waitFor(() => worker.active.size === 1);
  await worker.stop();

  expect(finished).toBe(true);
  expect(service.completeJob).toHaveBeenCalledTimes(1);
});

test('stop() cuts an idle wait short instead of waiting for the next poll', async () => {
  service.claimNext.mockResolvedValue(null);

  const worker = makeWorker({}, { pollMs: 10000 });
  worker.start();
  await new Promise((r) => setTimeout(r, 20));

  const began = Date.now();
  await worker.stop();
  expect(Date.now() - began).toBeLessThan(1000);
});