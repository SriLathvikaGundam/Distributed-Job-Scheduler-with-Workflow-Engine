jest.mock('../src/models/Job', () => ({ findOneAndUpdate: jest.fn() }));
const Job = require('../src/models/Job');
const { completeJob, failJob } = require('../src/services/jobService');

beforeEach(() => jest.resetAllMocks());

const makeJob = (over = {}) => ({ _id: 'j1', attempts: 1, maxAttempts: 3, lockedBy: 'w1', ...over });

describe('completeJob', () => {
  test('marks SUCCESS only if this worker still owns the running job', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ status: 'SUCCESS' });
    await completeJob(makeJob(), { ok: true });

    const [filter, update] = Job.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 'j1', status: 'RUNNING', lockedBy: 'w1' });
    expect(update.$set.status).toBe('SUCCESS');
    expect(update.$set.result).toEqual({ ok: true });
    expect(update.$set.lockedBy).toBeNull();
  });

  test('returns null when the lease was lost', async () => {
    Job.findOneAndUpdate.mockResolvedValue(null);
    await expect(completeJob(makeJob(), {})).resolves.toBeNull();
  });
});

describe('failJob', () => {
  test('schedules a retry when attempts remain', async () => {
    Job.findOneAndUpdate.mockResolvedValue({});
    await failJob(makeJob({ attempts: 1, maxAttempts: 3 }), new Error('boom'));

    const [filter, update] = Job.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 'j1', status: 'RUNNING', lockedBy: 'w1' });
    expect(update.$set.status).toBe('RETRYING');
    expect(update.$set.lastError).toBe('boom');
    expect(update.$set.runAt).toBeInstanceOf(Date);
    expect(update.$set.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(update.$set.finishedAt).toBeUndefined();
  });

  test('gives up with FAILED when attempts are exhausted', async () => {
    Job.findOneAndUpdate.mockResolvedValue({});
    await failJob(makeJob({ attempts: 3, maxAttempts: 3 }), new Error('boom'));

    const update = Job.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.status).toBe('FAILED');
    expect(update.$set.finishedAt).toBeInstanceOf(Date);
    expect(update.$set.runAt).toBeUndefined();
  });

    test('retry delay grows with the attempt number', async () => {
    Job.findOneAndUpdate.mockResolvedValue({});

    await failJob(makeJob({ attempts: 1, maxAttempts: 10 }), new Error('x'));
    const first = Job.findOneAndUpdate.mock.calls[0][1].$set.runAt.getTime() - Date.now();

    await failJob(makeJob({ attempts: 6, maxAttempts: 10 }), new Error('x'));
    const sixth = Job.findOneAndUpdate.mock.calls[1][1].$set.runAt.getTime() - Date.now();

    expect(first).toBeLessThanOrEqual(1000);
    expect(sixth).toBeGreaterThanOrEqual(16000); // attempt 6: exp = 32s, delay is 16 to 32 s
  });
});