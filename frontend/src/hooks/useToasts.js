import { useCallback, useEffect, useRef, useState } from 'react';

// Short messages that disappear on their own: kind is 'success', 'info' or 'error'.
export function useToasts(durationMs = 4500) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (kind, message) => {
      const id = ++nextId.current;
      setToasts((list) => [...list, { id, kind, message }]);
      timers.current.set(id, setTimeout(() => dismiss(id), durationMs));
    },
    [dismiss, durationMs]
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  return { toasts, push, dismiss };
}