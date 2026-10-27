import { STATUS_LABELS } from '../lib/format';

// Colour is never the only signal: the label is always printed next to the lamp.
export default function StatusBadge({ status }) {
  return (
    <span className={`badge status-${status.toLowerCase()}`}>
      <span className="lamp" aria-hidden="true" />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}