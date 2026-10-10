jest.mock('../src/models/Workflow', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  deleteOne: jest.fn(),
}));
jest.mock('../src/models/Job', () => ({
  insertMany: jest.fn(),
  deleteMany: jest.fn(),
  find: jest.fn(),
  updateMany: jest.fn(),
}));
const Workflow = require('../src/models/Workflow');
const Job = require('../src/models/Job');
const service = require('../src/services/workflowService');

beforeEach(() => jest.resetAllMocks());

const WF = { _id: 'wf1', name: 'pipeline', createdAt: new Date('2030-01-01') };

const diamond = [
  { name: 'extract', type: 'sleep', payload: { ms: 10 } },
  { name: 'a', type: 'echo', dependsOn: ['extract'] },
  { name: 'b', type: 'echo', dependsOn: ['extract'], maxAttempts: 5 },
  { name: 'load', type: 'echo', dependsOn: ['a', 'b'] },
];

// After creating, the service reads the workflow back: feed it the documents that were inserted.
function mockReadBack() {
  Workflow.create.mockResolvedValue(WF);
  Workflow.findById.mockResolvedValue(WF);
  Job.insertMany.mockImplementation(async (docs) => docs);
  Job.find.mockImplementation(() => ({
    sort: async () => Job.insertMany.mock.calls.flatMap(([docs]) => docs).sort((x, y) => (x._id > y._id ? 1 : -1)),
  }));
}

describe('createWorkflow', () => {
  test('inserts steps with dependencies FIRST (blocked) and dependency-free steps LAST', async () => {
    mockReadBack();
    await service.createWorkflow({ name: 'pipeline', steps: diamond });

    expect(Job.insertMany).toHaveBeenCalledTimes(2);
    const [first, second] = Job.insertMany.mock.calls.map(([docs]) => docs);
    expect(first.map((d) => d.stepName).sort()).toEqual(['a', 'b', 'load']);
    expect(first.every((d) => d.status === 'BLOCKED')).toBe(true);
    expect(second.map((d) => d.stepName)).toEqual(['extract']);
    expect(second[0].status).toBe('PENDING');
  });

  test('links steps together by id and tags them with the workflow', async () => {
    mockReadBack();
    await service.createWorkflow({ name: 'pipeline', steps: diamond });

    const all = Job.insertMany.mock.calls.flatMap(([docs]) => docs);
    const byName = Object.fromEntries(all.map((d) => [d.stepName, d]));
    expect(all.every((d) => d.workflowId === 'wf1')).toBe(true);
    expect(byName.a.dependsOn).toEqual([byName.extract._id]);
    expect(byName.load.dependsOn).toEqual([byName.a._id, byName.b._id]);
    expect(byName.extract.dependsOn).toEqual([]);
    expect(byName.b.maxAttempts).toBe(5);
    expect(byName.a).not.toHaveProperty('maxAttempts'); // falls back to the model default
  });

  test('independent steps need only one insert', async () => {
    mockReadBack();
    await service.createWorkflow({ name: 'p', steps: [{ name: 'x', type: 'echo' }, { name: 'y', type: 'echo' }] });
    expect(Job.insertMany).toHaveBeenCalledTimes(1);
    expect(Job.insertMany.mock.calls[0][0].every((d) => d.status === 'PENDING')).toBe(true);
  });

  test('returns the workflow with step names, in the order the client listed them', async () => {
    mockReadBack();
    const view = await service.createWorkflow({ name: 'pipeline', steps: diamond });

    expect(view.name).toBe('pipeline');
    expect(view.status).toBe('RUNNING');
    const load = view.steps.find((s) => s.name === 'load');
    expect(load.dependsOn).toEqual(['a', 'b']);
    expect(load.status).toBe('BLOCKED');
  });

  test('cleans up and rethrows if inserting fails halfway', async () => {
    Workflow.create.mockResolvedValue(WF);
    Job.insertMany.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('db down'));
    Job.deleteMany.mockResolvedValue({});
    Workflow.deleteOne.mockResolvedValue({});

    await expect(service.createWorkflow({ name: 'pipeline', steps: diamond })).rejects.toThrow('db down');
    expect(Job.deleteMany).toHaveBeenCalledWith({ workflowId: 'wf1' });
    expect(Workflow.deleteOne).toHaveBeenCalledWith({ _id: 'wf1' });
  });
});

describe('getWorkflow', () => {
  test('returns null for an unknown workflow', async () => {
    Workflow.findById.mockResolvedValue(null);
    await expect(service.getWorkflow('nope')).resolves.toBeNull();
  });

  test('works out the overall status from the steps', async () => {
    Workflow.findById.mockResolvedValue(WF);
    Job.find.mockReturnValue({
      sort: async () => [
        { _id: 'j1', stepName: 'a', type: 'echo', status: 'SUCCESS', attempts: 1, maxAttempts: 3, dependsOn: [] },
        { _id: 'j2', stepName: 'b', type: 'echo', status: 'FAILED', attempts: 3, maxAttempts: 3, dependsOn: ['j1'], lastError: 'boom' },
        { _id: 'j3', stepName: 'c', type: 'echo', status: 'CANCELLED', attempts: 0, maxAttempts: 3, dependsOn: ['j2'] },
      ],
    });

    const view = await service.getWorkflow('wf1');
    expect(view.status).toBe('FAILED');
    expect(view.steps.map((s) => s.dependsOn)).toEqual([[], ['a'], ['b']]);
    expect(view.steps[1].lastError).toBe('boom');
  });
});

describe('listWorkflows', () => {
  test('shows each workflow with its derived status and step count', async () => {
    const limit = jest.fn().mockResolvedValue([WF, { _id: 'wf2', name: 'other', createdAt: new Date() }]);
    Workflow.find.mockReturnValue({ sort: () => ({ skip: () => ({ limit }) }) });
    Workflow.countDocuments.mockResolvedValue(2);
    Job.find.mockResolvedValue([
      { workflowId: 'wf1', status: 'SUCCESS' },
      { workflowId: 'wf1', status: 'SUCCESS' },
      { workflowId: 'wf2', status: 'RUNNING' },
    ]);

    const { items, total } = await service.listWorkflows();
    expect(total).toBe(2);
    expect(items.map((i) => [i.name, i.status, i.stepCount])).toEqual([
      ['pipeline', 'SUCCESS', 2],
      ['other', 'RUNNING', 1],
    ]);
  });
});

describe('cancelWorkflow', () => {
  test('returns null for an unknown workflow', async () => {
    Workflow.findById.mockResolvedValue(null);
    await expect(service.cancelWorkflow('nope')).resolves.toBeNull();
    expect(Job.updateMany).not.toHaveBeenCalled();
  });

  test('cancels only steps that have not started', async () => {
    Workflow.findById.mockResolvedValue(WF);
    Job.updateMany.mockResolvedValue({ modifiedCount: 3 });
    Job.find.mockReturnValue({ sort: async () => [] });

    const result = await service.cancelWorkflow('wf1');

    const [filter, update] = Job.updateMany.mock.calls[0];
    expect(filter).toEqual({ workflowId: 'wf1', status: { $in: ['BLOCKED', 'PENDING', 'RETRYING'] } });
    expect(update.$set.status).toBe('CANCELLED');
    expect(result.cancelledSteps).toBe(3);
  });
});