export default function Toasts({ toasts, onDismiss }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span>{toast.message}</span>
          <button type="button" className="btn-quiet" onClick={() => onDismiss(toast.id)} aria-label="Dismiss message">
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}