const parser = require('cron-parser');

// Returns an error message if the expression or timezone is invalid, otherwise null.
// We accept standard 5-field cron: minute hour day-of-month month day-of-week.
function validateCron(expr, timezone = 'UTC') {
  if (typeof expr !== 'string' || !expr.trim()) return '"cron" is required';
  if (expr.trim().split(/\s+/).length !== 5) {
    return '"cron" must have 5 fields: minute hour day-of-month month day-of-week';
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    return `unknown timezone "${timezone}"`;
  }
  try {
    parser.parseExpression(expr, { tz: timezone });
  } catch (err) {
    return `invalid cron expression: ${err.message}`;
  }
  return null;
}

// The next time AFTER `from` that the expression matches (always strictly later).
function nextRun(expr, from = new Date(), timezone = 'UTC') {
  return parser.parseExpression(expr, { currentDate: from, tz: timezone }).next().toDate();
}

module.exports = { validateCron, nextRun };