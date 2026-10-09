const schedules = require('../services/scheduleService');

class Scheduler {
  constructor({ tickMs = 1000, batchSize = 50, log = console } = {}) {
    this.tickMs = tickMs;
    this.batchSize = batchSize;
    this.log = log;
    this.running = false;
    this.loopPromise = null;
    this.timer = null;
    this.wakeUp = null;
  }

  // One pass: fire every schedule that is due. Returns how many jobs this pass created.
  async tick(now = new Date()) {
    const due = await schedules.findDue(now, this.batchSize);
    let fired = 0;
    for (const schedule of due) {
      try {
        const { job, created } = await schedules.fireSchedule(schedule, now);
        if (created) {
          fired++;
          this.log.info(`[scheduler] fired "${schedule.name}" -> ${schedule.type} job ${job._id}`);
        }
      } catch (err) {
        // One broken schedule must not stop the others.
        this.log.error(`[scheduler] failed to fire "${schedule.name}": ${err.message}`);
      }
    }
    return fired;
  }

  idleWait() {
    return new Promise((resolve) => {
      this.wakeUp = resolve;
      this.timer = setTimeout(resolve, this.tickMs);
    });
  }

  async loop() {
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        this.log.error(`[scheduler] tick error: ${err.message}`);
      }
      if (this.running) await this.idleWait();
    }
  }

  start() {
    this.running = true;
    this.log.info(`[scheduler] started (checking every ${this.tickMs}ms)`);
    this.loopPromise = this.loop();
    return this.loopPromise;
  }

  async stop() {
    this.running = false;
    clearTimeout(this.timer);
    if (this.wakeUp) this.wakeUp();
    await this.loopPromise;
    this.log.info('[scheduler] stopped');
  }
}

module.exports = Scheduler;