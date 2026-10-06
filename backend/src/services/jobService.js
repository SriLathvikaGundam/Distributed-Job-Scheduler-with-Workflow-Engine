const Job = require('../models/Job');

async function createJob({ type, payload = {}, runAt, maxAttempts }) {
  return Job.create({
    type,
    payload,
    ...(runAt && { runAt: new Date(runAt) }),
    ...(maxAttempts && { maxAttempts }),
  });
}

const getJob = (id) => Job.findById(id);

async function listJobs({ status, type, limit = 50, skip = 0 } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;

  const [items, total] = await Promise.all([
    Job.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Job.countDocuments(filter),
  ]);
  return { items, total };
}

module.exports = { createJob, getJob, listJobs };