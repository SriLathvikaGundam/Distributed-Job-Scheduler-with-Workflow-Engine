const Job = require('../src/models/Job');
const { STATUS } = require('../src/core/stateMachine');

// Runs validation and returns the error (or null if the job is valid).
async function validationError(data) {
  try {
    await new Job(data).validate();
    return null;
  } catch (err) {
    return err;
  }
}

describe('Job model', () => {
  test('applies sensible defaults', async () => {
    const job = new Job({ type: 'echo' });
    expect(job.status).toBe(STATUS.PENDING);
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(3);
    expect(job.payload).toEqual({});
    expect(job.runAt).toBeInstanceOf(Date);
    expect(job.lockedBy).toBeNull();
    await expect(job.validate()).resolves.toBeUndefined(); // valid job
  });

  test('type is required', async () => {
    const err = await validationError({});
    expect(err.errors.type).toBeDefined();
  });

  test('rejects an unknown status', async () => {
    const err = await validationError({ type: 'echo', status: 'BANANA' });
    expect(err.errors.status).toBeDefined();
  });

  test('maxAttempts must be at least 1', async () => {
    const err = await validationError({ type: 'echo', maxAttempts: 0 });
    expect(err.errors.maxAttempts).toBeDefined();
  });
});


describe('Job model: workflow fields', () => {
  test('standalone jobs have no workflow and no dependencies', () => {
    const job = new Job({ type: 'echo' });
    expect(job.workflowId).toBeNull();
    expect(job.dependsOn).toEqual([]);
  });

  test('accepts the BLOCKED status', async () => {
    await expect(new Job({ type: 'echo', status: STATUS.BLOCKED }).validate()).resolves.toBeUndefined();
  });
});