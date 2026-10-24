// Poll until `condition` returns something truthy (it may be async), or fail after a timeout.
async function waitFor(condition, { timeoutMs = 10000, intervalMs = 20, message = 'the condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await condition();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// A rendezvous point: arrive() resolves only once `parties` callers have arrived.
// Two steps that both wait on it can only finish if they really ran at the same time.
function makeBarrier(parties, timeoutMs = 8000) {
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return {
    arrive() {
      arrived++;
      if (arrived >= parties) release();
      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('barrier timed out: the steps did not run in parallel')), timeoutMs).unref();
      });
      return Promise.race([gate, timeout]);
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { waitFor, makeBarrier, sleep };