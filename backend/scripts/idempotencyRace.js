const base = process.env.API_URL || 'http://localhost:3000';
const key = `race-${Date.now()}`;
const REQUESTS = 20;

(async () => {
  const responses = await Promise.all(
    Array.from({ length: REQUESTS }, () =>
      fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ type: 'echo', payload: { test: 'idempotency' } }),
      })
    )
  );
  const bodies = await Promise.all(responses.map((r) => r.json()));

  const created = responses.filter((r) => r.status === 201).length;
  const replayed = responses.filter((r) => r.status === 200).length;
  const distinctJobs = new Set(bodies.map((b) => b._id)).size;

  console.log(`${REQUESTS} simultaneous requests with the same Idempotency-Key`);
  console.log(`  201 Created: ${created}   200 Replayed: ${replayed}   distinct jobs: ${distinctJobs}`);
})();