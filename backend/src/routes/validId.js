const mongoose = require('mongoose');

// Express middleware factory. Rejects a malformed :id with a clean 400,
// instead of letting Mongoose throw and the client see a 500.
module.exports = (label) => (req, res, next) =>
  mongoose.isValidObjectId(req.params.id)
    ? next()
    : res.status(400).json({ error: `Invalid ${label} id` });