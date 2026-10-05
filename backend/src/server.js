const app = require('./app');
const { port } = require('./config');
const { connect } = require('./db');

connect()
  .then(() => app.listen(port, () => console.log(`API listening on :${port}`)))
  .catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });