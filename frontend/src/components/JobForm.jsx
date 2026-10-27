import { useState } from 'react';
import { EMPTY_FORM, JOB_TYPES, PRESETS, buildJobRequest } from '../lib/jobForm';

// `onSubmit({ body, idempotencyKey })` should return a promise. If it rejects, the message is shown here.
export default function JobForm({ onSubmit }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    const request = buildJobRequest(form);
    if (request.error) {
      setError(request.error);
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      await onSubmit(request);
      setForm((current) => ({ ...current, idempotencyKey: '' })); // a key is meant for one submission
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="job-form" onSubmit={handleSubmit} noValidate>
      <div className="presets" role="group" aria-label="Examples">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="chip"
            onClick={() => {
              setForm(preset.fill());
              setError('');
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <label htmlFor="job-type">Job type</label>
      <input id="job-type" list="job-types" value={form.type} onChange={set('type')} autoComplete="off" />
      <datalist id="job-types">
        {JOB_TYPES.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>

      <label htmlFor="job-payload">Payload (JSON)</label>
      <textarea id="job-payload" rows={4} value={form.payload} onChange={set('payload')} spellCheck={false} />

      <div className="row">
        <div>
          <label htmlFor="job-attempts">Max attempts</label>
          <input id="job-attempts" type="number" min={1} max={10} value={form.maxAttempts} onChange={set('maxAttempts')} />
        </div>
        <div>
          <label htmlFor="job-runat">Run at (optional)</label>
          <input id="job-runat" type="datetime-local" step={1} value={form.runAt} onChange={set('runAt')} />
        </div>
      </div>

      <label htmlFor="job-key">Idempotency key (optional)</label>
      <input id="job-key" value={form.idempotencyKey} onChange={set('idempotencyKey')} placeholder="order-123" autoComplete="off" />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit job'}
      </button>
    </form>
  );
}