const { connect, disconnect } = require('../src/db');
const { createJob } = require('../src/services/jobService');

const [count = '10', type = 'sleep', ms = '3000'] = process.argv.slice(2);

(async () => {
  await connect();
  const n = parseInt(count, 10);
  await Promise.all(
    Array.from({ length: n }, (_, i) =>
      createJob({ type, payload: { ms: parseInt(ms, 10), i } })
    )
  );
  console.log(`Created ${n} "${type}" job(s)`);
  await disconnect();
})();