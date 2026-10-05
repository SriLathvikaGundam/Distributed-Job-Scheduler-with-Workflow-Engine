const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoose = require('mongoose');
const { mongoUri } = require('./config');

async function connect() {
  await mongoose.connect(mongoUri);
  console.log('MongoDB connected');
}

const disconnect = () => mongoose.disconnect();

module.exports = { connect, disconnect };