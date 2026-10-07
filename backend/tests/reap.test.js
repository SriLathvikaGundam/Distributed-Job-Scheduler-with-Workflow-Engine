jest.mock('../src/models/Job', () => ({ updateMany: jest.fn() }));
const Job = require('../src/models/Job');
const { reapExhausted } = require('../src/services/jobService');

test('fails expired-lease jobs that have no attempts left', async () => {
  Job.updateMany.mockResolvedValue({ modifiedCount: 2 });
  await expect(reapExhausted()).resolves.toBe(2);

  const [filter, update] = Job.updateMany.mock.calls[0];
  expect(filter.status).toBe('RUNNING');
  expect(filter.leaseExpiresAt.$lt).toBeInstanceOf(Date);
  expect(filter.$expr).toEqual({ $gte: ['$attempts', '$maxAttempts'] });
  expect(update.$set.status).toBe('FAILED');
  expect(update.$set.lockedBy).toBeNull();
});