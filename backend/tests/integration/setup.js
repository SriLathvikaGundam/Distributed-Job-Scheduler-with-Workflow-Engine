// Runs for every integration test file: connect to the TEST database, start each test empty.
require('dotenv').config({ quiet: true });
const { assertSafeTestUri } = require('../helpers/testDbGuard');
const { connect, disconnect } = require('../../src/db');
const Job = require('../../src/models/Job');
const Workflow = require('../../src/models/Workflow');
const Schedule = require('../../src/models/Schedule');

beforeAll(async () => {
  const uri = process.env.MONGO_TEST_URI;
  assertSafeTestUri(uri); // throws unless the database name ends in "_test"
  await connect(uri);
  // Build the indexes (such as the unique idempotency key) BEFORE any test depends on them.
  await Promise.all([Job.init(), Workflow.init(), Schedule.init()]);
});

beforeEach(async () => {
  await Promise.all([Job, Workflow, Schedule].map((model) => model.deleteMany({})));
});

afterAll(async () => {
  await disconnect();
});