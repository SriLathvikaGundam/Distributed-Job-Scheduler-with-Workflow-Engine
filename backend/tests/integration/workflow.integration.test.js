const Job = require('../../src/models/Job');
const service = require('../../src/services/jobService');
const workflows = require('../../src/services/workflowService');
const { reconcileBlocked } = require('../../src/services/dependencyService');
const { makeWorker, runUntil } = require('../helpers/integration');
const { waitFor, makeBarrier, sleep } = require('../helpers/waitFor');

const statusOf = (view) => Object.fromEntries(view.steps.map((s) => [s.name, s.status]));
const workflowIs = (id, status) => async () => (await workflows.getWorkflow(id)).status === status;

const diamondSteps = [
  { name: 'extract', type: 'step', payload: { name: 'extract' } },
  { name: 'transform-a', type: 'step', payload: { name: 'transform-a', parallel: true }, dependsOn: ['extract'] },
  { name: 'transform-b', type: 'step', payload: { name: 'transform-b', parallel: true }, dependsOn: ['extract'] },
  { name: 'load', type: 'step', payload: { name: 'load' }, dependsOn: ['transform-a', 'transform-b'] },
];

test('a new workflow starts with only its first steps runnable', async () => {
  const wf = await workflows.createWorkflow({
    name: 'chain',
    steps: [{ name: 'a', type: 'echo' }, { name: 'b', type: 'echo', dependsOn: ['a'] }],
  });

  expect(statusOf(wf)).toEqual({ a: 'PENDING', b: 'BLOCKED' });
  expect(wf.steps.find((s) => s.name === 'b').dependsOn).toEqual(['a']);

  const first = await service.claimNext('w1', 30000);
  expect(first.stepName).toBe('a');
  expect(await service.claimNext('w1', 30000)).toBeNull(); // b is blocked
});

test('diamond: dependencies are respected and independent steps really run in parallel', async () => {
  const events = [];
  const barrier = makeBarrier(2);
  const handlers = {
    step: async ({ name, parallel }) => {
      events.push(`start:${name}`);
      if (parallel) await barrier.arrive(); // only passes if BOTH transform steps are running at once
      events.push(`end:${name}`);
      return { name };
    },
  };
  const wf = await workflows.createWorkflow({ name: 'diamond', steps: diamondSteps });
  const worker = makeWorker(handlers, { leaseMs: 8000, jobTimeoutMs: 7000 });

  await runUntil(worker, workflowIs(wf.id, 'SUCCESS'), 'the workflow to succeed');

  const at = (event) => events.indexOf(event);
  expect(at('end:extract')).toBeLessThan(at('start:transform-a'));
  expect(at('end:extract')).toBeLessThan(at('start:transform-b'));
  expect(at('end:transform-a')).toBeLessThan(at('start:load'));
  expect(at('end:transform-b')).toBeLessThan(at('start:load'));
  expect(Math.max(at('start:transform-a'), at('start:transform-b'))).toBeLessThan(
    Math.min(at('end:transform-a'), at('end:transform-b'))
  ); // they overlapped

  const view = await workflows.getWorkflow(wf.id);
  expect(Object.values(statusOf(view)).every((s) => s === 'SUCCESS')).toBe(true);
});

test('a failed step cancels everything downstream, but independent branches still finish', async () => {
  const handlers = {
    ok: async () => ({}),
    fail: async () => {
      throw new Error('boom');
    },
  };
  const wf = await workflows.createWorkflow({
    name: 'cascade',
    steps: [
      { name: 'a', type: 'ok' },
      { name: 'b', type: 'fail', maxAttempts: 1, dependsOn: ['a'] },
      { name: 'c', type: 'ok', dependsOn: ['b'] },
      { name: 'd', type: 'ok', dependsOn: ['c'] },
      { name: 'side', type: 'ok', dependsOn: ['a'] },
    ],
  });
  const worker = makeWorker(handlers);

  await runUntil(worker, workflowIs(wf.id, 'FAILED'), 'the workflow to fail');

  const view = await workflows.getWorkflow(wf.id);
  expect(statusOf(view)).toEqual({ a: 'SUCCESS', b: 'FAILED', c: 'CANCELLED', d: 'CANCELLED', side: 'SUCCESS' });
  expect(view.steps.find((s) => s.name === 'c').lastError).toBe('Upstream step "b" failed');
  expect(view.steps.find((s) => s.name === 'd').lastError).toBe('Upstream step "c" cancelled');
});

test('cancelling a workflow cancels the waiting steps and lets the running one finish', async () => {
  const worker = makeWorker({ slow: async () => { await sleep(800); return {}; } });
  const wf = await workflows.createWorkflow({
    name: 'to-cancel',
    steps: [
      { name: 's1', type: 'slow' },
      { name: 's2', type: 'slow', dependsOn: ['s1'] },
      { name: 's3', type: 'slow', dependsOn: ['s2'] },
    ],
  });

  worker.start();
  try {
    await waitFor(async () => statusOf(await workflows.getWorkflow(wf.id)).s1 === 'RUNNING', { message: 's1 to start' });
    const result = await workflows.cancelWorkflow(wf.id);
    expect(result.cancelledSteps).toBe(2);
    await waitFor(workflowIs(wf.id, 'CANCELLED'), { message: 'the workflow to settle' });
  } finally {
    await worker.stop();
  }

  expect(statusOf(await workflows.getWorkflow(wf.id))).toEqual({ s1: 'SUCCESS', s2: 'CANCELLED', s3: 'CANCELLED' });
});

test('reconcile repairs a step left blocked after a crash, and is idempotent', async () => {
  const wf = await workflows.createWorkflow({
    name: 'repair',
    steps: [{ name: 'a', type: 'echo' }, { name: 'b', type: 'echo', dependsOn: ['a'] }],
  });

  // Simulate: step a was marked SUCCESS, then the worker died before releasing b.
  await Job.updateOne({ workflowId: wf.id, stepName: 'a' }, { $set: { status: 'SUCCESS' } });
  expect((await Job.findOne({ workflowId: wf.id, stepName: 'b' })).status).toBe('BLOCKED');

  expect(await reconcileBlocked()).toBe(1);
  expect((await Job.findOne({ workflowId: wf.id, stepName: 'b' })).status).toBe('PENDING');
  expect(await reconcileBlocked()).toBe(0); // nothing left to repair
});

test('reconcile cancels the steps behind a failure that was never propagated', async () => {
  const wf = await workflows.createWorkflow({
    name: 'repair-failure',
    steps: [
      { name: 'a', type: 'echo' },
      { name: 'b', type: 'echo', dependsOn: ['a'] },
      { name: 'c', type: 'echo', dependsOn: ['b'] },
    ],
  });
  await Job.updateOne({ workflowId: wf.id, stepName: 'a' }, { $set: { status: 'FAILED' } });

  await reconcileBlocked();

  expect(statusOf(await workflows.getWorkflow(wf.id))).toEqual({ a: 'FAILED', b: 'CANCELLED', c: 'CANCELLED' });
  expect(await reconcileBlocked()).toBe(0);
});