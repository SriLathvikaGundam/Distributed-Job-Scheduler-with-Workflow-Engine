// Integration tests: real services and models against a real MongoDB test database.
// Run with:  npm run test:integration
module.exports = {
  testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/integration/setup.js'],
  testTimeout: 30000,
  maxWorkers: 1, // the files share one database, so run them one at a time
};