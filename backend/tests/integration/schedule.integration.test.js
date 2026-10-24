const Job = require('../../src/models/Job');
const Schedule = require('../../src/models/Schedule');
const Scheduler = require('../../src/scheduler/scheduler');
const { silent } = require('../helpers/integration');

const makeSchedule = (over = {}) =>
  Schedule.create({
    name: 'every-minute',
    type: 'echo',
    payload: { a: 1 },
    maxAttempts: 2,
    cron: '* * * * *',
    timezone: 'UTC',
    nextRunAt: new Date(Date.now() - 5000), // due 5 seconds ago
    ...over,
  });
const makeScheduler = () => new Scheduler({ log: silent });

test('two schedulers ticking at the same moment create exactly one job', async () => {
  const schedule = await makeSchedule();

  const [x, y] = await Promise.all([makeScheduler().tick(), makeScheduler().tick()]);

  expect(x + y).toBe(1);
  const jobs = await Job.find({});
  expect(jobs).toHaveLength(1);
  expect(jobs[0].idempotencyKey).toBe(`schedule:${schedule._id}:${schedule.nextRunAt.toISOString()}`);

  const updated = await Schedule.findById(schedule._id);
  expect(updated.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  expect(updated.lastRunAt.toISOString()).toBe(schedule.nextRunAt.toISOString());
});

test('the job it creates is ready to run and carries the schedule settings', async () => {
  await makeSchedule();
  await makeScheduler().tick();

  const job = await Job.findOne({});
  expect(job.status).toBe('PENDING');
  expect(job.type).toBe('echo');
  expect(job.payload).toEqual({ a: 1 });
  expect(job.maxAttempts).toBe(2);
  expect(job.runAt.getTime()).toBeLessThanOrEqual(Date.now());
});

test('after downtime it fires once and skips the missed runs', async () => {
  const schedule = await makeSchedule({ nextRunAt: new Date(Date.now() - 10 * 60 * 1000) }); // 10 runs missed

  expect(await makeScheduler().tick()).toBe(1);
  expect(await makeScheduler().tick()).toBe(0); // not due again until the next minute
  expect(await Job.countDocuments({})).toBe(1);

  const updated = await Schedule.findById(schedule._id);
  expect(updated.nextRunAt.getTime()).toBeGreaterThan(Date.now());
});

test('a paused schedule never fires', async () => {
  await makeSchedule({ enabled: false });
  expect(await makeScheduler().tick()).toBe(0);
  expect(await Job.countDocuments({})).toBe(0);
});

test('a schedule that is not due yet does not fire', async () => {
  await makeSchedule({ nextRunAt: new Date(Date.now() + 60 * 60 * 1000) });
  expect(await makeScheduler().tick()).toBe(0);
  expect(await Job.countDocuments({})).toBe(0);
});