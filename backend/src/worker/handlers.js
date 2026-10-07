// A handler is: (payload, context) => result. Throw an error to signal failure.
// Handlers should be idempotent: a job can run more than once
// (retries, or a re-claim after a worker crash).

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  // Returns whatever it was given.
  echo: async (payload) => ({ echoed: payload }),

  // Waits, to simulate slow work.
  sleep: async ({ ms = 1000 } = {}) => {
    await sleep(ms);
    return { sleptMs: ms };
  },

  // Fails randomly, to watch retries.
  flaky: async ({ failRate = 0.5 } = {}) => {
    if (Math.random() < failRate) throw new Error('Simulated random failure');
    return { ok: true };
  },

  // Always fails, to watch the FAILED path.
  alwaysFail: async () => {
    throw new Error('This job always fails');
  },
};