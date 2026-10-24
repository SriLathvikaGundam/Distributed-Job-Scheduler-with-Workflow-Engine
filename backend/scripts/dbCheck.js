// Tries to connect to your databases and says, in plain words, what went wrong.
// It never prints your password and it never deletes anything.
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const Job = require('../src/models/Job');
const Workflow = require('../src/models/Workflow');
const Schedule = require('../src/models/Schedule');

const dbNameOf = (uri) => (/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(uri) || [])[1] || '(none)';

const withTimeout = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${what} did not finish within ${ms / 1000} seconds`)), ms).unref();
    }),
  ]);

async function check(label, uri, { buildIndexes = false } = {}) {
  console.log(`\n${label}`);
  if (!uri) {
    console.log('  not set in .env');
    return;
  }
  console.log(`  database name: ${dbNameOf(uri)}`);

  const started = Date.now();
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    console.log(`  connected in ${Date.now() - started} ms`);

    if (buildIndexes) {
      const indexStart = Date.now();
      await withTimeout(Promise.all([Job.init(), Workflow.init(), Schedule.init()]), 15000, 'building the indexes');
      console.log(`  indexes ready in ${Date.now() - indexStart} ms`);
    }
    console.log('  OK');
  } catch (err) {
    console.log(`  FAILED after ${Date.now() - started} ms`);
    console.log(`  ${err.name}: ${String(err.message).split('\n')[0]}`);
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

(async () => {
  await check('1. Your real database (MONGO_URI)', process.env.MONGO_URI);
  await check('2. The test database (MONGO_TEST_URI)', process.env.MONGO_TEST_URI, { buildIndexes: true });
  console.log('\nDone.');
})();