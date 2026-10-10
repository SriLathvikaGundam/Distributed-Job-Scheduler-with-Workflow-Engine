jest.mock('../src/models/Job', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../src/services/dependencyService');
const Job = require('../src/models/Job');
const { advanceDependents } = require('../src/services/dependencyService');
const { completeJob, failJob } = require('../src/services/jobService');

beforeEach(() => jest.resetAllMocks());

const makeJob = (over = {}) => ({ _id: 'j1', attempts: 1, maxAttempts: 3, lockedBy: 'w1', workflowId: 'wf1', ...over });

describe('completeJob in a workflow', () => {
  test('tells the waiting steps that this job succeeded', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ status: 'SUCCESS' });
    advanceDependents.mockResolvedValue([]);

    await completeJob(makeJob(), {});
    expect(advanceDependents).toHaveBeenCalledWith('j1');
  });

  test('does nothing extra for a standalone job', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ status: 'SUCCESS' });
    await completeJob(makeJob({ workflowId: null }), {});
    expect(advanceDependents).not.toHaveBeenCalled();
  });

  test('does not notify when the lease was lost', async () => {
    Job.findOneAndUpdate.mockResolvedValue(null);
    await completeJob(makeJob(), {});
    expect(advanceDependents).not.toHaveBeenCalled();
  });

  test('still reports success if notifying fails (the reconciler repairs it later)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    Job.findOneAndUpdate.mockResolvedValue({ status: 'SUCCESS' });
    advanceDependents.mockRejectedValue(new Error('db blip'));

    await expect(completeJob(makeJob(), {})).resolves.toEqual({ status: 'SUCCESS' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('failJob in a workflow', () => {
  test('a FINAL failure tells the waiting steps', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ status: 'FAILED' });
    advanceDependents.mockResolvedValue([]);

    await failJob(makeJob({ attempts: 3, maxAttempts: 3 }), new Error('boom'));
    expect(advanceDependents).toHaveBeenCalledWith('j1');
  });

  test('a failure that will be retried does NOT disturb the waiting steps', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ status: 'RETRYING' });

    await failJob(makeJob({ attempts: 1, maxAttempts: 3 }), new Error('boom'));
    expect(advanceDependents).not.toHaveBeenCalled();
  });

  test('a standalone job that fails finally notifies nobody', async () => {
    Job.findOneAndUpdate.mockResolvedValue({ status: 'FAILED' });
    await failJob(makeJob({ attempts: 3, maxAttempts: 3, workflowId: null }), new Error('boom'));
    expect(advanceDependents).not.toHaveBeenCalled();
  });
});