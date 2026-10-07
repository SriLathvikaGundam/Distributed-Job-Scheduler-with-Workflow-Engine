jest.mock('../src/models/Job', () => ({ findOneAndUpdate: jest.fn() }));
const Job = require('../src/models/Job');
const { claimNext } = require('../src/services/jobService');

beforeEach(() => jest.resetAllMocks());

describe('claimNext', () => {
  test('claims waiting jobs whose time has come, flipping them to RUNNING', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ _id: '1' });
    await claimNext('worker-1', 30000);

    const [filter, update, options] = Job.findOneAndUpdate.mock.calls[0];
    const waiting = filter.$or[0];
    expect(waiting.status.$in).toEqual(['PENDING', 'RETRYING']);
    expect(waiting.runAt.$lte).toBeInstanceOf(Date);
    expect(update.$set.status).toBe('RUNNING');
    expect(update.$set.lockedBy).toBe('worker-1');
    expect(update.$inc).toEqual({ attempts: 1 });
    expect(options.sort).toEqual({ runAt: 1 });
  });

  test('also re-claims RUNNING jobs whose lease expired while attempts remain', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ _id: '1' });
    await claimNext('worker-1', 30000);

    const crashed = Job.findOneAndUpdate.mock.calls[0][0].$or[1];
    expect(crashed.status).toBe('RUNNING');
    expect(crashed.leaseExpiresAt.$lt).toBeInstanceOf(Date);
    expect(crashed.$expr).toEqual({ $lt: ['$attempts', '$maxAttempts'] });
  });

  test('sets the lease to now + leaseMs', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ _id: '1' });
    const before = Date.now();
    await claimNext('worker-1', 30000);

    const lease = Job.findOneAndUpdate.mock.calls[0][1].$set.leaseExpiresAt.getTime();
    expect(lease).toBeGreaterThanOrEqual(before + 30000);
    expect(lease).toBeLessThan(before + 30000 + 1000);
  });

  test('returns null when nothing is ready', async () => {
    Job.findOneAndUpdate.mockResolvedValue(null);
    await expect(claimNext('worker-1', 30000)).resolves.toBeNull();
  });
});