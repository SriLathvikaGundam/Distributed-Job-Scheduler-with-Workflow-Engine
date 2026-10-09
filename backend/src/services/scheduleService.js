const Schedule = require('../models/Schedule');
const { createJob } = require('./jobService');
const { nextRun } = require('../core/cron');

async function createSchedule({ name, type, payload = {}, cron, timezone = 'UTC', maxAttempts }) {
  return Schedule.create({
    name,
    type,
    payload,
    cron,
    timezone,
    ...(maxAttempts && { maxAttempts }),
    nextRunAt: nextRun(cron, new Date(), timezone),
  });
}

const getSchedule = (id) => Schedule.findById(id);
const listSchedules = () => Schedule.find().sort({ createdAt: -1 });
const deleteSchedule = (id) => Schedule.findByIdAndDelete(id);

const pauseSchedule = (id) =>
  Schedule.findOneAndUpdate({ _id: id }, { $set: { enabled: false } }, { returnDocument: 'after' });

// Resuming recomputes nextRunAt from NOW, so a long pause does not cause a burst of old fires.
async function resumeSchedule(id) {
  const schedule = await Schedule.findById(id);
  if (!schedule) return null;
  return Schedule.findOneAndUpdate(
    { _id: id },
    { $set: { enabled: true, nextRunAt: nextRun(schedule.cron, new Date(), schedule.timezone) } },
    { returnDocument: 'after' }
  );
}

const findDue = (now, limit = 50) =>
  Schedule.find({ enabled: true, nextRunAt: { $lte: now } }).sort({ nextRunAt: 1 }).limit(limit);

/**
 * Fire one due schedule:
 *   1. create the job, using a key built from the schedule id + the fire time
 *   2. move nextRunAt forward, but only if nobody else already did
 *
 * Safe if the scheduler crashes between the steps, or if two schedulers race:
 * the job key makes step 1 repeatable, and the nextRunAt check makes step 2 single-winner.
 */
async function fireSchedule(schedule, now = new Date()) {
  const fireTime = schedule.nextRunAt;
  const key = `schedule:${schedule._id}:${fireTime.toISOString()}`;

  const { job, created } = await createJob({
    type: schedule.type,
    payload: schedule.payload,
    maxAttempts: schedule.maxAttempts,
    runAt: fireTime,
    idempotencyKey: key,
  });

  // Next fire is computed from NOW, not from fireTime: if the scheduler was down and
  // missed several runs, we fire once and skip the rest instead of flooding the queue.
  const advanced = await Schedule.findOneAndUpdate(
    { _id: schedule._id, nextRunAt: fireTime },
    { $set: { nextRunAt: nextRun(schedule.cron, now, schedule.timezone), lastRunAt: fireTime } },
    { returnDocument: 'after' }
  );

  return { job, created, advanced: Boolean(advanced) };
}

module.exports = {
  createSchedule,
  getSchedule,
  listSchedules,
  deleteSchedule,
  pauseSchedule,
  resumeSchedule,
  findDue,
  fireSchedule,
};