const express = require('express');
const mongoose = require('mongoose');
const jobsRouter = require('./routes/jobs');
const schedulesRouter = require('./routes/schedules');
const workflowsRouter = require('./routes/workflows');

const app = express();
app.use(express.json({ limit: '100kb' }));

// Liveness: the process is up.
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Readiness: it can actually serve requests (the database is connected).
// Load balancers and Docker use this to decide whether to send traffic.
app.get('/ready', (req, res) => {
  if (mongoose.connection.readyState === 1) return res.json({ status: 'ready' });
  res.status(503).json({ status: 'unavailable', reason: 'database not connected' });
});

app.use('/api/jobs', jobsRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/workflows', workflowsRouter);

// Any URL that didn't match a route above
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler (it must take exactly 4 arguments for Express to recognize it)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;