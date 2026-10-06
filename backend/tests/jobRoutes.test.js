const request = require('supertest');

jest.mock('../src/services/jobService');
const service = require('../src/services/jobService');
const app = require('../src/app');

const VALID_ID = '64b7f0c2a1b2c3d4e5f60718';

beforeEach(() => jest.resetAllMocks());

describe('POST /api/jobs', () => {
  test('400 when type is missing', async () => {
    const res = await request(app).post('/api/jobs').send({ payload: {} });
    expect(res.status).toBe(400);
    expect(service.createJob).not.toHaveBeenCalled();
  });

  test('400 when payload is not an object', async () => {
    const res = await request(app).post('/api/jobs').send({ type: 'echo', payload: 'hi' });
    expect(res.status).toBe(400);
  });

  test('400 when maxAttempts is out of range', async () => {
    const res = await request(app).post('/api/jobs').send({ type: 'echo', maxAttempts: 50 });
    expect(res.status).toBe(400);
  });

  test('400 when runAt is not a date', async () => {
    const res = await request(app).post('/api/jobs').send({ type: 'echo', runAt: 'tomorrow-ish' });
    expect(res.status).toBe(400);
  });

  test('201 and returns the job when valid', async () => {
    service.createJob.mockResolvedValue({ _id: VALID_ID, type: 'echo', status: 'PENDING' });
    const res = await request(app).post('/api/jobs').send({ type: ' echo ', payload: { a: 1 } });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(service.createJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'echo', payload: { a: 1 } }));
  });
});

describe('GET /api/jobs/:id', () => {
  test('400 for a malformed id', async () => {
    const res = await request(app).get('/api/jobs/hello');
    expect(res.status).toBe(400);
  });

  test('404 when the job does not exist', async () => {
    service.getJob.mockResolvedValue(null);
    const res = await request(app).get(`/api/jobs/${VALID_ID}`);
    expect(res.status).toBe(404);
  });

  test('200 when found', async () => {
    service.getJob.mockResolvedValue({ _id: VALID_ID, type: 'echo' });
    const res = await request(app).get(`/api/jobs/${VALID_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('echo');
  });
});

describe('GET /api/jobs', () => {
  test('400 for an invalid status filter', async () => {
    const res = await request(app).get('/api/jobs?status=BANANA');
    expect(res.status).toBe(400);
  });

  test('passes filters and clamps limit', async () => {
    service.listJobs.mockResolvedValue({ items: [], total: 0 });
    const res = await request(app).get('/api/jobs?status=PENDING&type=echo&limit=9999');
    expect(res.status).toBe(200);
    expect(service.listJobs).toHaveBeenCalledWith({ status: 'PENDING', type: 'echo', limit: 200, skip: 0 });
  });
});