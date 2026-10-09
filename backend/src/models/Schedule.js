const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    type: { type: String, required: true, trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    cron: { type: String, required: true, trim: true },
    timezone: { type: String, default: 'UTC' },
    maxAttempts: { type: Number, default: 3, min: 1 },
    enabled: { type: Boolean, default: true },
    nextRunAt: { type: Date, required: true }, // when this schedule fires next
    lastRunAt: Date,
  },
  { timestamps: true }
);

// The scheduler repeatedly asks: "which enabled schedules are due?"
scheduleSchema.index({ enabled: 1, nextRunAt: 1 });

module.exports = mongoose.model('Schedule', scheduleSchema);