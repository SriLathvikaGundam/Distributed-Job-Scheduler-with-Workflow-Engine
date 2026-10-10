const mongoose = require('mongoose');

// A workflow is just a name and a grouping id. Its steps are Job documents that point
// back here (workflowId), and its overall status is worked out from those steps.
const workflowSchema = new mongoose.Schema(
  { name: { type: String, required: true, trim: true } },
  { timestamps: true }
);

module.exports = mongoose.model('Workflow', workflowSchema);