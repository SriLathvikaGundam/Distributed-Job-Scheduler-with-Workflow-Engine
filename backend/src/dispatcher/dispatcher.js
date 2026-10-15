const dispatchService = require('../services/dispatchService');

// Finds jobs that are ready to run and puts a message for each on the queue.
// MongoDB decides WHAT is ready (the schedule, retries, dependencies); the queue only delivers.
class Dispatcher {
  constructor({
    queue,
    service = dispatchService,
    tickMs = 1000,
    redispatchAfterMs = 300000,
    batchSize = 10, // SQS accepts at most 10 messages per request
    maxPerTick = 100,
    log = console,
  }) {
    Object.assign(this, { queue, service, tickMs, redispatchAfterMs, batchSize, maxPerTick, log });
    this.running = false;
    this.loopPromise = null;
    this.timer = null;
    this.wakeUp = null;
  }

  // One pass: claim ready jobs, send them in batches. Returns how many messages were sent.
  async tick(now = new Date()) {
    let sent = 0;
    while (sent < this.maxPerTick) {
      const batch = [];
      while (batch.length < this.batchSize) {
        const job = await this.service.claimForDispatch(now, this.redispatchAfterMs);
        if (!job) break;
        batch.push(job);
      }
      if (batch.length === 0) break;

      const ids = batch.map((job) => job._id);
      let failed;
      try {
        ({ failed } = await this.queue.send(ids));
      } catch (err) {
        await this.service.releaseDispatch(ids); // nothing was sent: undo the marks
        throw err;
      }
      if (failed.length) {
        await this.service.releaseDispatch(failed);
        this.log.warn(`[dispatcher] ${failed.length} message(s) were rejected and will be retried`);
      }

      sent += ids.length - failed.length;
      if (batch.length < this.batchSize) break; // ran out of ready jobs
    }
    return sent;
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
        const sent = await this.tick();
        if (sent) this.log.info(`[dispatcher] queued ${sent} job(s)`);
      } catch (err) {
        this.log.error(`[dispatcher] tick error: ${err.message}`);
      }
      if (this.running) await this.idleWait();
    }
  }

  start() {
    this.running = true;
    this.log.info(`[dispatcher] started (checking every ${this.tickMs}ms)`);
    this.loopPromise = this.loop();
    return this.loopPromise;
  }

  async stop() {
    this.running = false;
    clearTimeout(this.timer);
    if (this.wakeUp) this.wakeUp();
    await this.loopPromise;
    this.log.info('[dispatcher] stopped');
  }
}

module.exports = Dispatcher;