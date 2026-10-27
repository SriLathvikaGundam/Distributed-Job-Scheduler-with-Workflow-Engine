import { screen } from '@testing-library/react';

// Answer the requests the page makes at start-up, so no real network is needed.
// The REAL api.js is still imported, so a missing or misnamed export is caught here.
function fakeFetch(url) {
  const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  if (url === '/ready') return json({ status: 'ready' });
  if (url.startsWith('/api/jobs/stats')) return json({ counts: {}, total: 0 });
  if (url.startsWith('/api/jobs')) return json({ items: [], total: 0 });
  return { ok: false, status: 404, text: async () => '' };
}

test('the real entry point loads every file, renders the app, and loads its data', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url) => fakeFetch(url)));
  document.body.innerHTML = '<div id="root"></div>';

  await import('./main.jsx'); // fails here if a default export is missing

  expect(await screen.findByRole('heading', { name: 'Job scheduler' })).toBeInTheDocument();
  // These only appear once the list AND the stats were fetched with the real api.js functions.
  expect(await screen.findByText(/Nothing to show yet/)).toBeInTheDocument();
  expect(await screen.findByText('API ready')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull(); // no "Can't load jobs" banner
});