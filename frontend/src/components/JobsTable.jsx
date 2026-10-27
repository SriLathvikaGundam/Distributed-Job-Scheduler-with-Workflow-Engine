import StatusBadge from './StatusBadge';
import { canCancel, canRetry, formatDateTime, relativeTime, shortId } from '../lib/format';

export default function JobsTable({ jobs, selectedId, busyId, hasFilters, onSelect, onCancel, onRetry, onClearFilters }) {
  if (jobs.length === 0) {
    return (
      <div className="empty">
        {hasFilters ? (
          <>
            <p>No jobs match these filters.</p>
            <button type="button" className="btn-quiet" onClick={onClearFilters}>
              Clear filters
            </button>
          </>
        ) : (
          <p>Nothing to show yet. Pick a preset in the form and submit a job to see it here.</p>
        )}
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Job</th>
            <th scope="col">Status</th>
            <th scope="col">Attempts</th>
            <th scope="col">Updated</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const waiting = (job.status === 'PENDING' || job.status === 'RETRYING') && new Date(job.runAt).getTime() > Date.now() + 2000;
            const showError = (job.status === 'FAILED' || job.status === 'RETRYING') && job.lastError;
            return (
              <tr
                key={job._id}
                className={job._id === selectedId ? 'selected' : ''}
                aria-selected={job._id === selectedId}
                tabIndex={0}
                onClick={() => onSelect(job)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.target === event.currentTarget) onSelect(job);
                }}
              >
                <td>
                  <div className="job-type">{job.type}</div>
                  <div className="job-meta">
                    <code className="id">{shortId(job._id)}</code>
                    {job.stepName && <span className="tag">workflow step: {job.stepName}</span>}
                  </div>
                </td>
                <td>
                  <StatusBadge status={job.status} />
                  {waiting && <div className="hint">runs {relativeTime(job.runAt)}</div>}
                  {showError && (
                    <div className="hint error-hint" title={job.lastError}>
                      {job.lastError}
                    </div>
                  )}
                </td>
                <td className="num">
                  {job.attempts} of {job.maxAttempts}
                </td>
                <td title={formatDateTime(job.updatedAt)}>{relativeTime(job.updatedAt)}</td>
                <td className="actions">
                  {canCancel(job) && (
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={busyId === job._id}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancel(job);
                      }}
                    >
                      Cancel
                    </button>
                  )}
                  {canRetry(job) && (
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={busyId === job._id}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRetry(job);
                      }}
                    >
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}