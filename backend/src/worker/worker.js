const service = require('../services/jobService');

class Worker {
  constructor({
    workerId,
    handlers,
    concurrency = 3,
    pollMs = 1000,
    leaseMs = 30000,
    jobTimeoutMs = 20000,
    log = console,
  }) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('concurrency must be an integer of at least 1');
    }
    if (jobTimeoutMs >= leaseMs) {
      throw new Error(
        'jobTimeoutMs must be less than leaseMs, or healthy jobs would be re-claimed while still running'
      );
    }
    this.workerId = workerId;
    this.handlers = handlers;
    this.concurrency = concurrency;
    this.pollMs = pollMs;
    this.leaseMs = leaseMs;
    this.jobTimeoutMs = jobTimeoutMs;
    this.log = log;

    this.active = new Set(); // promises of jobs running right now
    this.running = false;
    this.lastReap = 0;
    this.loopPromise = null;
    this.idleTimer = null;
    this.wakeUp = null;
  }

  // Fail jobs whose worker died on their final attempt (at most once per lease period).
  async maybeReap() {
    if (Date.now() - this.lastReap < this.leaseMs) return;
    this.lastReap = Date.now();
    const count = await service.reapExhausted();
    if (count) this.log.warn(`[${this.workerId}] marked ${count} job(s) FAILED: worker lost on final attempt`);
  }

  // Claim one job (atomically) and log it.
  async claim() {
    const job = await service.claimNext(this.workerId, this.leaseMs);
    if (job) {
      this.log.info(`[${this.workerId}] claimed ${job.type} ${job._id} (attempt ${job.attempts}/${job.maxAttempts})`);
    }
    return job;
  }

  // Claim and run one job, waiting for it to finish. Returns false if nothing was ready.
  async runOnce() {
    const job = await this.claim();
    if (!job) return false;
    await this.execute(job);
    return true;
  }

  // Start jobs until every slot is busy or nothing is ready. Returns how many were started.
  async fillSlots() {
    let started = 0;
    while (this.running && this.active.size < this.concurrency) {
      const job = await this.claim();
      if (!job) break;
      started++;
      const p = this.execute(job)
        .catch((err) => this.log.error(`[${this.workerId}] job ${job._id} crashed: ${err.message}`))
        .finally(() => this.active.delete(p));
      this.active.add(p);
    }
    return started;
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

  // A wait that stop() can cut short, so shutdown does not wait for the next poll.
  idleWait() {
    return new Promise((resolve) => {
      this.wakeUp = resolve;
      this.idleTimer = setTimeout(resolve, this.pollMs);
    });
  }

  async loop() {
    while (this.running) {
      try {
        await this.maybeReap();
        const started = await this.fillSlots();

        if (this.active.size >= this.concurrency) {
          await Promise.race(this.active); // all slots busy: wait for one to free up
        } else if (started === 0 && this.running) {
          await this.idleWait(); // nothing ready: wait before polling again
        }
      } catch (err) {
        this.log.error(`[${this.workerId}] loop error: ${err.message}`);
        if (this.running) await this.idleWait();
      }
    }
  }

  start() {
    this.running = true;
    this.log.info(`[${this.workerId}] started (concurrency ${this.concurrency})`);
    this.loopPromise = this.loop();
    return this.loopPromise;
  }

  // Graceful stop: no new claims, but let running jobs finish.
  async stop() {
    this.running = false;
    clearTimeout(this.idleTimer);
    if (this.wakeUp) this.wakeUp();
    await this.loopPromise;
    await Promise.allSettled([...this.active]);
    this.log.info(`[${this.workerId}] stopped`);
  }
}

module.exports = Worker;