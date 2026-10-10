// Pure job lifecycle rules. No database code here, so it is trivial to unit test.

const STATUS = Object.freeze({
  PENDING: 'PENDING',
  BLOCKED: 'BLOCKED', // workflow step waiting for its dependencies
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
  CANCELLED: 'CANCELLED',
});

const TRANSITIONS = Object.freeze({
  [STATUS.PENDING]: [STATUS.RUNNING, STATUS.CANCELLED],
  // BLOCKED -> PENDING: all dependencies succeeded. BLOCKED -> CANCELLED: a dependency failed or was cancelled.
  [STATUS.BLOCKED]: [STATUS.PENDING, STATUS.CANCELLED],
  // RUNNING -> RUNNING is a re-claim after a worker crashed and its lease expired.
  [STATUS.RUNNING]: [STATUS.SUCCESS, STATUS.FAILED, STATUS.RETRYING, STATUS.RUNNING],
  [STATUS.RETRYING]: [STATUS.RUNNING, STATUS.CANCELLED],
  [STATUS.FAILED]: [STATUS.PENDING], // manual retry from the dashboard or API
  [STATUS.SUCCESS]: [],
  [STATUS.CANCELLED]: [],
});

const TERMINAL = new Set([STATUS.SUCCESS, STATUS.CANCELLED]);

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal job transition: ${from} -> ${to}`);
  }
}

function isTerminal(status) {
  return TERMINAL.has(status);
}

module.exports = { STATUS, TRANSITIONS, canTransition, assertTransition, isTerminal };