jest.mock('../src/services/scheduleService');
const schedules = require('../src/services/scheduleService');
const Scheduler = require('../src/scheduler/scheduler');

const silent = { info() {}, warn() {}, error() {} };
const makeScheduler = (extra = {}) => new Scheduler({ log: silent, tickMs: 5, ...extra });

beforeEach(() => jest.resetAllMocks());

describe('Scheduler.tick', () => {
  test('fires every due schedule and counts the jobs it created', async () => {
    schedules.findDue.mockResolvedValue([
      { _id: 'a', name: 'a', type: 'echo' },
      { _id: 'b', name: 'b', type: 'echo' },
    ]);
    schedules.fireSchedule.mockResolvedValue({ job: { _id: 'j' }, created: true, advanced: true });

    await expect(makeScheduler().tick()).resolves.toBe(2);
    expect(schedules.fireSchedule).toHaveBeenCalledTimes(2);
  });

  test('does not count jobs that another scheduler already created', async () => {
    schedules.findDue.mockResolvedValue([{ _id: 'a', name: 'a', type: 'echo' }]);
    schedules.fireSchedule.mockResolvedValue({ job: { _id: 'j' }, created: false, advanced: false });

    await expect(makeScheduler().tick()).resolves.toBe(0);
  });

  test('one failing schedule does not stop the others', async () => {
    schedules.findDue.mockResolvedValue([
      { _id: 'a', name: 'a', type: 'echo' },
      { _id: 'b', name: 'b', type: 'echo' },
    ]);
    schedules.fireSchedule
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ job: { _id: 'j' }, created: true, advanced: true });

    await expect(makeScheduler().tick()).resolves.toBe(1);
    expect(schedules.fireSchedule).toHaveBeenCalledTimes(2);
  });

  test('does nothing when no schedule is due', async () => {
    schedules.findDue.mockResolvedValue([]);
    await expect(makeScheduler().tick()).resolves.toBe(0);
    expect(schedules.fireSchedule).not.toHaveBeenCalled();
  });
});

describe('Scheduler loop', () => {
  test('keeps ticking until stopped, and stop() returns promptly', async () => {
    schedules.findDue.mockResolvedValue([]);
    const scheduler = makeScheduler({ tickMs: 10000 }); // long wait that stop() must cut short

    scheduler.start();
    await new Promise((r) => setTimeout(r, 30));
    const began = Date.now();
    await scheduler.stop();

    expect(Date.now() - began).toBeLessThan(1000);
    expect(schedules.findDue).toHaveBeenCalled();
  });
});