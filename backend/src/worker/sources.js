const { shouldDiscard } = require('../core/claimReason');

// A "source" gives the worker jobs to run:
//   next(max, { signal }) -> Promise<Array<{ job, ack }>>
//   blocking: true if next() already waits for work (so the worker should not add its own pause)
// ack() is called AFTER the job's outcome has been recorded.

// Queue mode "mongo": claim jobs straight from MongoDB, no ack needed.
class MongoSource {
  constructor({ service, workerId, leaseMs }) {
    Object.assign(this, { service, workerId, leaseMs });
    this.blocking = false;
  }

  async next(max) {
    const items = [];
    while (items.length < max) {
      const job = await this.service.claimNext(this.workerId, this.leaseMs);
      if (!job) break;
      items.push({ job, ack: async () => {} });
    }
    return items;
  }
}

// Queue mode "sqs": long-poll SQS for messages, then claim the job each message names.
class SqsSource {
  constructor({ queue, service, workerId, leaseMs, visibilitySeconds, waitSeconds = 20, log = console }) {
    Object.assign(this, { queue, service, workerId, leaseMs, visibilitySeconds, waitSeconds, log });
    this.blocking = true;
  }

  async next(max, { signal } = {}) {
    const messages = await this.queue.receive({
      max,
      waitSeconds: this.waitSeconds,
      visibilitySeconds: this.visibilitySeconds,
      signal,
    });

    const items = [];
    for (const message of messages) {
      const item = await this.claimOrDiscard(message);
      if (item) items.push(item);
    }
    return items;
  }

  async claimOrDiscard(message) {
    try {
      if (!message.jobId) {
        // Unreadable message: delete it, or it would come back forever.
        this.log.warn(`[${this.workerId}] discarding a malformed message`);
        await this.queue.remove(message.receiptHandle);
        return null;
      }

      const { job, reason } = await this.service.claimById(message.jobId, this.workerId, this.leaseMs);
      if (job) return { job, ack: () => this.queue.remove(message.receiptHandle) };

      if (shouldDiscard(reason)) {
        await this.queue.remove(message.receiptHandle);
      } else {
        // Leave it: if the other worker died, this message coming back is what recovers the job.
        this.log.info(`[${this.workerId}] leaving message for job ${message.jobId} (${reason})`);
      }
    } catch (err) {
      // Never lose the rest of the batch because of one bad message. It will reappear.
      this.log.error(`[${this.workerId}] could not process message for job ${message.jobId}: ${err.message}`);
    }
    return null;
  }
}

module.exports = { MongoSource, SqsSource };