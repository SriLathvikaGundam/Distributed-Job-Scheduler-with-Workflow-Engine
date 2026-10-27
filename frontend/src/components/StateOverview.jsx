import { STATUSES, STATUS_LABELS } from '../lib/format';

// The state bar shows how every job is distributed across states.
// The tabs underneath are the real controls: they filter the table.
export default function StateOverview({ counts, total, active, onSelect }) {
  const visible = STATUSES.filter((status) => (counts[status] ?? 0) > 0);

  return (
    <section aria-label="Jobs by status" className="overview">
      {total === 0 ? (
        <p className="overview-empty">No jobs yet. Submit one from the panel on the right and watch it move through the states.</p>
      ) : (
        <div className="statebar" aria-hidden="true">
          {visible.map((status) => (
            <span
              key={status}
              className={`status-${status.toLowerCase()}`}
              style={{ flexGrow: counts[status] }}
              title={`${STATUS_LABELS[status]}: ${counts[status]}`}
            />
          ))}
        </div>
      )}

      <div className="tabs" role="group" aria-label="Filter by status">
        <button type="button" className="tab" aria-pressed={active === ''} onClick={() => onSelect('')}>
          All <span className="count">{total}</span>
        </button>
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className="tab"
            aria-pressed={active === status}
            onClick={() => onSelect(status)}
          >
            {STATUS_LABELS[status]} <span className="count">{counts[status] ?? 0}</span>
          </button>
        ))}
      </div>
    </section>
  );
}