jest.mock('../src/models/Job', () => ({ find: jest.fn(), findOneAndUpdate: jest.fn() }));
const Job = require('../src/models/Job');
const { advanceDependents, reconcileBlocked } = require('../src/services/dependencyService');

beforeEach(() => jest.resetAllMocks());

const blockedJob = { _id: 'c', dependsOn: ['a', 'b'] };

// find() is used three ways: the dependency lookup, "who is blocked on X", and the reconcile pages.
function mockFind({ deps = [], blockedOn = {} } = {}) {
  Job.find.mockImplementation((filter) => {
    if (filter._id && filter._id.$in) return Promise.resolve(deps);
    if (filter.dependsOn) return Promise.resolve(blockedOn[filter.dependsOn] || []);
    throw new Error(`unexpected find: ${JSON.stringify(filter)}`);
  });
}

describe('advanceDependents', () => {
  test('releases a BLOCKED job when every dependency succeeded', async () => {
    mockFind({ deps: [{ status: 'SUCCESS' }, { status: 'SUCCESS' }], blockedOn: { a: [blockedJob] } });
    Job.findOneAndUpdate.mockResolvedValue({ _id: 'c' });

    await expect(advanceDependents('a')).resolves.toEqual(['released']);

    const [filter, update] = Job.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 'c', status: 'BLOCKED' });
    expect(update.$set.status).toBe('PENDING');
    expect(update.$set.runAt).toBeInstanceOf(Date);
  });

  test('keeps waiting while a dependency is still running', async () => {
    mockFind({ deps: [{ status: 'SUCCESS' }, { status: 'RUNNING' }], blockedOn: { a: [blockedJob] } });

    await expect(advanceDependents('a')).resolves.toEqual(['waiting']);
    expect(Job.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('keeps waiting when a dependency does not exist yet, even if the others succeeded', async () => {
    mockFind({ deps: [{ status: 'SUCCESS' }], blockedOn: { a: [blockedJob] } }); // 1 of 2 found
    await expect(advanceDependents('a')).resolves.toEqual(['waiting']);
    expect(Job.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('cancels a job whose dependency FAILED, naming the culprit', async () => {
    mockFind({
      deps: [{ status: 'SUCCESS' }, { status: 'FAILED', stepName: 'extract' }],
      blockedOn: { a: [blockedJob] },
    });
    Job.findOneAndUpdate.mockResolvedValue({ _id: 'c' });

    await expect(advanceDependents('a')).resolves.toEqual(['cancelled']);
    const update = Job.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.status).toBe('CANCELLED');
    expect(update.$set.lastError).toBe('Upstream step "extract" failed');
  });

  test('also cancels when a dependency was CANCELLED', async () => {
    mockFind({ deps: [{ status: 'CANCELLED', stepName: 'x' }, { status: 'SUCCESS' }], blockedOn: { a: [blockedJob] } });
    Job.findOneAndUpdate.mockResolvedValue({ _id: 'c' });

    await expect(advanceDependents('a')).resolves.toEqual(['cancelled']);
    expect(Job.findOneAndUpdate.mock.calls[0][1].$set.lastError).toBe('Upstream step "x" cancelled');
  });

  test('cascades: cancelling a step also re-checks the steps waiting on it', async () => {
    mockFind({
      deps: [{ status: 'FAILED', stepName: 'a' }],
      blockedOn: { a: [{ _id: 'c', dependsOn: ['a'] }], c: [] }, // nothing is waiting on c in this test
    });
    Job.findOneAndUpdate.mockResolvedValue({ _id: 'c' });

    await advanceDependents('a');

    const lookedUp = Job.find.mock.calls.map(([f]) => f.dependsOn).filter(Boolean);
    expect(lookedUp).toEqual(['a', 'c']); // after cancelling c, it asked who depends on c
  });

  test('does nothing if another worker already moved the job', async () => {
    mockFind({ deps: [{ status: 'SUCCESS' }, { status: 'SUCCESS' }], blockedOn: { a: [blockedJob] } });
    Job.findOneAndUpdate.mockResolvedValue(null);

    await expect(advanceDependents('a')).resolves.toEqual(['unchanged']);
  });

  test('returns an empty list when nothing is waiting', async () => {
    mockFind({ blockedOn: { a: [] } });
    await expect(advanceDependents('a')).resolves.toEqual([]);
  });
});

describe('reconcileBlocked', () => {
  test('re-checks every blocked job, page by page, and counts the ones it changed', async () => {
    const page = [
      { _id: 'c1', dependsOn: ['a'] },
      { _id: 'c2', dependsOn: ['b'] },
    ];
    let pagesServed = 0;
    Job.find.mockImplementation((filter) => {
      if (filter._id && filter._id.$in) {
        // c1 depends on a (SUCCESS), c2 depends on b (still RUNNING)
        return Promise.resolve([{ status: filter._id.$in[0] === 'a' ? 'SUCCESS' : 'RUNNING' }]);
      }
      return { sort: () => ({ limit: () => Promise.resolve(pagesServed++ === 0 ? page : []) }) };
    });
    Job.findOneAndUpdate.mockResolvedValue({ _id: 'x' });

    await expect(reconcileBlocked()).resolves.toBe(1); // only c1 was released
    expect(Job.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test('does nothing when no job is blocked', async () => {
    Job.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });
    await expect(reconcileBlocked()).resolves.toBe(0);
  });
});