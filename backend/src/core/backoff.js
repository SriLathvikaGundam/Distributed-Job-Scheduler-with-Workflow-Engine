// Exponential backoff with "equal jitter": half fixed, half random.
// Jitter stops many failed jobs from retrying at the exact same moment.

function backoffMs(attempt, { baseMs = 1000, maxMs = 60000, rng = Math.random } = {}) {
  if (attempt < 1) attempt = 1;
  const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.floor(exp / 2 + rng() * (exp / 2));
}

module.exports = { backoffMs };