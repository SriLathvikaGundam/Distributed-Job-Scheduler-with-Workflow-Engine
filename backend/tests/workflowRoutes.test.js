const request = require('supertest');

jest.mock('../src/services/workflowService');
const service = require('../src/services/workflowService');
const app = require('../src/app');

const ID = '64b7f0c2a1b2c3d4e5f60718';
const steps = [{ name: 'a', type: 'echo' }, { name: 'b', type: 'echo', dependsOn: ['a'] }];

beforeEach(() => jest.resetAllMocks());

describe('POST /api/workflows', () => {
  test('400 when name is missing', async () => {
    const res = await request(app).post('/api/workflows').send({ steps });
    expect(res.status).toBe(400);
    expect(service.createWorkflow).not.toHaveBeenCalled();
  });

  test('400 when steps are missing', async () => {
    const res = await request(app).post('/api/workflows').send({ name: 'x' });
    expect(res.status).toBe(400);
  });

  test('400 with a clear message for a dependency cycle', async () => {
    const res = await request(app)
      .post('/api/workflows')
      .send({ name: 'x', steps: [{ name: 'a', type: 'echo', dependsOn: ['b'] }, { name: 'b', type: 'echo', dependsOn: ['a'] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cycle/);
    expect(service.createWorkflow).not.toHaveBeenCalled();
  });

  test('400 for an unknown dependency', async () => {
    const res = await request(app)
      .post('/api/workflows')
      .send({ name: 'x', steps: [{ name: 'a', type: 'echo', dependsOn: ['ghost'] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ghost/);
  });

  test('201 and passes the trimmed name and steps to the service', async () => {
    service.createWorkflow.mockResolvedValue({ id: ID, name: 'pipeline', status: 'RUNNING', steps: [] });
    const res = await request(app).post('/api/workflows').send({ name: '  pipeline ', steps });

    expect(res.status).toBe(201);
    expect(service.createWorkflow).toHaveBeenCalledWith({ name: 'pipeline', steps });
  });
});

describe('GET /api/workflows', () => {
  test('200 with the list, clamping the limit', async () => {
    service.listWorkflows.mockResolvedValue({ items: [], total: 0 });
    const res = await request(app).get('/api/workflows?limit=9999');
    expect(res.status).toBe(200);
    expect(service.listWorkflows).toHaveBeenCalledWith({ limit: 100, skip: 0 });
  });

  test('400 for a malformed id', async () => {
    expect((await request(app).get('/api/workflows/hello')).status).toBe(400);
  });

  test('404 when the workflow does not exist', async () => {
    service.getWorkflow.mockResolvedValue(null);
    expect((await request(app).get(`/api/workflows/${ID}`)).status).toBe(404);
  });

  test('200 when found', async () => {
    service.getWorkflow.mockResolvedValue({ id: ID, name: 'pipeline', steps: [] });
    const res = await request(app).get(`/api/workflows/${ID}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('pipeline');
  });
});

describe('POST /api/workflows/:id/cancel', () => {
  test('404 when the workflow does not exist', async () => {
    service.cancelWorkflow.mockResolvedValue(null);
    expect((await request(app).post(`/api/workflows/${ID}/cancel`)).status).toBe(404);
  });

  test('200 with the cancelled count', async () => {
    service.cancelWorkflow.mockResolvedValue({ cancelledSteps: 2, workflow: { id: ID } });
    const res = await request(app).post(`/api/workflows/${ID}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.cancelledSteps).toBe(2);
  });
});