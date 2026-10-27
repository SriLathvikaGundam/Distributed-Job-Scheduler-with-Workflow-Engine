import StatusBadge from './StatusBadge';
import { canCancel, canRetry, formatDateTime, shortId } from '../lib/format';

const json = (value) => JSON.stringify(value, null, 2);

export default function JobDetail({ job, busy, onClose, onCancel, onRetry }) {
  const facts = [
    ['Attempts', `${job.attempts} of ${job.maxAttempts}`],
    ['Scheduled for', formatDateTime(job.runAt)],
    ['Created', formatDateTime(job.createdAt)],
    ['Started', job.startedAt && formatDateTime(job.startedAt)],
    ['Finished', job.finishedAt && formatDateTime(job.finishedAt)],
    ['Worker', job.lockedBy],
    ['Lease ends', job.leaseExpiresAt && formatDateTime(job.leaseExpiresAt)],
    ['Workflow', job.workflowId && `${job.stepName} (workflow ${shortId(job.workflowId)})`],
    ['Idempotency key', job.idempotencyKey],
  ].filter(([, value]) => value);

  return (
    <section className="panel detail" aria-label="Job details">
      <div className="panel-head">
        <h2>
          {job.type} <code className="id">{shortId(job._id)}</code>
        </h2>
        <button type="button" className="btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>

      <StatusBadge status={job.status} />

      <dl>
        {facts.map(([label, value]) => (
          <div key={label} className="fact">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {job.lastError && (
        <>
          <h3>Last error</h3>
          <p className="error-text">{job.lastError}</p>
        </>
      )}

      <h3>Payload</h3>
      <pre>{json(job.payload ?? {})}</pre>

      {job.result !== undefined && job.result !== null && (
        <>
          <h3>Result</h3>
          <pre>{json(job.result)}</pre>
        </>
      )}

      {(canCancel(job) || canRetry(job)) && (
        <div className="detail-actions">
          {canCancel(job) && (
            <button type="button" className="btn" disabled={busy} onClick={() => onCancel(job)}>
              Cancel job
            </button>
          )}
          {canRetry(job) && (
            <button type="button" className="btn" disabled={busy} onClick={() => onRetry(job)}>
              Retry job
            </button>
          )}
        </div>
      )}
    </section>
  );
}