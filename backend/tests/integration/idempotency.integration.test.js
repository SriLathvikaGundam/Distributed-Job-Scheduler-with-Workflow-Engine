const Job = require('../../src/models/Job');
const service = require('../../src/services/jobService');

test('20 simultaneous submissions with the same key create exactly one job', async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, () => service.createJob({ type: 'echo', idempotencyKey: 'order-1' }))
  );

  expect(results.filter((r) => r.created)).toHaveLength(1);
  expect(new Set(results.map((r) => String(r.job._id))).size).toBe(1);
  expect(await Job.countDocuments({})).toBe(1);
});

test('different keys make different jobs', async () => {
  const [a, b] = await Promise.all([
    service.createJob({ type: 'echo', idempotencyKey: 'k1' }),
    service.createJob({ type: 'echo', idempotencyKey: 'k2' }),
  ]);
  expect(a.created && b.created).toBe(true);
  expect(await Job.countDocuments({})).toBe(2);
});

test('jobs without a key never collide with each other', async () => {
  await Promise.all([1, 2, 3].map(() => service.createJob({ type: 'echo' })));
  expect(await Job.countDocuments({})).toBe(3);
});

test('a replay returns the original job untouched', async () => {
  const first = await service.createJob({ type: 'echo', payload: { n: 1 }, idempotencyKey: 'same' });
  const second = await service.createJob({ type: 'echo', payload: { n: 999 }, idempotencyKey: 'same' });

  expect(second.created).toBe(false);
  expect(String(second.job._id)).toBe(String(first.job._id));
  expect(second.job.payload).toEqual({ n: 1 });
});