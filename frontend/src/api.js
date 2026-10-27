// Everything the dashboard says to the backend lives here, so components never touch fetch directly.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 means the request never reached the server
  }
}

async function request(path, { method = 'GET', body, headers } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the API. Check that the backend is running.", 0);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON (for example a proxy error page) */
    }
  }

  if (!res.ok) {
    // 502, 503 and 504 come from a proxy or load balancer when nothing is answering behind it.
    const gateway = [502, 503, 504].includes(res.status);
    const fallback = gateway
      ? "Can't reach the API. Check that the backend is running."
      : `The request failed (status ${res.status}).`;
    throw new ApiError((data && data.error) || fallback, res.status);
  }
  return { data, status: res.status };
}

export async function listJobs({ status, type, limit = 15, skip = 0 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  params.set('limit', String(limit));
  params.set('skip', String(skip));
  return (await request(`/api/jobs?${params}`)).data;
}

export const getJobStats = async () => (await request('/api/jobs/stats')).data;

// A 200 (instead of 201) means the idempotency key was already used and we got the original job back.
export async function createJob(body, { idempotencyKey } = {}) {
  const { data, status } = await request('/api/jobs', {
    method: 'POST',
    body,
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
  return { job: data, replayed: status === 200 };
}

export const cancelJob = async (id) => (await request(`/api/jobs/${id}/cancel`, { method: 'POST' })).data;
export const retryJob = async (id) => (await request(`/api/jobs/${id}/retry`, { method: 'POST' })).data;

// 'ready', 'unavailable' (the API is up but its database is not), or 'offline'.
export async function getReadiness() {
  try {
    const res = await fetch('/ready');
    return res.ok ? 'ready' : 'unavailable';
  } catch {
    return 'offline';
  }
}