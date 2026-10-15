const Dispatcher = require('../src/dispatcher/dispatcher');

const silent = { info() {}, warn() {}, error() {} };

// A fake service that hands out `count` jobs, one per claim.
function fakeService(count) {
  let given = 0;
  return {
    claimForDispatch: jest.fn(async () => (given < count ? { _id: `j${given++}` } : null)),
    releaseDispatch: jest.fn(async () => {}),
  };
}
const make = (count, queue, extra = {}) => {
  const service = fakeService(count);
  return { service, dispatcher: new Dispatcher({ queue, service, log: silent, tickMs: 5, ...extra }) };
};

describe('Dispatcher.tick', () => {
  test('sends ready jobs in batches of at most 10', async () => {
    const queue = { send: jest.fn(async () => ({ failed: [] })) };
    const { dispatcher } = make(25, queue);

    await expect(dispatcher.tick()).resolves.toBe(25);
    expect(queue.send.mock.calls.map(([ids]) => ids.length)).toEqual([10, 10, 5]);
  });

  test('sends nothing when no job is ready', async () => {
    const queue = { send: jest.fn() };
    const { dispatcher } = make(0, queue);
    await expect(dispatcher.tick()).resolves.toBe(0);
    expect(queue.send).not.toHaveBeenCalled();
  });

  test('stops after maxPerTick so one pass cannot run forever', async () => {
    const queue = { send: jest.fn(async () => ({ failed: [] })) };
    const { dispatcher } = make(1000, queue, { maxPerTick: 20 });
    await expect(dispatcher.tick()).resolves.toBe(20);
  });

  test('if the send fails entirely, undoes the marks and rethrows', async () => {
    const queue = { send: jest.fn(async () => { throw new Error('AccessDenied'); }) };
    const { dispatcher, service } = make(3, queue);

    await expect(dispatcher.tick()).rejects.toThrow('AccessDenied');
    expect(service.releaseDispatch).toHaveBeenCalledWith(['j0', 'j1', 'j2']);
  });

  test('undoes the marks only for messages SQS rejected, and counts the rest as sent', async () => {
    const queue = { send: jest.fn(async () => ({ failed: ['j1'] })) };
    const { dispatcher, service } = make(3, queue);

    await expect(dispatcher.tick()).resolves.toBe(2);
    expect(service.releaseDispatch).toHaveBeenCalledWith(['j1']);
  });

  test('passes the re-dispatch window to the service', async () => {
    const queue = { send: jest.fn(async () => ({ failed: [] })) };
    const { dispatcher, service } = make(1, queue, { redispatchAfterMs: 1234 });
    await dispatcher.tick();
    expect(service.claimForDispatch).toHaveBeenCalledWith(expect.any(Date), 1234);
  });
});

describe('Dispatcher loop', () => {
  test('keeps ticking until stopped, and stop() returns promptly', async () => {
    const queue = { send: jest.fn(async () => ({ failed: [] })) };
    const { dispatcher, service } = make(0, queue, { tickMs: 10000 });

    dispatcher.start();
    await new Promise((r) => setTimeout(r, 30));
    const began = Date.now();
    await dispatcher.stop();

    expect(Date.now() - began).toBeLessThan(1000);
    expect(service.claimForDispatch).toHaveBeenCalled();
  });

  test('a failing tick is logged and the loop carries on', async () => {
    const errors = [];
    const queue = { send: jest.fn(async () => { throw new Error('boom'); }) };
    const { dispatcher } = make(5, queue, { log: { info() {}, warn() {}, error: (m) => errors.push(m) }, tickMs: 5 });

    dispatcher.start();
    await new Promise((r) => setTimeout(r, 40));
    await dispatcher.stop();
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});