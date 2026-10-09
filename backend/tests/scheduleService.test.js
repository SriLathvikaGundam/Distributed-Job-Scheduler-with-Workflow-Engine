jest.mock('../src/models/Schedule', () => ({
  create: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../src/services/jobService');

const Schedule = require('../src/models/Schedule');
const { createJob } = require('../src/services/jobService');
const service = require('../src/services/scheduleService');

beforeEach(() => jest.resetAllMocks());

const makeSchedule = (over = {}) => ({
  _id: 's1',
  name: 'every-minute',
  type: 'echo',
  payload: { a: 1 },
  cron: '* * * * *',
  timezone: 'UTC',
  maxAttempts: 3,
  nextRunAt: new Date('2030-01-01T10:00:00Z'),
  ...over,
});

describe('createSchedule', () => {
  test('stores the first nextRunAt in the future', async () => {
    Schedule.create.mockResolvedValue({ _id: 's1' });
    await service.createSchedule({ name: 'n', type: 'echo', cron: '*/5 * * * *' });

    const doc = Schedule.create.mock.calls[0][0];
    expect(doc.nextRunAt).toBeInstanceOf(Date);
    expect(doc.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(doc.timezone).toBe('UTC');
  });
});

describe('findDue', () => {
  test('asks only for enabled schedules whose time has come, oldest first', async () => {
    const limit = jest.fn().mockResolvedValue([]);
    const sort = jest.fn(() => ({ limit }));
    Schedule.find.mockReturnValue({ sort });

    const now = new Date();
    await service.findDue(now, 10);

    expect(Schedule.find).toHaveBeenCalledWith({ enabled: true, nextRunAt: { $lte: now } });
    expect(sort).toHaveBeenCalledWith({ nextRunAt: 1 });
    expect(limit).toHaveBeenCalledWith(10);
  });
});

describe('fireSchedule', () => {
  test('creates the job with a deterministic key and the scheduled fire time', async () => {
    createJob.mockResolvedValue({ job: { _id: 'j1' }, created: true });
    Schedule.findOneAndUpdate.mockResolvedValue({ _id: 's1' });
    const s = makeSchedule();

    await service.fireSchedule(s, new Date('2030-01-01T10:00:20Z'));

    expect(createJob).toHaveBeenCalledWith({
      type: 'echo',
      payload: { a: 1 },
      maxAttempts: 3,
      runAt: s.nextRunAt,
      idempotencyKey: 'schedule:s1:2030-01-01T10:00:00.000Z',
    });
  });

  test('advances nextRunAt only if nobody else already did', async () => {
    createJob.mockResolvedValue({ job: { _id: 'j1' }, created: true });
    Schedule.findOneAndUpdate.mockResolvedValue({ _id: 's1' });
    const s = makeSchedule();

    const result = await service.fireSchedule(s, new Date('2030-01-01T10:00:20Z'));

    const [filter, update] = Schedule.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 's1', nextRunAt: s.nextRunAt });
    expect(update.$set.nextRunAt.toISOString()).toBe('2030-01-01T10:01:00.000Z');
    expect(update.$set.lastRunAt).toEqual(s.nextRunAt);
    expect(result.advanced).toBe(true);
  });

  test('after downtime it fires once and skips the missed runs', async () => {
    createJob.mockResolvedValue({ job: { _id: 'j1' }, created: true });
    Schedule.findOneAndUpdate.mockResolvedValue({ _id: 's1' });
    const s = makeSchedule({ nextRunAt: new Date('2030-01-01T10:00:00Z') });

    // The scheduler was down for 7 minutes: seven runs were missed.
    await service.fireSchedule(s, new Date('2030-01-01T10:07:30Z'));

    expect(createJob).toHaveBeenCalledTimes(1);
    const update = Schedule.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.nextRunAt.toISOString()).toBe('2030-01-01T10:08:00.000Z');
  });

  test('reports advanced=false when another scheduler got there first', async () => {
    createJob.mockResolvedValue({ job: { _id: 'j1' }, created: false });
    Schedule.findOneAndUpdate.mockResolvedValue(null);

    const result = await service.fireSchedule(makeSchedule(), new Date('2030-01-01T10:00:20Z'));
    expect(result).toEqual({ job: { _id: 'j1' }, created: false, advanced: false });
  });

  test('does not advance if creating the job failed', async () => {
    createJob.mockRejectedValue(new Error('db down'));
    await expect(service.fireSchedule(makeSchedule())).rejects.toThrow('db down');
    expect(Schedule.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('resumeSchedule', () => {
  test('re-enables and recomputes nextRunAt from now', async () => {
    Schedule.findById.mockResolvedValue(makeSchedule({ cron: '*/5 * * * *' }));
    Schedule.findOneAndUpdate.mockResolvedValue({ enabled: true });

    await service.resumeSchedule('s1');

    const update = Schedule.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.enabled).toBe(true);
    expect(update.$set.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  test('returns null for an unknown schedule', async () => {
    Schedule.findById.mockResolvedValue(null);
    await expect(service.resumeSchedule('s1')).resolves.toBeNull();
    expect(Schedule.findOneAndUpdate).not.toHaveBeenCalled();
  });
});