const express = require('express');
const jobsRouter = require('./routes/jobs');
const schedulesRouter = require('./routes/schedules');

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/jobs', jobsRouter);
app.use('/api/schedules', schedulesRouter);

// Any URL that didn't match a route above
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler (it must take exactly 4 arguments for Express to recognize it)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;