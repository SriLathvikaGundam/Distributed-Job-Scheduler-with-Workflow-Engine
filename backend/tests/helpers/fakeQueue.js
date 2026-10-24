// An in-memory stand-in for SQS with the behaviours that matter to us:
//   - a received message is HIDDEN for `visibilitySeconds`, then reappears unless it was deleted
//   - only the most recent receipt handle can delete a message
//   - optional duplicate delivery (SQS standard queues deliver at least once)
//   - long polling that can be aborted
class FakeQueue {
  constructor({ duplicate = false } = {}) {
    this.duplicate = duplicate;
    this.messages = [];
    this.nextId = 0;
    this.nextHandle = 0;
  }

  async send(jobIds) {
    for (const jobId of jobIds) {
      const copies = this.duplicate ? 2 : 1;
      for (let i = 0; i < copies; i++) {
        this.messages.push({ id: ++this.nextId, jobId: String(jobId), visibleAt: 0, receiptHandle: null });
      }
    }
    return { failed: [] };
  }

  async receive({ max = 10, waitSeconds = 0, visibilitySeconds = 30, signal } = {}) {
    const deadline = Date.now() + waitSeconds * 1000;
    for (;;) {
      if (signal && signal.aborted) return [];

      const now = Date.now();
      const ready = this.messages.filter((m) => m.visibleAt <= now).slice(0, Math.min(max, 10));
      if (ready.length > 0) {
        return ready.map((m) => {
          m.visibleAt = now + visibilitySeconds * 1000;
          m.receiptHandle = `handle-${m.id}-${++this.nextHandle}`;
          return { messageId: String(m.id), receiptHandle: m.receiptHandle, jobId: m.jobId };
        });
      }

      if (now >= deadline) return [];
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async remove(receiptHandle) {
    const index = this.messages.findIndex((m) => m.receiptHandle === receiptHandle);
    if (index >= 0) this.messages.splice(index, 1);
  }

  // Messages still on the queue, hidden or not.
  get size() {
    return this.messages.length;
  }
}

module.exports = FakeQueue;