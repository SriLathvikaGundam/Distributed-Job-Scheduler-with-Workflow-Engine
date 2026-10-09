const request = require('supertest');

jest.mock('../src/services/scheduleService');
const service = require('../src/services/scheduleService');
const app = require('../src/app');

const ID = '64b7f0c2a1b2c3d4e5f60718';
const valid = { name: 'nightly', type: 'echo', cron: '0 2 * * *' };

beforeEach(() => jest.resetAllMocks());

describe('POST /api/schedules', () => {
  test('400 when name is missing', async () => {
    const res = await request(app).post('/api/schedules').send({ type: 'echo', cron: '* * * * *' });
    expect(res.status).toBe(400);
    expect(service.createSchedule).not.toHaveBeenCalled();
  });

  test('400 when type is missing', async () => {
    const res = await request(app).post('/api/schedules').send({ name: 'x', cron: '* * * * *' });
    expect(res.status).toBe(400);
  });

  test('400 when cron is missing or malformed', async () => {
    let res = await request(app).post('/api/schedules').send({ name: 'x', type: 'echo' });
    expect(res.status).toBe(400);
    res = await request(app).post('/api/schedules').send({ ...valid, cron: 'every day' });
    expect(res.status).toBe(400);
    res = await request(app).post('/api/schedules').send({ ...valid, cron: '99 * * * *' });
    expect(res.status).toBe(400);
  });

  test('400 for an unknown timezone', async () => {
    const res = await request(app).post('/api/schedules').send({ ...valid, timezone: 'Mars/Base' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timezone/);
  });

  test('400 when payload is not an object', async () => {
    const res = await request(app).post('/api/schedules').send({ ...valid, payload: [1, 2] });
    expect(res.status).toBe(400);
  });

  test('400 when maxAttempts is out of range', async () => {
    const res = await request(app).post('/api/schedules').send({ ...valid, maxAttempts: 0 });
    expect(res.status).toBe(400);
  });

  test('201 and passes cleaned values to the service', async () => {
    service.createSchedule.mockResolvedValue({ _id: ID, ...valid });
    const res = await request(app)
      .post('/api/schedules')
      .send({ name: '  nightly ', type: ' echo ', cron: ' 0 2 * * * ', timezone: 'Asia/Kolkata' });

    expect(res.status).toBe(201);
    expect(service.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'nightly', type: 'echo', cron: '0 2 * * *', timezone: 'Asia/Kolkata' })
    );
  });

  test('409 when the name is already taken', async () => {
    service.createSchedule.mockRejectedValue({ code: 11000 });
    const res = await request(app).post('/api/schedules').send(valid);
    expect(res.status).toBe(409);
  });
});

describe('GET /api/schedules', () => {
  test('200 with the list', async () => {
    service.listSchedules.mockResolvedValue([{ _id: ID }]);
    const res = await request(app).get('/api/schedules');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  test('400 for a malformed id', async () => {
    const res = await request(app).get('/api/schedules/hello');
    expect(res.status).toBe(400);
  });

  test('404 when the schedule does not exist', async () => {
    service.getSchedule.mockResolvedValue(null);
    const res = await request(app).get(`/api/schedules/${ID}`);
    expect(res.status).toBe(404);
  });
});

describe('pause, resume, delete', () => {
  test('pause returns the updated schedule', async () => {
    service.pauseSchedule.mockResolvedValue({ _id: ID, enabled: false });
    const res = await request(app).post(`/api/schedules/${ID}/pause`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  test('resume returns the updated schedule', async () => {
    service.resumeSchedule.mockResolvedValue({ _id: ID, enabled: true });
    const res = await request(app).post(`/api/schedules/${ID}/resume`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  test('pause and resume return 404 for an unknown schedule', async () => {
    service.pauseSchedule.mockResolvedValue(null);
    service.resumeSchedule.mockResolvedValue(null);
    expect((await request(app).post(`/api/schedules/${ID}/pause`)).status).toBe(404);
    expect((await request(app).post(`/api/schedules/${ID}/resume`)).status).toBe(404);
  });

  test('delete returns 204, or 404 when missing', async () => {
    service.deleteSchedule.mockResolvedValueOnce({ _id: ID }).mockResolvedValueOnce(null);
    expect((await request(app).delete(`/api/schedules/${ID}`)).status).toBe(204);
    expect((await request(app).delete(`/api/schedules/${ID}`)).status).toBe(404);
  });
});