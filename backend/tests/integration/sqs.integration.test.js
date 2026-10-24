const Job = require('../../src/models/Job');
const service = require('../../src/services/jobService');
const workflows = require('../../src/services/workflowService');
const Dispatcher = require('../../src/dispatcher/dispatcher');
const FakeQueue = require('../helpers/fakeQueue');
const { silent, makeSqsWorker, runUntil } = require('../helpers/integration');
const { makeBarrier } = require('../helpers/waitFor');

const makeDispatcher = (queue, extra = {}) =>
  new Dispatcher({ queue, log: silent, tickMs: 30, redispatchAfterMs: 60000, ...extra });
const count = (filter) => Job.countDocuments(filter);

describe('dispatcher (real database, fake queue)', () => {
  test('queues every ready job once, and skips blocked, future and cancelled ones', async () => {
    await Job.insertMany([
      ...Array.from({ length: 25 }, (_, i) => ({ type: 'echo', payload: { i } })),
      { type: 'echo', status: 'BLOCKED' },
      { type: 'echo', runAt: new Date(Date.now() + 60000) },
      { type: 'echo', status: 'CANCELLED' },
    ]);
    const queue = new FakeQueue();
    const dispatcher = makeDispatcher(queue);

    expect(await dispatcher.tick()).toBe(25);
    expect(queue.size).toBe(25);
    expect(await count({ queuedAt: { $ne: null } })).toBe(25);

    expect(await dispatcher.tick()).toBe(0); // already queued: not sent again
    expect(queue.size).toBe(25);
  });

  test('queues a job again once it has waited longer than the re-dispatch window (a lost message)', async () => {
    await Job.create({ type: 'echo' });
    const queue = new FakeQueue();
    const dispatcher = makeDispatcher(queue, { redispatchAfterMs: 60000 });

    expect(await dispatcher.tick()).toBe(1);
    await Job.updateMany({}, { $set: { queuedAt: new Date(Date.now() - 120000) } }); // queued 2 minutes ago

    expect(await dispatcher.tick()).toBe(1);
    expect(queue.size).toBe(2);
  });

  test('if the queue is down, the marks are undone so nothing is stranded', async () => {
    await Job.insertMany(Array.from({ length: 3 }, () => ({ type: 'echo' })));
    const brokenQueue = { send: async () => { throw new Error('SQS down'); } };

    await expect(makeDispatcher(brokenQueue).tick()).rejects.toThrow('SQS down');
    expect(await count({ queuedAt: { $ne: null } })).toBe(0);

    const queue = new FakeQueue();
    expect(await makeDispatcher(queue).tick()).toBe(3); // works as soon as the queue is back
  });

  test('re-queues a job whose worker died long ago, but not one that died just now', async () => {
    await Job.create({ type: 'echo', status: 'RUNNING', lockedBy: 'dead', attempts: 1, leaseExpiresAt: new Date(Date.now() - 120000) });
    await Job.create({ type: 'echo', status: 'RUNNING', lockedBy: 'dead', attempts: 1, leaseExpiresAt: new Date(Date.now() - 10000) });
    const queue = new FakeQueue();

    expect(await makeDispatcher(queue, { redispatchAfterMs: 60000 }).tick()).toBe(1);
  });
});

describe('dispatcher + SQS worker, end to end', () => {
  test('every job runs once and the queue ends up empty', async () => {
    await Job.insertMany(Array.from({ length: 15 }, (_, i) => ({ type: 'echo', payload: { i } })));
    const queue = new FakeQueue();
    await makeDispatcher(queue).tick();

    const worker = makeSqsWorker(queue, { echo: async () => ({}) });
    await runUntil(worker, async () => (await count({ status: 'SUCCESS' })) === 15, 'all 15 jobs to finish');

    expect(await count({ attempts: 1 })).toBe(15);
    expect(queue.size).toBe(0); // every message was deleted after its job finished
  });

  test('duplicate deliveries never run a job twice', async () => {
    await Job.insertMany(Array.from({ length: 10 }, (_, i) => ({ type: 'echo', payload: { i } })));
    const queue = new FakeQueue({ duplicate: true }); // every message arrives twice
    await makeDispatcher(queue).tick();
    expect(queue.size).toBe(20);

    const runs = new Map();
    const worker = makeSqsWorker(queue, {
      echo: async ({ i }) => {
        runs.set(i, (runs.get(i) || 0) + 1);
        return {};
      },
    });
    await runUntil(
      worker,
      async () => queue.size === 0 && (await count({ status: 'SUCCESS' })) === 10,
      'the queue to drain'
    );

    expect(runs.size).toBe(10);
    expect([...runs.values()].every((n) => n === 1)).toBe(true);
    expect(await count({ attempts: 1 })).toBe(10);
  });

  test('a message that reappears after a worker died recovers the job', async () => {
    const { job } = await service.createJob({ type: 'echo' });
    const queue = new FakeQueue();
    await makeDispatcher(queue).tick();

    // A worker receives the message and claims the job, then dies without acknowledging.
    const [message] = await queue.receive({ visibilitySeconds: 1.2 });
    const claimed = await service.claimById(message.jobId, 'dying-worker', 600);
    expect(claimed.job.attempts).toBe(1);

    // Once the message reappears and the lease has expired, a healthy worker finishes the job.
    const worker = makeSqsWorker(queue, { echo: async () => ({ recovered: true }) });
    await runUntil(worker, async () => (await Job.findById(job._id)).status === 'SUCCESS', 'the job to be recovered');

    const saved = await Job.findById(job._id);
    expect(saved.attempts).toBe(2);
    expect(saved.result).toEqual({ recovered: true });
  });

  test('a workflow runs over the queue: blocked steps are only queued once released', async () => {
    const events = [];
    const barrier = makeBarrier(2);
    const handlers = {
      step: async ({ name, parallel }) => {
        events.push(`start:${name}`);
        if (parallel) await barrier.arrive();
        events.push(`end:${name}`);
        return {};
      },
    };
    const wf = await workflows.createWorkflow({
      name: 'diamond-over-sqs',
      steps: [
        { name: 'extract', type: 'step', payload: { name: 'extract' } },
        { name: 'transform-a', type: 'step', payload: { name: 'transform-a', parallel: true }, dependsOn: ['extract'] },
        { name: 'transform-b', type: 'step', payload: { name: 'transform-b', parallel: true }, dependsOn: ['extract'] },
        { name: 'load', type: 'step', payload: { name: 'load' }, dependsOn: ['transform-a', 'transform-b'] },
      ],
    });

    const queue = new FakeQueue();
    const dispatcher = makeDispatcher(queue);
    expect(await dispatcher.tick()).toBe(1); // only "extract": the other three are BLOCKED
    expect(queue.size).toBe(1);

    const worker = makeSqsWorker(queue, handlers, { leaseMs: 8000, jobTimeoutMs: 7000 });
    dispatcher.start();
    try {
      await runUntil(
        worker,
        async () => (await workflows.getWorkflow(wf.id)).status === 'SUCCESS',
        'the workflow to succeed'
      );
    } finally {
      await dispatcher.stop();
    }

    const at = (event) => events.indexOf(event);
    expect(at('end:extract')).toBeLessThan(at('start:transform-a'));
    expect(at('end:transform-a')).toBeLessThan(at('start:load'));
    expect(at('end:transform-b')).toBeLessThan(at('start:load'));
  });
});