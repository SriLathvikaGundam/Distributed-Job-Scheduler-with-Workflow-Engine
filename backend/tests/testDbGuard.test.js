const { assertSafeTestUri } = require('./helpers/testDbGuard');

describe('assertSafeTestUri', () => {
  test('accepts a database whose name ends in _test', () => {
    expect(assertSafeTestUri('mongodb+srv://u:p@cluster0.abc.mongodb.net/job_scheduler_test?appName=Cluster0')).toBe('job_scheduler_test');
    expect(assertSafeTestUri('mongodb://127.0.0.1:27017/jobs_test')).toBe('jobs_test');
    expect(assertSafeTestUri('mongodb://h1:27017,h2:27017/x_test?replicaSet=rs0')).toBe('x_test');
  });

  test('refuses your real database (name does not end in _test)', () => {
    expect(() => assertSafeTestUri('mongodb+srv://u:p@cluster0.abc.mongodb.net/job_scheduler?appName=Cluster0')).toThrow(/must end with "_test"/);
  });

  test('refuses a URI with no database name at all', () => {
    expect(() => assertSafeTestUri('mongodb+srv://u:p@cluster0.abc.mongodb.net/?appName=Cluster0')).toThrow(/got "none"/);
    expect(() => assertSafeTestUri('mongodb://127.0.0.1:27017')).toThrow(/must end with "_test"/);
  });

  test('refuses a name that merely contains test', () => {
    expect(() => assertSafeTestUri('mongodb://127.0.0.1/test_data')).toThrow(/must end with "_test"/);
  });

  test('explains what to do when the variable is missing', () => {
    expect(() => assertSafeTestUri(undefined)).toThrow(/MONGO_TEST_URI is not set/);
  });
});