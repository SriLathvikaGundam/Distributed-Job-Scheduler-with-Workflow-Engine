jest.mock('../src/models/Job', () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
const Job = require('../src/models/Job');
const { createJob, cancelJob, retryFailedJob } = require('../src/services/jobService');

beforeEach(() => jest.resetAllMocks());

describe('createJob', () => {
  test('without a key it just inserts, and never stores a null key', async () => {
    Job.create.mockResolvedValue({ _id: '1' });
    const result = await createJob({ type: 'echo' });

    expect(result).toEqual({ job: { _id: '1' }, created: true });
    expect(Job.findOne).not.toHaveBeenCalled();
    expect(Job.create.mock.calls[0][0]).not.toHaveProperty('idempotencyKey');
  });

  test('with a key it has seen, it returns the existing job and inserts nothing', async () => {
    Job.findOne.mockResolvedValue({ _id: 'old' });
    const result = await createJob({ type: 'echo', idempotencyKey: 'k1' });

    expect(result).toEqual({ job: { _id: 'old' }, created: false });
    expect(Job.create).not.toHaveBeenCalled();
  });

  test('when two requests race, the loser gets the winner\'s job', async () => {
    Job.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: 'winner' });
    Job.create.mockRejectedValue({ code: 11000 });

    const result = await createJob({ type: 'echo', idempotencyKey: 'k1' });
    expect(result).toEqual({ job: { _id: 'winner' }, created: false });
  });

  test('other database errors are not swallowed', async () => {
    Job.create.mockRejectedValue(new Error('db down'));
    await expect(createJob({ type: 'echo', idempotencyKey: 'k1' })).rejects.toThrow('db down');
  });
});

describe('cancelJob', () => {
  test('only matches PENDING or RETRYING jobs, in one atomic update', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ status: 'CANCELLED' });
    await cancelJob('j1');

    const [filter, update] = Job.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 'j1', status: { $in: ['PENDING', 'RETRYING'] } });
    expect(update.$set.status).toBe('CANCELLED');
    expect(update.$set.finishedAt).toBeInstanceOf(Date);
  });
});

describe('retryFailedJob', () => {
  test('only matches FAILED jobs and resets their attempts', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ status: 'PENDING' });
    await retryFailedJob('j1');

    const [filter, update] = Job.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 'j1', status: 'FAILED' });
    expect(update.$set.status).toBe('PENDING');
    expect(update.$set.attempts).toBe(0);
    expect(update.$unset).toHaveProperty('finishedAt');
    expect(update.$unset).toHaveProperty('result');
  });
});