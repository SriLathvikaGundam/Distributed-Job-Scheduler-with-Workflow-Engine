const express = require('express');
const mongoose = require('mongoose');
const service = require('../services/jobService');
const { STATUS } = require('../core/stateMachine');

const router = express.Router();

const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id)
    ? next()
    : res.status(400).json({ error: 'Invalid job id' });

// POST /api/jobs - submit a job (optional header: Idempotency-Key)
router.post('/', async (req, res, next) => {
  try {
    const { type, payload, runAt, maxAttempts } = req.body || {};

    if (typeof type !== 'string' || !type.trim()) {
      return res.status(400).json({ error: '"type" is required' });
    }
    if (payload !== undefined && (typeof payload !== 'object' || payload === null || Array.isArray(payload))) {
      return res.status(400).json({ error: '"payload" must be an object' });
    }
    if (runAt !== undefined && Number.isNaN(Date.parse(runAt))) {
      return res.status(400).json({ error: '"runAt" must be a valid date' });
    }
    if (maxAttempts !== undefined && !(Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 10)) {
      return res.status(400).json({ error: '"maxAttempts" must be an integer from 1 to 10' });
    }

    const rawKey = req.get('Idempotency-Key');
    if (rawKey !== undefined && (rawKey.trim() === '' || rawKey.length > 255)) {
      return res.status(400).json({ error: 'Idempotency-Key must be 1 to 255 characters' });
    }
    const idempotencyKey = rawKey ? rawKey.trim() : undefined;

    const { job, created } = await service.createJob({
      type: type.trim(),
      payload,
      runAt,
      maxAttempts,
      idempotencyKey,
    });

    if (!created) res.set('Idempotency-Replayed', 'true');
    res.status(created ? 201 : 200).json(job);
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs - list jobs (?status=&type=&limit=&skip=)
router.get('/', async (req, res, next) => {
  try {
    const { status, type } = req.query;
    if (status && !Object.values(STATUS).includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    res.json(await service.listJobs({ status, type, limit, skip }));
  } catch (err) {
    next(err);
  }
});

// Shared by cancel and retry: run an atomic action, then explain a miss (404 vs 409).
async function transition(req, res, next, action, conflictMessage) {
  try {
    const job = await action(req.params.id);
    if (job) return res.json(job);

    const existing = await service.getJob(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Job not found' });
    res.status(409).json({ error: `${conflictMessage} (current status: ${existing.status})` });
  } catch (err) {
    next(err);
  }
}

// POST /api/jobs/:id/cancel
router.post('/:id/cancel', validId, (req, res, next) =>
  transition(req, res, next, (id) => service.cancelJob(id), 'Only PENDING or RETRYING jobs can be cancelled')
);

// POST /api/jobs/:id/retry
router.post('/:id/retry', validId, (req, res, next) =>
  transition(req, res, next, (id) => service.retryFailedJob(id), 'Only FAILED jobs can be retried')
);

// GET /api/jobs/:id - one job
router.get('/:id', validId, async (req, res, next) => {
  try {
    const job = await service.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    next(err);
  }
});

module.exports = router;