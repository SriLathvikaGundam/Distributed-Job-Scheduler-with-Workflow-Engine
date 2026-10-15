const { MongoSource, SqsSource } = require('../src/worker/sources');

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
beforeEach(() => Object.values(silent).forEach((f) => f.mockClear()));

describe('MongoSource', () => {
  test('claims up to max jobs and stops when none are ready', async () => {
    const service = { claimNext: jest.fn().mockResolvedValueOnce({ _id: 1 }).mockResolvedValueOnce({ _id: 2 }).mockResolvedValue(null) };
    const source = new MongoSource({ service, workerId: 'w1', leaseMs: 5000 });

    const items = await source.next(5);
    expect(items.map((i) => i.job._id)).toEqual([1, 2]);
    expect(service.claimNext).toHaveBeenCalledWith('w1', 5000);
    expect(source.blocking).toBe(false);
  });

  test('never claims more than max', async () => {
    const service = { claimNext: jest.fn().mockResolvedValue({ _id: 1 }) };
    const items = await new MongoSource({ service, workerId: 'w1', leaseMs: 5000 }).next(3);
    expect(items).toHaveLength(3);
    expect(service.claimNext).toHaveBeenCalledTimes(3);
  });

  test('its ack does nothing and succeeds', async () => {
    const service = { claimNext: jest.fn().mockResolvedValueOnce({ _id: 1 }) };
    const [item] = await new MongoSource({ service, workerId: 'w1', leaseMs: 1 }).next(1);
    await expect(item.ack()).resolves.toBeUndefined();
  });
});

describe('SqsSource', () => {
  const make = (messages, claimResults) => {
    const queue = { receive: jest.fn().mockResolvedValue(messages), remove: jest.fn().mockResolvedValue() };
    const service = { claimById: jest.fn() };
    claimResults.forEach((r) => service.claimById.mockResolvedValueOnce(r));
    const source = new SqsSource({ queue, service, workerId: 'w1', leaseMs: 6000, visibilitySeconds: 11, waitSeconds: 20, log: silent });
    return { queue, service, source };
  };
  const msg = (n) => ({ messageId: `m${n}`, receiptHandle: `r${n}`, jobId: `j${n}` });

  test('is a blocking source', () => {
    expect(make([], []).source.blocking).toBe(true);
  });

  test('long-polls with the worker limits', async () => {
    const { queue, source } = make([], []);
    const signal = new AbortController().signal;
    await source.next(4, { signal });
    expect(queue.receive).toHaveBeenCalledWith({ max: 4, waitSeconds: 20, visibilitySeconds: 11, signal });
  });

  test('claims the job each message names, and acks by deleting the message', async () => {
    const { queue, service, source } = make([msg(1)], [{ job: { _id: 'j1' }, reason: null }]);
    const items = await source.next(3);

    expect(service.claimById).toHaveBeenCalledWith('j1', 'w1', 6000);
    expect(items).toHaveLength(1);
    expect(queue.remove).not.toHaveBeenCalled(); // not deleted until the job's outcome is recorded
    await items[0].ack();
    expect(queue.remove).toHaveBeenCalledWith('r1');
  });

  test('deletes messages whose job is already finished, missing, blocked or exhausted', async () => {
    const { queue, source } = make(
      [msg(1), msg(2), msg(3), msg(4)],
      ['FINISHED', 'MISSING', 'BLOCKED', 'EXHAUSTED'].map((reason) => ({ job: null, reason }))
    );
    expect(await source.next(4)).toEqual([]);
    expect(queue.remove.mock.calls.map(([h]) => h)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  test('leaves messages for jobs another worker holds, so a crash can still be recovered', async () => {
    const { queue, source } = make([msg(1), msg(2)], [{ job: null, reason: 'LEASED' }, { job: null, reason: 'NOT_DUE' }]);
    expect(await source.next(2)).toEqual([]);
    expect(queue.remove).not.toHaveBeenCalled();
  });

  test('deletes a malformed message instead of letting it loop forever', async () => {
    const { queue, service, source } = make([{ messageId: 'm1', receiptHandle: 'r1', jobId: null }], []);
    expect(await source.next(1)).toEqual([]);
    expect(queue.remove).toHaveBeenCalledWith('r1');
    expect(service.claimById).not.toHaveBeenCalled();
  });

  test('one failing message does not lose the others in the batch', async () => {
    const { queue, service, source } = make([msg(1), msg(2)], []);
    service.claimById.mockRejectedValueOnce(new Error('db blip')).mockResolvedValueOnce({ job: { _id: 'j2' }, reason: null });

    const items = await source.next(2);
    expect(items.map((i) => i.job._id)).toEqual(['j2']);
    expect(queue.remove).not.toHaveBeenCalled(); // the failed one stays on the queue and will reappear
    expect(silent.error).toHaveBeenCalled();
  });

  test('a failed delete is logged, not thrown', async () => {
    const { queue, source } = make([msg(1)], [{ job: null, reason: 'FINISHED' }]);
    queue.remove.mockRejectedValue(new Error('network'));
    await expect(source.next(1)).resolves.toEqual([]);
    expect(silent.error).toHaveBeenCalled();
  });
});