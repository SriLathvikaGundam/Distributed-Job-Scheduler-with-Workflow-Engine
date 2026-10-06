const mongoose = require('mongoose');
const { STATUS } = require('../core/stateMachine');

const jobSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: Object.values(STATUS), default: STATUS.PENDING },

    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3, min: 1 },

    runAt: { type: Date, default: Date.now }, // earliest time the job may run
    lockedBy: { type: String, default: null }, // id of the worker holding the lease
    leaseExpiresAt: { type: Date, default: null },

    startedAt: Date,
    finishedAt: Date,
    result: mongoose.Schema.Types.Mixed,
    lastError: String,

    // Same key submitted twice means the same job (safe client retries).
    idempotencyKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

// Workers repeatedly ask: "give me the next runnable job".
jobSchema.index({ status: 1, runAt: 1 });
// Used to find jobs whose worker crashed (expired leases).
jobSchema.index({ status: 1, leaseExpiresAt: 1 });

module.exports = mongoose.model('Job', jobSchema);