const service = require('../services/jobService');
const { MongoSource } = require('./sources');

class Worker {
  constructor({
    workerId,
    handlers,
    concurrency = 3,
    pollMs = 1000,
    leaseMs = 30000,
    jobTimeoutMs = 20000,
    source,
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
    // Where jobs come from: MongoDB by default, or any object with the same shape (see sources.js).
    this.source = source || new MongoSource({ service, workerId, leaseMs });

    this.active = new Set();
    this.running = false;
    this.lastReap = 0;
    this.loopPromise = null;
    this.idleTimer = null;
    this.wakeUp = null;
    this.abort = null;
  }

  // Housekeeping, at most once per lease period:
  //  - fail jobs whose worker died on their final attempt
  //  - repair workflow steps that were left BLOCKED after a crash
  async maybeReap() {
    if (Date.now() - this.lastReap < this.leaseMs) return;
    this.lastReap = Date.now();

    const count = await service.reapExhausted();
    if (count) this.log.warn(`[${this.workerId}] marked ${count} job(s) FAILED: worker lost on final attempt`);

    const repaired = await service.reconcileBlocked();
    if (repaired) this.log.warn(`[${this.workerId}] repaired ${repaired} stalled workflow step(s)`);
  }

  // Get one job from the source and run it to completion. Returns false if none was ready.
  async runOnce() {
    const [item] = await this.source.next(1);
    if (!item) return false;
    await this.run(item);
    return true;
  }

  // Run a job, then acknowledge it (for SQS: delete the message) once its outcome is recorded.
  async run({ job, ack }) {
    this.log.info(`[${this.workerId}] claimed ${job.type} ${job._id} (attempt ${job.attempts}/${job.maxAttempts})`);
    await this.execute(job); // throws only if the outcome could not be recorded: then we do NOT ack
    try {
      await ack();
    } catch (err) {
      this.log.warn(`[${this.workerId}] could not acknowledge job ${job._id}: ${err.message}`);
    }
  }

  // Fill the free slots from the source. Returns how many jobs were started.
  async fillSlots() {
    const free = this.concurrency - this.active.size;
    if (!this.running || free <= 0) return 0;

    this.abort = new AbortController();
    let items;
    try {
      items = await this.source.next(free, { signal: this.abort.signal });
    } finally {
      this.abort = null;
    }

    for (const item of items) {
      const p = this.run(item)
        .catch((err) => this.log.error(`[${this.workerId}] job ${item.job._id} crashed: ${err.message}`))
        .finally(() => this.active.delete(p));
      this.active.add(p);
    }
    return items.length;
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
        const polledAt = Date.now();
        const started = await this.fillSlots();

        if (this.active.size >= this.concurrency) {
          await Promise.race(this.active); // all slots busy: wait for one to free up
        } else if (started === 0 && this.running) {
          // Nothing ready. A real long poll has already waited, so poll again at once.
          // But if the source came back empty instantly (e.g. long polling switched off),
          // pause, or we would hammer the queue in a tight loop.
          const alreadyWaited = this.source.blocking && Date.now() - polledAt >= this.pollMs;
          if (!alreadyWaited) await this.idleWait();
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

  // Graceful stop: no new work, cut short any wait, let running jobs finish.
  async stop() {
    this.running = false;
    clearTimeout(this.idleTimer);
    if (this.wakeUp) this.wakeUp();
    if (this.abort) this.abort.abort(); // ends a long poll in progress
    await this.loopPromise;
    await Promise.allSettled([...this.active]);
    this.log.info(`[${this.workerId}] stopped`);
  }
}

module.exports = Worker;