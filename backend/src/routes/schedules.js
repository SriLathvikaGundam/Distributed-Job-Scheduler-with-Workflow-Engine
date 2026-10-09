const express = require('express');
const mongoose = require('mongoose');
const service = require('../services/scheduleService');
const { validateCron } = require('../core/cron');

const router = express.Router();

const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id)
    ? next()
    : res.status(400).json({ error: 'Invalid schedule id' });

// POST /api/schedules - create a recurring job
router.post('/', async (req, res, next) => {
  try {
    const { name, type, payload, cron, timezone, maxAttempts } = req.body || {};

    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
      return res.status(400).json({ error: '"name" is required (max 100 characters)' });
    }
    if (typeof type !== 'string' || !type.trim()) {
      return res.status(400).json({ error: '"type" is required' });
    }
    if (payload !== undefined && (typeof payload !== 'object' || payload === null || Array.isArray(payload))) {
      return res.status(400).json({ error: '"payload" must be an object' });
    }
    if (timezone !== undefined && typeof timezone !== 'string') {
      return res.status(400).json({ error: '"timezone" must be a string like "Asia/Kolkata"' });
    }
    const cronError = validateCron(cron, timezone || 'UTC');
    if (cronError) return res.status(400).json({ error: cronError });
    if (maxAttempts !== undefined && !(Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 10)) {
      return res.status(400).json({ error: '"maxAttempts" must be an integer from 1 to 10' });
    }

    const schedule = await service.createSchedule({
      name: name.trim(),
      type: type.trim(),
      payload,
      cron: cron.trim(),
      timezone: timezone || 'UTC',
      maxAttempts,
    });
    res.status(201).json(schedule);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'A schedule with this name already exists' });
    next(err);
  }
});

// GET /api/schedules
router.get('/', async (req, res, next) => {
  try {
    res.json({ items: await service.listSchedules() });
  } catch (err) {
    next(err);
  }
});

// GET /api/schedules/:id
router.get('/:id', validId, async (req, res, next) => {
  try {
    const schedule = await service.getSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    res.json(schedule);
  } catch (err) {
    next(err);
  }
});

// POST /api/schedules/:id/pause and /resume
router.post('/:id/pause', validId, async (req, res, next) => {
  try {
    const schedule = await service.pauseSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    res.json(schedule);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/resume', validId, async (req, res, next) => {
  try {
    const schedule = await service.resumeSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    res.json(schedule);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/schedules/:id
router.delete('/:id', validId, async (req, res, next) => {
  try {
    const schedule = await service.deleteSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;