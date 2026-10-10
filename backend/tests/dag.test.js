const { validateSteps, topologicalOrder, workflowStatus, MAX_STEPS } = require('../src/core/dag');

const step = (name, dependsOn, extra = {}) => ({ name, type: 'echo', ...(dependsOn && { dependsOn }), ...extra });

describe('validateSteps: valid graphs', () => {
  test('accepts a diamond and returns an order where dependencies come first', () => {
    const steps = [
      step('load', ['transform-a', 'transform-b']),
      step('transform-a', ['extract']),
      step('transform-b', ['extract']),
      step('extract'),
    ];
    const { error, order } = validateSteps(steps);
    expect(error).toBeUndefined();
    expect(order).toHaveLength(4);
    expect(order.indexOf('extract')).toBeLessThan(order.indexOf('transform-a'));
    expect(order.indexOf('extract')).toBeLessThan(order.indexOf('transform-b'));
    expect(order.indexOf('transform-a')).toBeLessThan(order.indexOf('load'));
    expect(order.indexOf('transform-b')).toBeLessThan(order.indexOf('load'));
  });

  test('accepts independent steps with no dependencies at all', () => {
    expect(validateSteps([step('a'), step('b')]).error).toBeUndefined();
  });
});

describe('validateSteps: bad input', () => {
  test('rejects a missing or empty steps list', () => {
    expect(validateSteps(undefined).error).toMatch(/non-empty array/);
    expect(validateSteps([]).error).toMatch(/non-empty array/);
    expect(validateSteps('nope').error).toMatch(/non-empty array/);
  });

  test('rejects too many steps', () => {
    const many = Array.from({ length: MAX_STEPS + 1 }, (_, i) => step(`s${i}`));
    expect(validateSteps(many).error).toMatch(/at most/);
  });

  test('rejects bad step names', () => {
    expect(validateSteps([step('has space')]).error).toMatch(/"name"/);
    expect(validateSteps([{ type: 'echo' }]).error).toMatch(/"name"/);
  });

  test('rejects duplicate step names', () => {
    expect(validateSteps([step('a'), step('a')]).error).toMatch(/duplicate step name "a"/);
  });

  test('rejects a missing type, bad payload, bad maxAttempts, bad dependsOn', () => {
    expect(validateSteps([{ name: 'a' }]).error).toMatch(/"type" is required/);
    expect(validateSteps([step('a', undefined, { payload: [1] })]).error).toMatch(/"payload"/);
    expect(validateSteps([step('a', undefined, { maxAttempts: 99 })]).error).toMatch(/"maxAttempts"/);
    expect(validateSteps([step('a', undefined, { dependsOn: 'b' })]).error).toMatch(/"dependsOn"/);
  });

  test('rejects an unknown dependency', () => {
    expect(validateSteps([step('a', ['ghost'])]).error).toMatch(/unknown step "ghost"/);
  });

  test('rejects a step that depends on itself', () => {
    expect(validateSteps([step('a', ['a'])]).error).toMatch(/cannot depend on itself/);
  });

  test('rejects a repeated dependency', () => {
    expect(validateSteps([step('a'), step('b', ['a', 'a'])]).error).toMatch(/same dependency twice/);
  });

  test('rejects a two-step cycle', () => {
    const { error } = validateSteps([step('a', ['b']), step('b', ['a'])]);
    expect(error).toMatch(/cycle/);
    expect(error).toMatch(/a/);
    expect(error).toMatch(/b/);
  });

  test('rejects a longer cycle even when other steps are fine', () => {
    const { error } = validateSteps([step('ok'), step('a', ['c']), step('b', ['a']), step('c', ['b'])]);
    expect(error).toMatch(/cycle/);
  });
});

describe('topologicalOrder', () => {
  test('reports the stuck steps when there is a cycle', () => {
    const result = topologicalOrder([step('a', ['b']), step('b', ['a']), step('free')]);
    expect(result.ok).toBe(false);
    expect(result.stuck.sort()).toEqual(['a', 'b']);
  });
});

describe('workflowStatus', () => {
  test('is RUNNING while any step is active, even if another already failed', () => {
    expect(workflowStatus(['SUCCESS', 'RUNNING'])).toBe('RUNNING');
    expect(workflowStatus(['SUCCESS', 'BLOCKED'])).toBe('RUNNING');
    expect(workflowStatus(['PENDING', 'BLOCKED'])).toBe('RUNNING');
    expect(workflowStatus(['RETRYING', 'SUCCESS'])).toBe('RUNNING');
    expect(workflowStatus(['FAILED', 'RUNNING'])).toBe('RUNNING');
  });

  test('is FAILED once nothing is active and a step failed', () => {
    expect(workflowStatus(['SUCCESS', 'FAILED', 'CANCELLED'])).toBe('FAILED');
  });

  test('is CANCELLED when nothing failed but something was cancelled', () => {
    expect(workflowStatus(['SUCCESS', 'CANCELLED'])).toBe('CANCELLED');
  });

  test('is SUCCESS only when every step succeeded', () => {
    expect(workflowStatus(['SUCCESS', 'SUCCESS'])).toBe('SUCCESS');
  });

  test('is PENDING when there are no steps yet', () => {
    expect(workflowStatus([])).toBe('PENDING');
  });
});