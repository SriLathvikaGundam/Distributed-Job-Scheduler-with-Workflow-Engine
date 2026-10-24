const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoose = require('mongoose');
const { mongoUri } = require('./config');

// `uri` defaults to your real database. The integration tests pass their own test database.
async function connect(uri = mongoUri) {
  await mongoose.connect(uri);
  console.log('MongoDB connected');
}

const disconnect = () => mongoose.disconnect();

module.exports = { connect, disconnect };