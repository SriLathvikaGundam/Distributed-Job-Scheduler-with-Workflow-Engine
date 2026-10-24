const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');

// Mongoose's readyState getter cannot be spied on, so shadow it on the connection object itself.
const fakeReadyState = (value) =>
  Object.defineProperty(mongoose.connection, 'readyState', { get: () => value, configurable: true });
afterEach(() => {
  delete mongoose.connection.readyState; // remove the shadow: the real getter shows through again
});

test('GET /health says the process is up, whatever the database is doing', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});

test('GET /ready is 503 while the database is not connected', async () => {
  // In unit tests nothing connects, so readyState is 0 (disconnected).
  const res = await request(app).get('/ready');
  expect(res.status).toBe(503);
  expect(res.body.status).toBe('unavailable');
});

test('GET /ready is 200 once the database is connected', async () => {
  fakeReadyState(1);
  const res = await request(app).get('/ready');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ready' });
});