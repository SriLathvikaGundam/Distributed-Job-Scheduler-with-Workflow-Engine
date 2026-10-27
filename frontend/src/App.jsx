import { useEffect, useState } from 'react';
import { cancelJob, createJob, getJobStats, getReadiness, listJobs, retryJob } from './api';
import { usePolling } from './hooks/usePolling';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { useToasts } from './hooks/useToasts';
import { shortId } from './lib/format';
import StateOverview from './components/StateOverview';
import JobsTable from './components/JobsTable';
import JobForm from './components/JobForm';
import JobDetail from './components/JobDetail';
import Toasts from './components/Toasts';

const PAGE_SIZE = 15;
const REFRESH_MS = 2000;
const HEALTH_LABELS = { ready: 'API ready', unavailable: 'API up, database down', offline: 'API offline' };

// One round trip for everything the screen shows.
async function loadDashboard({ status, type, page }) {
  const [list, stats] = await Promise.all([
    listJobs({ status, type, limit: PAGE_SIZE, skip: page * PAGE_SIZE }),
    getJobStats(),
  ]);
  return { items: list.items, total: list.total, counts: stats.counts, grandTotal: stats.total };
}

export default function App() {
  const [status, setStatus] = useState('');
  const [typeText, setTypeText] = useState('');
  const [page, setPage] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selected, setSelected] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const { toasts, push, dismiss } = useToasts();

  const type = useDebouncedValue(typeText.trim(), 300);
  const filters = { status, type, page };

  const dashboard = usePolling(() => loadDashboard(filters), {
    intervalMs: REFRESH_MS,
    enabled: autoRefresh,
    key: JSON.stringify(filters),
  });
  const health = usePolling(getReadiness, { intervalMs: 5000 });

  const data = dashboard.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const counts = data?.counts ?? {};
  const hasFilters = status !== '' || typeText.trim() !== '';

  // Keep the open details panel in step with the latest data.
  useEffect(() => {
    if (!data) return;
    setSelected((current) => (current ? data.items.find((job) => job._id === current._id) ?? current : current));
  }, [data]);

  function chooseStatus(next) {
    setStatus(next);
    setPage(0);
  }

  function changeType(value) {
    setTypeText(value);
    setPage(0);
  }

  function clearFilters() {
    setStatus('');
    setTypeText('');
    setPage(0);
  }

  async function act(job, call, successMessage) {
    setBusyId(job._id);
    try {
      await call(job._id);
      push('success', successMessage);
      await dashboard.refresh();
    } catch (error) {
      push('error', error.message);
    } finally {
      setBusyId(null);
    }
  }

  const handleCancel = (job) => act(job, cancelJob, `Cancelled job ${shortId(job._id)}.`);
  const handleRetry = (job) => act(job, retryJob, `Job ${shortId(job._id)} is back in the queue.`);

  async function handleSubmit({ body, idempotencyKey }) {
    const { job, replayed } = await createJob(body, { idempotencyKey });
    if (replayed) {
      push('info', `That idempotency key was already used. Showing the existing job ${shortId(job._id)}.`);
    } else {
      push('success', `Submitted ${job.type} job ${shortId(job._id)}.`);
    }
    setSelected(job);
    await dashboard.refresh();
  }

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  const healthState = health.data ?? 'offline';

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <h1>Job scheduler</h1>
          <p className="subtitle">Every job and its state, updated live.</p>
        </div>
        <div className="controls">
          <span className={`health health-${healthState}`}>
            <span className="lamp" aria-hidden="true" />
            {HEALTH_LABELS[healthState]}
          </span>
          <label className="switch">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            Auto-refresh
          </label>
          <button type="button" className="btn-quiet" onClick={() => dashboard.refresh()}>
            Refresh now
          </button>
          {dashboard.updatedAt && <span className="updated">Updated {dashboard.updatedAt.toLocaleTimeString()}</span>}
        </div>
      </header>

      {dashboard.error && !data && (
        <div className="banner" role="alert">
          <strong>Can't load jobs.</strong> {dashboard.error.message} Start it with <code>npm run dev</code> in the backend folder, then
          choose Refresh now.
        </div>
      )}
      {dashboard.error && data && (
        <div className="banner" role="alert">
          Connection lost. Showing the last state we received. {dashboard.error.message}
        </div>
      )}

      <div className="workspace">
        <main>
          <StateOverview counts={counts} total={data?.grandTotal ?? 0} active={status} onSelect={chooseStatus} />

          <div className="filters">
            <label htmlFor="type-filter" className="visually-hidden">
              Filter by job type
            </label>
            <input
              id="type-filter"
              type="search"
              placeholder="Filter by job type, for example echo"
              value={typeText}
              onChange={(event) => changeType(event.target.value)}
            />
            <span className="range">
              {total === 0 ? 'No jobs' : `Showing ${from}–${to} of ${total}`}
            </span>
            <div className="pager">
              <button type="button" className="btn-quiet" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <button type="button" className="btn-quiet" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </div>

          {data ? (
            <JobsTable
              jobs={items}
              selectedId={selected?._id}
              busyId={busyId}
              hasFilters={hasFilters}
              onSelect={setSelected}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onClearFilters={clearFilters}
            />
          ) : (
            !dashboard.error && <p className="empty">Loading jobs…</p>
          )}
        </main>

        <aside>
          <section className="panel" aria-label="Submit a job">
            <h2>Submit a job</h2>
            <JobForm onSubmit={handleSubmit} />
          </section>
          {selected && (
            <JobDetail
              job={selected}
              busy={busyId === selected._id}
              onClose={() => setSelected(null)}
              onCancel={handleCancel}
              onRetry={handleRetry}
            />
          )}
        </aside>
      </div>

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}