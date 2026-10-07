const { backoffMs } = require('../src/core/backoff');

describe('backoffMs', () => {
  const rngMax = () => 0.999999; // top of the jitter range
  const rngMin = () => 0; // bottom of the jitter range

  test('doubles the range with each attempt', () => {
    expect(backoffMs(1, { baseMs: 1000, rng: rngMin })).toBe(500);
    expect(backoffMs(2, { baseMs: 1000, rng: rngMin })).toBe(1000);
    expect(backoffMs(3, { baseMs: 1000, rng: rngMin })).toBe(2000);
    expect(backoffMs(3, { baseMs: 1000, rng: rngMax })).toBeLessThan(4000);
  });

  test('jitter stays within [exp/2, exp)', () => {
    for (let i = 0; i < 200; i++) {
      const v = backoffMs(4, { baseMs: 1000 }); // exp = 8000
      expect(v).toBeGreaterThanOrEqual(4000);
      expect(v).toBeLessThan(8000);
    }
  });

  test('is capped at maxMs', () => {
    expect(backoffMs(30, { baseMs: 1000, maxMs: 60000, rng: rngMin })).toBe(30000);
    expect(backoffMs(30, { baseMs: 1000, maxMs: 60000, rng: rngMax })).toBeLessThan(60000);
  });

  test('treats attempt < 1 as 1', () => {
    expect(backoffMs(0, { baseMs: 1000, rng: rngMin })).toBe(500);
  });
});