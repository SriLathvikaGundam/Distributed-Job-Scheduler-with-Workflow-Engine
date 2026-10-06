const { STATUS, canTransition, assertTransition, isTerminal } = require('../src/core/stateMachine');

describe('job state machine', () => {
  test('allows the normal happy path', () => {
    expect(canTransition(STATUS.PENDING, STATUS.RUNNING)).toBe(true);
    expect(canTransition(STATUS.RUNNING, STATUS.SUCCESS)).toBe(true);
  });

  test('allows retry flow', () => {
    expect(canTransition(STATUS.RUNNING, STATUS.RETRYING)).toBe(true);
    expect(canTransition(STATUS.RETRYING, STATUS.RUNNING)).toBe(true);
    expect(canTransition(STATUS.RUNNING, STATUS.FAILED)).toBe(true);
  });

  test('allows re-claim of an expired lease (RUNNING -> RUNNING)', () => {
    expect(canTransition(STATUS.RUNNING, STATUS.RUNNING)).toBe(true);
  });

  test('only FAILED jobs can be manually retried', () => {
    expect(canTransition(STATUS.FAILED, STATUS.PENDING)).toBe(true);
    expect(canTransition(STATUS.SUCCESS, STATUS.PENDING)).toBe(false);
    expect(canTransition(STATUS.CANCELLED, STATUS.PENDING)).toBe(false);
  });

  test('a running job cannot be cancelled directly', () => {
    expect(canTransition(STATUS.RUNNING, STATUS.CANCELLED)).toBe(false);
  });

  test('rejects skipping states', () => {
    expect(canTransition(STATUS.PENDING, STATUS.SUCCESS)).toBe(false);
    expect(() => assertTransition(STATUS.PENDING, STATUS.SUCCESS)).toThrow(/Illegal job transition/);
  });

  test('terminal states', () => {
    expect(isTerminal(STATUS.SUCCESS)).toBe(true);
    expect(isTerminal(STATUS.CANCELLED)).toBe(true);
    expect(isTerminal(STATUS.RUNNING)).toBe(false);
  });
});