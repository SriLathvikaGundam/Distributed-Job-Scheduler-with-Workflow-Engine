const { whyNotClaimed, shouldDiscard } = require('../src/core/claimReason');

const now = new Date('2030-01-01T10:00:00Z');
const past = new Date('2030-01-01T09:00:00Z');
const future = new Date('2030-01-01T11:00:00Z');

describe('whyNotClaimed', () => {
  test('a deleted job is MISSING', () => {
    expect(whyNotClaimed(null, now)).toBe('MISSING');
  });

  test('finished jobs are FINISHED', () => {
    for (const status of ['SUCCESS', 'FAILED', 'CANCELLED']) {
      expect(whyNotClaimed({ status }, now)).toBe('FINISHED');
    }
  });

  test('a blocked job is BLOCKED', () => {
    expect(whyNotClaimed({ status: 'BLOCKED' }, now)).toBe('BLOCKED');
  });

  test('a waiting job that could not be claimed is NOT_DUE', () => {
    expect(whyNotClaimed({ status: 'PENDING', runAt: future }, now)).toBe('NOT_DUE');
    expect(whyNotClaimed({ status: 'RETRYING', runAt: future }, now)).toBe('NOT_DUE');
  });

  test('a running job with a live lease is LEASED', () => {
    expect(whyNotClaimed({ status: 'RUNNING', leaseExpiresAt: future, attempts: 1, maxAttempts: 3 }, now)).toBe('LEASED');
  });

  test('a running job whose lease expired with no attempts left is EXHAUSTED', () => {
    expect(whyNotClaimed({ status: 'RUNNING', leaseExpiresAt: past, attempts: 3, maxAttempts: 3 }, now)).toBe('EXHAUSTED');
  });

  test('an expired lease with attempts remaining is not EXHAUSTED', () => {
    expect(whyNotClaimed({ status: 'RUNNING', leaseExpiresAt: past, attempts: 1, maxAttempts: 3 }, now)).toBe('LEASED');
  });
});

describe('shouldDiscard', () => {
  test('deletes messages that can never lead to a run', () => {
    for (const reason of ['MISSING', 'FINISHED', 'BLOCKED', 'EXHAUSTED']) expect(shouldDiscard(reason)).toBe(true);
  });

  test('keeps messages that may still be needed for recovery', () => {
    for (const reason of ['LEASED', 'NOT_DUE']) expect(shouldDiscard(reason)).toBe(false);
  });
});