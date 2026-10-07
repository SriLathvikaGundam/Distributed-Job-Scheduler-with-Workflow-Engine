const service = require('../services/jobService');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Worker {
  constructor({ workerId, handlers, pollMs = 1000, leaseMs = 30000, jobTimeoutMs = 20000, log = console }) {
    this.workerId = workerId;
    this.handlers = handlers;
    this.pollMs = pollMs;
    this.leaseMs = leaseMs;
    this.jobTimeoutMs = jobTimeoutMs;
    this.log = log;
    this.running = false;
  }

  // Claim and run one job. Returns true if a job was handled, false if none was ready.
  async runOnce() {
    const job = await service.claimNext(this.workerId, this.leaseMs);
    if (!job) return false;
    await this.execute(job);
    return true;
  }

  async execute(job) {
    let result;
    let timer;
    try {
      const handler = this.handlers[job.type];
      if (!handler) throw new Error(`No handler registered for type "${job.type}"`);

      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Job timed out after ${this.jobTimeoutMs}ms`)),
          this.jobTimeoutMs
        );
      });
      result = await Promise.race([
        handler(job.payload, { jobId: String(job._id), attempt: job.attempts }),
        timeout,
      ]);
    } catch (err) {
      const updated = await service.failJob(job, err);
      if (updated) {
        this.log.warn(`[${this.workerId}] ${job.type} ${job._id} -> ${updated.status}: ${err.message}`);
      } else {
        this.log.warn(`[${this.workerId}] lost lease on ${job._id}; failure dropped`);
      }
      return;
    } finally {
      clearTimeout(timer);
    }

    const done = await service.completeJob(job, result);
    if (done) {
      this.log.info(`[${this.workerId}] ${job.type} ${job._id} -> SUCCESS (attempt ${job.attempts})`);
    } else {
      this.log.warn(`[${this.workerId}] lost lease on ${job._id}; result dropped`);
    }
  }

  async start() {
    this.running = true;
    this.log.info(`[${this.workerId}] started`);
    while (this.running) {
      try {
        const handled = await this.runOnce();
        if (!handled) await sleep(this.pollMs); // idle: wait before polling again
      } catch (err) {
        this.log.error(`[${this.workerId}] loop error: ${err.message}`);
        await sleep(this.pollMs);
      }
    }
  }

  stop() {
    this.running = false;
  }
}

module.exports = Worker;