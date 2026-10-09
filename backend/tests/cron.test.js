const { validateCron, nextRun } = require('../src/core/cron');

describe('nextRun', () => {
  test('finds the next matching minute', () => {
    const next = nextRun('*/5 * * * *', new Date('2030-01-01T10:02:00Z'));
    expect(next.toISOString()).toBe('2030-01-01T10:05:00.000Z');
  });

  test('is always strictly after the starting time', () => {
    const next = nextRun('*/5 * * * *', new Date('2030-01-01T10:05:00Z'));
    expect(next.toISOString()).toBe('2030-01-01T10:10:00.000Z');
  });

  test('respects the timezone (9 AM in Kolkata is 03:30 UTC)', () => {
    const next = nextRun('0 9 * * *', new Date('2030-01-01T10:00:00Z'), 'Asia/Kolkata');
    expect(next.toISOString()).toBe('2030-01-02T03:30:00.000Z');
  });
});

describe('validateCron', () => {
  test('accepts valid expressions', () => {
    expect(validateCron('* * * * *')).toBeNull();
    expect(validateCron('*/15 9-17 * * mon-fri', 'Asia/Kolkata')).toBeNull();
  });

  test('rejects a missing expression', () => {
    expect(validateCron(undefined)).toMatch(/required/);
    expect(validateCron('   ')).toMatch(/required/);
  });

  test('rejects the wrong number of fields', () => {
    expect(validateCron('* * * *')).toMatch(/5 fields/);
    expect(validateCron('* * * * * *')).toMatch(/5 fields/);
  });

  test('rejects out-of-range values', () => {
    expect(validateCron('61 * * * *')).toMatch(/invalid cron/);
  });

  test('rejects an unknown timezone', () => {
    expect(validateCron('* * * * *', 'Mars/Base')).toMatch(/unknown timezone/);
  });
});