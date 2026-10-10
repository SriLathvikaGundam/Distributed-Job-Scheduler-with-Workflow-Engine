const mongoose = require('mongoose');
const Workflow = require('../models/Workflow');
const Job = require('../models/Job');
const { STATUS, assertTransition } = require('../core/stateMachine');
const { workflowStatus } = require('../core/dag');

// Turn a workflow plus its step jobs into the shape the API returns.
function present(workflow, jobs) {
  const nameById = new Map(jobs.map((j) => [String(j._id), j.stepName]));
  return {
    id: workflow._id,
    name: workflow.name,
    createdAt: workflow.createdAt,
    status: workflowStatus(jobs.map((j) => j.status)),
    steps: jobs.map((j) => ({
      id: j._id,
      name: j.stepName,
      type: j.type,
      status: j.status,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      dependsOn: j.dependsOn.map((d) => nameById.get(String(d))),
      lastError: j.lastError ?? null,
      result: j.result ?? null,
      startedAt: j.startedAt ?? null,
      finishedAt: j.finishedAt ?? null,
    })),
  };
}

async function getWorkflow(id) {
  const workflow = await Workflow.findById(id);
  if (!workflow) return null;
  // Step ids are generated in the order the client listed the steps, so sorting by _id keeps that order.
  const jobs = await Job.find({ workflowId: workflow._id }).sort({ _id: 1 });
  return present(workflow, jobs);
}

/**
 * Create a workflow. `steps` must already have passed validateSteps().
 *
 * Without a transaction we cannot insert everything atomically, so the ORDER does the work:
 * steps with dependencies go in first (as BLOCKED, so nothing can run them), and the
 * dependency-free steps go in LAST. Nothing starts until the whole graph exists.
 */
async function createWorkflow({ name, steps }) {
  const workflow = await Workflow.create({ name });

  // Generate every step's id up front so steps can point at each other.
  const idByName = new Map(steps.map((s) => [s.name, new mongoose.Types.ObjectId()]));
  const docs = steps.map((s) => {
    const deps = s.dependsOn || [];
    return {
      _id: idByName.get(s.name),
      type: s.type.trim(),
      payload: s.payload || {},
      ...(s.maxAttempts && { maxAttempts: s.maxAttempts }),
      workflowId: workflow._id,
      stepName: s.name,
      dependsOn: deps.map((d) => idByName.get(d)),
      status: deps.length ? STATUS.BLOCKED : STATUS.PENDING,
    };
  });
  const dependents = docs.filter((d) => d.status === STATUS.BLOCKED);
  const roots = docs.filter((d) => d.status === STATUS.PENDING);

  try {
    if (dependents.length) await Job.insertMany(dependents);
    await Job.insertMany(roots);
  } catch (err) {
    // Best-effort cleanup so a half-created workflow does not linger.
    await Promise.allSettled([Job.deleteMany({ workflowId: workflow._id }), Workflow.deleteOne({ _id: workflow._id })]);
    throw err;
  }

  return getWorkflow(workflow._id);
}

async function listWorkflows({ limit = 20, skip = 0 } = {}) {
  const [workflows, total] = await Promise.all([
    Workflow.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
    Workflow.countDocuments(),
  ]);

  const jobs = await Job.find({ workflowId: { $in: workflows.map((w) => w._id) } }, 'workflowId status');
  const statusesByWorkflow = new Map();
  for (const j of jobs) {
    const key = String(j.workflowId);
    if (!statusesByWorkflow.has(key)) statusesByWorkflow.set(key, []);
    statusesByWorkflow.get(key).push(j.status);
  }

  const items = workflows.map((w) => {
    const statuses = statusesByWorkflow.get(String(w._id)) || [];
    return { id: w._id, name: w.name, createdAt: w.createdAt, status: workflowStatus(statuses), stepCount: statuses.length };
  });
  return { items, total };
}

// Cancel every step that has not started. Steps already RUNNING are left to finish
// (we cannot safely stop running code), and their dependents are already cancelled.
async function cancelWorkflow(id) {
  assertTransition(STATUS.BLOCKED, STATUS.CANCELLED);
  assertTransition(STATUS.PENDING, STATUS.CANCELLED);
  assertTransition(STATUS.RETRYING, STATUS.CANCELLED);

  const workflow = await Workflow.findById(id);
  if (!workflow) return null;

  const res = await Job.updateMany(
    { workflowId: workflow._id, status: { $in: [STATUS.BLOCKED, STATUS.PENDING, STATUS.RETRYING] } },
    { $set: { status: STATUS.CANCELLED, finishedAt: new Date(), lastError: 'Workflow cancelled' } }
  );
  return { cancelledSteps: res.modifiedCount, workflow: await getWorkflow(id) };
}

module.exports = { createWorkflow, getWorkflow, listWorkflows, cancelWorkflow };