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
    service.createJob.mockResolvedValue({ job: { _id: VALID_ID, type: 'echo', status: 'PENDING' }, created: true });
    const res = await request(app).post('/api/jobs').send({ type: ' echo ', payload: { a: 1 } });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(service.createJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'echo', payload: { a: 1 } }));
  });

  test('passes the Idempotency-Key header to the service', async () => {
    service.createJob.mockResolvedValue({ job: { _id: VALID_ID }, created: true });
    await request(app).post('/api/jobs').set('Idempotency-Key', ' order-123 ').send({ type: 'echo' });
    expect(service.createJob).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'order-123' }));
  });

  test('200 with a replay header when the key was already used', async () => {
    service.createJob.mockResolvedValue({ job: { _id: VALID_ID, type: 'echo' }, created: false });
    const res = await request(app).post('/api/jobs').set('Idempotency-Key', 'order-123').send({ type: 'echo' });
    expect(res.status).toBe(200);
    expect(res.headers['idempotency-replayed']).toBe('true');
    expect(res.body._id).toBe(VALID_ID);
  });

  test('400 for an over-long Idempotency-Key', async () => {
    const res = await request(app).post('/api/jobs').set('Idempotency-Key', 'x'.repeat(300)).send({ type: 'echo' });
    expect(res.status).toBe(400);
    expect(service.createJob).not.toHaveBeenCalled();
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

describe('POST /api/jobs/:id/cancel', () => {
  test('400 for a malformed id', async () => {
    const res = await request(app).post('/api/jobs/hello/cancel');
    expect(res.status).toBe(400);
  });

  test('200 with the cancelled job', async () => {
    service.cancelJob.mockResolvedValue({ _id: VALID_ID, status: 'CANCELLED' });
    const res = await request(app).post(`/api/jobs/${VALID_ID}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
  });

  test('404 when the job does not exist', async () => {
    service.cancelJob.mockResolvedValue(null);
    service.getJob.mockResolvedValue(null);
    const res = await request(app).post(`/api/jobs/${VALID_ID}/cancel`);
    expect(res.status).toBe(404);
  });

  test('409 when the job exists but cannot be cancelled', async () => {
    service.cancelJob.mockResolvedValue(null);
    service.getJob.mockResolvedValue({ _id: VALID_ID, status: 'RUNNING' });
    const res = await request(app).post(`/api/jobs/${VALID_ID}/cancel`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/RUNNING/);
  });
});

describe('POST /api/jobs/:id/retry', () => {
  test('200 with the re-queued job', async () => {
    service.retryFailedJob.mockResolvedValue({ _id: VALID_ID, status: 'PENDING', attempts: 0 });
    const res = await request(app).post(`/api/jobs/${VALID_ID}/retry`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING');
  });

  test('404 when the job does not exist', async () => {
    service.retryFailedJob.mockResolvedValue(null);
    service.getJob.mockResolvedValue(null);
    const res = await request(app).post(`/api/jobs/${VALID_ID}/retry`);
    expect(res.status).toBe(404);
  });

  test('409 when the job is not FAILED', async () => {
    service.retryFailedJob.mockResolvedValue(null);
    service.getJob.mockResolvedValue({ _id: VALID_ID, status: 'SUCCESS' });
    const res = await request(app).post(`/api/jobs/${VALID_ID}/retry`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/SUCCESS/);
  });
});