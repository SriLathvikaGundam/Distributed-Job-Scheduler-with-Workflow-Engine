// Integration tests DELETE everything in the database they connect to.
// So the database name must end in "_test": a typo can then never point them at your real data.

function assertSafeTestUri(uri) {
  if (!uri) {
    throw new Error(
      'MONGO_TEST_URI is not set. Add it to .env, using a DIFFERENT database name that ends in "_test", e.g. ' +
        'mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/job_scheduler_test?appName=Cluster0'
    );
  }
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(uri);
  const dbName = match ? match[1] : '';
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run: the database name in MONGO_TEST_URI must end with "_test" (got "${dbName || 'none'}")`);
  }
  return dbName;
}

module.exports = { assertSafeTestUri };