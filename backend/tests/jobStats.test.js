jest.mock('../src/models/Job', () => ({ aggregate: jest.fn() }));
const Job = require('../src/models/Job');
const { jobStats } = require('../src/services/jobService');

beforeEach(() => jest.resetAllMocks());

describe('jobStats', () => {
  test('counts every status, with zero for the ones that have no jobs', async () => {
    Job.aggregate.mockResolvedValue([{ _id: 'SUCCESS', count: 10 }, { _id: 'FAILED', count: 2 }]);

    const stats = await jobStats();
    expect(stats.counts).toEqual({
      PENDING: 0, BLOCKED: 0, RUNNING: 0, RETRYING: 0, SUCCESS: 10, FAILED: 2, CANCELLED: 0,
    });
    expect(stats.total).toBe(12);
  });

  test('an empty collection gives all zeros', async () => {
    Job.aggregate.mockResolvedValue([]);
    const stats = await jobStats();
    expect(stats.total).toBe(0);
    expect(Object.values(stats.counts).every((n) => n === 0)).toBe(true);
  });

  test('ignores a status it does not know instead of breaking', async () => {
    Job.aggregate.mockResolvedValue([{ _id: 'MYSTERY', count: 5 }, { _id: 'RUNNING', count: 1 }]);
    const stats = await jobStats();
    expect(stats.counts).not.toHaveProperty('MYSTERY');
    expect(stats.total).toBe(1);
  });

  test('asks MongoDB to group the jobs by status', async () => {
    Job.aggregate.mockResolvedValue([]);
    await jobStats();
    expect(Job.aggregate).toHaveBeenCalledWith([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  });
});