import { toLocalInputValue } from './format';

// Handlers the backend ships with. The field also accepts any other type you register.
export const JOB_TYPES = ['echo', 'sleep', 'flaky', 'alwaysFail'];

export const EMPTY_FORM = { type: 'echo', payload: '{}', maxAttempts: '3', runAt: '', idempotencyKey: '' };

// One-click examples that each show a different behaviour of the scheduler.
export const PRESETS = [
  { label: 'Quick echo', fill: () => ({ ...EMPTY_FORM, type: 'echo', payload: '{"message": "hello"}' }) },
  { label: 'Slow job (3s)', fill: () => ({ ...EMPTY_FORM, type: 'sleep', payload: '{"ms": 3000}' }) },
  { label: 'Always fails', fill: () => ({ ...EMPTY_FORM, type: 'alwaysFail', maxAttempts: '4' }) },
  { label: 'Flaky (70% fail)', fill: () => ({ ...EMPTY_FORM, type: 'flaky', payload: '{"failRate": 0.7}', maxAttempts: '5' }) },
  {
    label: 'Run in 30s',
    fill: (now = Date.now()) => ({
      ...EMPTY_FORM,
      payload: '{"message": "scheduled"}',
      runAt: toLocalInputValue(new Date(now + 30000)),
    }),
  },
];

// Returns { value } or { error }. An empty box means "no payload".
export function parsePayload(text) {
  const trimmed = text.trim();
  if (trimmed === '') return { value: {} };

  let value;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { error: 'The payload is not valid JSON.' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'The payload must be a JSON object, like {"ms": 1000}.' };
  }
  return { value };
}

// Turns the form's text fields into what the API expects, or explains what to fix.
export function buildJobRequest(form) {
  const type = form.type.trim();
  if (!type) return { error: 'Enter a job type.' };

  const payload = parsePayload(form.payload);
  if (payload.error) return { error: payload.error };

  const maxAttempts = Number(form.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    return { error: 'Max attempts must be a whole number from 1 to 10.' };
  }

  const body = { type, payload: payload.value, maxAttempts };
  if (form.runAt) {
    const runAt = new Date(form.runAt);
    if (Number.isNaN(runAt.getTime())) return { error: 'Run at is not a valid date and time.' };
    body.runAt = runAt.toISOString();
  }

  const idempotencyKey = form.idempotencyKey.trim();
  return { body, idempotencyKey: idempotencyKey || undefined };
}