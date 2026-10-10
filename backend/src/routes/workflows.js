const express = require('express');
const mongoose = require('mongoose');
const service = require('../services/workflowService');
const { validateSteps } = require('../core/dag');

const router = express.Router();

const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id)
    ? next()
    : res.status(400).json({ error: 'Invalid workflow id' });

// POST /api/workflows - create a workflow of dependent steps
router.post('/', async (req, res, next) => {
  try {
    const { name, steps } = req.body || {};

    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
      return res.status(400).json({ error: '"name" is required (max 100 characters)' });
    }
    const { error } = validateSteps(steps);
    if (error) return res.status(400).json({ error });

    res.status(201).json(await service.createWorkflow({ name: name.trim(), steps }));
  } catch (err) {
    next(err);
  }
});

// GET /api/workflows (?limit=&skip=)
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    res.json(await service.listWorkflows({ limit, skip }));
  } catch (err) {
    next(err);
  }
});

// GET /api/workflows/:id - the workflow with all its steps
router.get('/:id', validId, async (req, res, next) => {
  try {
    const workflow = await service.getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    res.json(workflow);
  } catch (err) {
    next(err);
  }
});

// POST /api/workflows/:id/cancel
router.post('/:id/cancel', validId, async (req, res, next) => {
  try {
    const result = await service.cancelWorkflow(req.params.id);
    if (!result) return res.status(404).json({ error: 'Workflow not found' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;