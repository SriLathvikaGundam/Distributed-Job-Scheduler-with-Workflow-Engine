import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs `task` now and then every `intervalMs` while `enabled`.
 *  - Ticks never overlap: if a request is still running, the tick is skipped.
 *  - When `key` changes (for example the filters), it fetches straight away, and the
 *    answer to the OLD request is thrown away, so stale data never overwrites fresh data.
 *  - A failed request keeps the last good data and reports the error.
 */
export function usePolling(task, { intervalMs = 2000, enabled = true, key } = {}) {
  const taskRef = useRef(task);
  taskRef.current = task; // always call the latest version, with the latest filters

  const mounted = useRef(true);
  const inFlight = useRef(false);
  const latest = useRef(0);
  const [state, setState] = useState({ data: null, error: null, loading: true, updatedAt: null });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async ({ force = false } = {}) => {
    if (inFlight.current && !force) return;
    const id = ++latest.current;
    inFlight.current = true;
    try {
      const data = await taskRef.current();
      if (mounted.current && id === latest.current) {
        setState({ data, error: null, loading: false, updatedAt: new Date() });
      }
    } catch (error) {
      if (mounted.current && id === latest.current) {
        setState((previous) => ({ ...previous, error, loading: false }));
      }
    } finally {
      if (id === latest.current) inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    run({ force: true });
  }, [run, key]);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => run(), intervalMs);
    return () => clearInterval(timer);
  }, [run, enabled, intervalMs]);

  const refresh = useCallback(() => run({ force: true }), [run]);
  return { ...state, refresh };
}