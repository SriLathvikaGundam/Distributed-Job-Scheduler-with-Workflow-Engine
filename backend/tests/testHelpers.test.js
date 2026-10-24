const FakeQueue = require('./helpers/fakeQueue');
const { waitFor, makeBarrier } = require('./helpers/waitFor');

describe('waitFor', () => {
  test('returns the value as soon as the condition becomes truthy (async conditions work)', async () => {
    let n = 0;
    await expect(waitFor(async () => ++n >= 3 && 'done', { intervalMs: 1 })).resolves.toBe('done');
  });

  test('fails with a clear message on timeout', async () => {
    await expect(waitFor(() => false, { timeoutMs: 30, intervalMs: 5, message: 'the moon' })).rejects.toThrow('Timed out waiting for the moon');
  });
});

describe('makeBarrier', () => {
  test('releases everyone only when all parties have arrived', async () => {
    const barrier = makeBarrier(2);
    let first = false;
    const a = barrier.arrive().then(() => { first = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(first).toBe(false); // one party alone is not enough
    await Promise.all([a, barrier.arrive()]);
    expect(first).toBe(true);
  });

  test('times out if the other party never arrives', async () => {
    await expect(makeBarrier(2, 30).arrive()).rejects.toThrow(/did not run in parallel/);
  });
});

describe('FakeQueue behaves like SQS where it matters', () => {
  test('a received message is hidden, then reappears after the visibility timeout', async () => {
    const q = new FakeQueue();
    await q.send(['j1']);

    const [first] = await q.receive({ visibilitySeconds: 0.1 });
    expect(first.jobId).toBe('j1');
    expect(await q.receive({ visibilitySeconds: 0.1 })).toEqual([]); // hidden

    await new Promise((r) => setTimeout(r, 130));
    const [again] = await q.receive({ visibilitySeconds: 30 });
    expect(again.jobId).toBe('j1');
    expect(again.receiptHandle).not.toBe(first.receiptHandle); // a new handle on every delivery
  });

  test('only the latest receipt handle can delete a message', async () => {
    const q = new FakeQueue();
    await q.send(['j1']);
    const [first] = await q.receive({ visibilitySeconds: 0.05 });
    await new Promise((r) => setTimeout(r, 70));
    const [second] = await q.receive({ visibilitySeconds: 30 });

    await q.remove(first.receiptHandle); // stale handle: ignored
    expect(q.size).toBe(1);
    await q.remove(second.receiptHandle);
    expect(q.size).toBe(0);
  });

  test('can deliver every message twice', async () => {
    const q = new FakeQueue({ duplicate: true });
    await q.send(['a', 'b']);
    expect(q.size).toBe(4);
    const got = await q.receive({ max: 10, visibilitySeconds: 30 });
    expect(got.map((m) => m.jobId).sort()).toEqual(['a', 'a', 'b', 'b']);
  });

  test('never hands out more than 10 at a time, or more than max', async () => {
    const q = new FakeQueue();
    await q.send(Array.from({ length: 25 }, (_, i) => `j${i}`));
    expect(await q.receive({ max: 25, visibilitySeconds: 30 })).toHaveLength(10);
    expect(await q.receive({ max: 3, visibilitySeconds: 30 })).toHaveLength(3);
  });

  test('long polling waits for a message to arrive', async () => {
    const q = new FakeQueue();
    setTimeout(() => q.send(['late']), 40);
    const got = await q.receive({ waitSeconds: 1, visibilitySeconds: 30 });
    expect(got.map((m) => m.jobId)).toEqual(['late']);
  });

  test('long polling gives up after the wait, and can be aborted', async () => {
    const q = new FakeQueue();
    const began = Date.now();
    expect(await q.receive({ waitSeconds: 0.05 })).toEqual([]);
    expect(Date.now() - began).toBeLessThan(500);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const t0 = Date.now();
    expect(await q.receive({ waitSeconds: 20, signal: controller.signal })).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});