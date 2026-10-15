jest.mock('../src/models/Job', () => ({ findOneAndUpdate: jest.fn(), findById: jest.fn() }));
const Job = require('../src/models/Job');
const { claimById, claimNext } = require('../src/services/jobService');

beforeEach(() => jest.resetAllMocks());

describe('claimById', () => {
  test('claims exactly that job, with the same runnable rules as claimNext', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ _id: 'j1' });
    const result = await claimById('j1', 'w1', 30000);

    expect(result).toEqual({ job: { _id: 'j1' }, reason: null });
    const [filter, update, options] = Job.findOneAndUpdate.mock.calls[0];
    expect(filter._id).toBe('j1');
    expect(filter.$or[0].status.$in).toEqual(['PENDING', 'RETRYING']);
    expect(filter.$or[1].status).toBe('RUNNING');
    expect(filter.$or[1].$expr).toEqual({ $lt: ['$attempts', '$maxAttempts'] });
    expect(update.$set.status).toBe('RUNNING');
    expect(update.$set.lockedBy).toBe('w1');
    expect(update.$set.queuedAt).toBeNull();
    expect(update.$inc).toEqual({ attempts: 1 });
    expect(options.returnDocument).toBe('after');
    expect(Job.findById).not.toHaveBeenCalled(); // no extra read on success
  });

  test('explains a miss: finished job', async () => {
    Job.findOneAndUpdate.mockResolvedValue(null);
    Job.findById.mockResolvedValue({ status: 'SUCCESS' });
    await expect(claimById('j1', 'w1', 30000)).resolves.toEqual({ job: null, reason: 'FINISHED' });
  });

  test('explains a miss: another worker holds the lease', async () => {
    Job.findOneAndUpdate.mockResolvedValue(null);
    Job.findById.mockResolvedValue({ status: 'RUNNING', leaseExpiresAt: new Date(Date.now() + 60000), attempts: 1, maxAttempts: 3 });
    await expect(claimById('j1', 'w1', 30000)).resolves.toEqual({ job: null, reason: 'LEASED' });
  });

  test('explains a miss: job does not exist', async () => {
    Job.findOneAndUpdate.mockResolvedValue(null);
    Job.findById.mockResolvedValue(null);
    await expect(claimById('j1', 'w1', 30000)).resolves.toEqual({ job: null, reason: 'MISSING' });
  });
});

test('claimNext also clears queuedAt when it claims', async () => {
  Job.findOneAndUpdate.mockResolvedValue({ _id: 'j1' });
  await claimNext('w1', 30000);
  expect(Job.findOneAndUpdate.mock.calls[0][1].$set.queuedAt).toBeNull();
});