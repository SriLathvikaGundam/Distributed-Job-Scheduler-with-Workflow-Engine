jest.mock('../src/models/Job', () => ({ findOneAndUpdate: jest.fn(), updateMany: jest.fn() }));
const Job = require('../src/models/Job');
const { claimForDispatch, releaseDispatch } = require('../src/services/dispatchService');

beforeEach(() => jest.resetAllMocks());

describe('claimForDispatch', () => {
  const now = new Date('2030-01-01T10:00:00Z');

  test('atomically marks one ready job as queued', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ _id: 'j1' });
    await expect(claimForDispatch(now, 300000)).resolves.toEqual({ _id: 'j1' });

    const [, update, options] = Job.findOneAndUpdate.mock.calls[0];
    expect(update).toEqual({ $set: { queuedAt: now } });
    expect(options).toEqual({ sort: { runAt: 1 }, returnDocument: 'after' });
  });

  test('picks waiting jobs that are due and not queued recently', async () => {
    Job.findOneAndUpdate.mockResolvedValue(null);
    await claimForDispatch(now, 300000);

    const waiting = Job.findOneAndUpdate.mock.calls[0][0].$or[0];
    const staleBefore = new Date(now.getTime() - 300000);
    expect(waiting.status.$in).toEqual(['PENDING', 'RETRYING']);
    expect(waiting.runAt).toEqual({ $lte: now });
    expect(waiting.$or).toEqual([{ queuedAt: null }, { queuedAt: { $lte: staleBefore } }]);
  });

  test('also picks RUNNING jobs whose lease expired long ago, while attempts remain', async () => {
    Job.findOneAndUpdate.mockResolvedValue(null);
    await claimForDispatch(now, 300000);

    const crashed = Job.findOneAndUpdate.mock.calls[0][0].$or[1];
    expect(crashed.status).toBe('RUNNING');
    expect(crashed.leaseExpiresAt).toEqual({ $lt: new Date(now.getTime() - 300000) });
    expect(crashed.$expr).toEqual({ $lt: ['$attempts', '$maxAttempts'] });
    expect(crashed.$or).toBeDefined();
  });

  test('never picks BLOCKED jobs', async () => {
    Job.findOneAndUpdate.mockResolvedValue(null);
    await claimForDispatch(now, 300000);
    const text = JSON.stringify(Job.findOneAndUpdate.mock.calls[0][0]);
    expect(text).not.toMatch(/BLOCKED/);
  });
});

describe('releaseDispatch', () => {
  test('clears the queued mark on the given jobs', async () => {
    Job.updateMany.mockResolvedValue({});
    await releaseDispatch(['a', 'b']);
    expect(Job.updateMany).toHaveBeenCalledWith({ _id: { $in: ['a', 'b'] } }, { $set: { queuedAt: null } });
  });

  test('does nothing for an empty list', async () => {
    await releaseDispatch([]);
    expect(Job.updateMany).not.toHaveBeenCalled();
  });
});