jest.mock('../src/services/jobService');
const service = require('../src/services/jobService');
const Worker = require('../src/worker/worker');

const silent = { info() {}, warn() {}, error() {} };
const job = { _id: 'j1', type: 'echo', payload: { a: 1 }, attempts: 1, lockedBy: 'w1' };

function makeWorker(handlers, extra = {}) {
  return new Worker({ workerId: 'w1', handlers, log: silent, ...extra });
}

beforeEach(() => {
  jest.resetAllMocks();
  service.completeJob.mockResolvedValue({});
  service.failJob.mockResolvedValue({ status: 'RETRYING' });
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