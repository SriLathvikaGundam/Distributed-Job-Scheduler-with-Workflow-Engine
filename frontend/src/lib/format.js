// Waiting first, then active, then settled: the order a job moves through.
export const STATUSES = ['BLOCKED', 'PENDING', 'RETRYING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'];

export const STATUS_LABELS = {
  BLOCKED: 'Blocked',
  PENDING: 'Pending',
  RETRYING: 'Retrying',
  RUNNING: 'Running',
  SUCCESS: 'Succeeded',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

// Mongo ids are long. The last six characters are enough to tell jobs apart on screen.
export const shortId = (id) => (id ? String(id).slice(-6) : '');

// "5s ago", "3m ago", "in 30s". Works for past and future times.
export function relativeTime(value, now = Date.now()) {
  if (!value) return '–';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '–';

  const seconds = Math.round((time - now) / 1000); // positive means in the future
  const abs = Math.abs(seconds);
  if (abs < 5) return 'just now';

  let amount;
  if (abs < 60) amount = `${abs}s`;
  else if (abs < 3600) amount = `${Math.floor(abs / 60)}m`;
  else if (abs < 86400) amount = `${Math.floor(abs / 3600)}h`;
  else amount = `${Math.floor(abs / 86400)}d`;

  return seconds > 0 ? `in ${amount}` : `${amount} ago`;
}

export const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : '–');

// The value format <input type="datetime-local"> wants, in the browser's local time.
const pad = (n) => String(n).padStart(2, '0');
export const toLocalInputValue = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// Workflow steps are managed from their workflow, so a single step gets no cancel or retry button.
export const isWorkflowStep = (job) => Boolean(job.workflowId);
export const canCancel = (job) => !isWorkflowStep(job) && (job.status === 'PENDING' || job.status === 'RETRYING');
export const canRetry = (job) => !isWorkflowStep(job) && job.status === 'FAILED';